import { Injectable, Logger, OnModuleInit, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  HIDDEN_ERC20_ABI,
  HUSD_ADDRESS,
  TX_CREATED_EVENT,
  TX_STATUS_EVENT,
  TX_VOTED_EVENT,
  TxCreatedEventData,
  TxStatusEventData,
  TxStatus,
  TxType,
  TxVotedEventData,
  VoteType,
} from "@polypay/shared";
import { AbiCoder, Contract, JsonRpcProvider, TransactionReceipt, Wallet, getAddress } from "ethers";
import { PrismaService } from "../database/prisma.service";
import { HIDDEN_MULTISIG_ABI } from "./abi";
import { CHAIN_ID, DEFAULT_SEPOLIA_RPC_URL, PROPOSAL_TYPES, ProposalTypeName } from "./constants";
import { EventsGateway } from "./events.gateway";

const METHOD_TO_TX_TYPE: Record<string, TxType> = {
  proposeTransfer: TxType.TRANSFER,
  proposeSetThreshold: TxType.SET_THRESHOLD,
  proposeAddSigner: TxType.ADD_SIGNER,
  proposeRemoveSigner: TxType.REMOVE_SIGNER,
};

/**
 * Zama relayer service.
 *
 * Multi-account refactor:
 *   - Every read/write takes the multisig contract address as a parameter,
 *     so the same backend can drive any HiddenMultisig deployed by the
 *     relayer (one row per account in Postgres).
 *   - The legacy `MULTISIG_ADDRESS` env var is gone.
 */
@Injectable()
export class ZamaService implements OnModuleInit {
  private readonly logger = new Logger(ZamaService.name);

  private provider!: JsonRpcProvider;
  private wallet!: Wallet;
  private fhevm: any | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit(): void {
    // SEPOLIA_RPC_URL is optional — falls back to a free public node so
    // env files only need to track secrets (RELAYER_PRIVATE_KEY).
    const rpc = this.config.get<string>("SEPOLIA_RPC_URL") ?? DEFAULT_SEPOLIA_RPC_URL;
    const pk = this.config.get<string>("RELAYER_PRIVATE_KEY");
    if (!pk) throw new Error("RELAYER_PRIVATE_KEY missing");

    this.provider = new JsonRpcProvider(rpc, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
    this.wallet = new Wallet(pk, this.provider);

    this.logger.log(`Relayer EOA = ${this.wallet.address}, RPC = ${rpc}`);
  }

  // ---------------------------------------------------------------------
  // Public info (no account context)
  // ---------------------------------------------------------------------

  getRelayerInfo() {
    return { relayer: this.wallet.address, chainId: CHAIN_ID };
  }

  getHUSDAddress(): string {
    // hUSD is a singleton deployed once on Sepolia; the address ships with
    // the @polypay/shared package so the backend doesn't need an env var.
    return getAddress(HUSD_ADDRESS);
  }

  /**
   * Decrypt the hUSD balance of a holder via the relayer's FHE ACL access.
   *
   * HiddenERC20 grants `FHE.allow(_balances[holder], relayer)` on every
   * balance update — that's a per-address grant for `userDecrypt`, NOT a
   * `publicDecrypt` (which would require `FHE.makePubliclyDecryptable` and
   * leak balances to anyone). We therefore drive the userDecrypt flow:
   *   1. Generate an ephemeral keypair via the relayer SDK.
   *   2. Build the KMS EIP-712 message (publicKey, contractAddresses,
   *      validity window).
   *   3. Sign it with the relayer's wallet.
   *   4. Call userDecrypt — gateway returns plaintext only because the
   *      relayer's address is in the handle's ACL.
   */
  async getHUSDBalance(holder: string): Promise<{ balance: string }> {
    const hUSDAddr = this.getHUSDAddress();
    const c = new Contract(hUSDAddr, HIDDEN_ERC20_ABI as any, this.provider);
    const handle: string = await c.balanceOf(getAddress(holder));
    if (!handle || handle === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      return { balance: "0" };
    }

    const fhevm = await this.getFhevmInstance();
    const keypair = fhevm.generateKeypair();
    const startTimestamp = Math.floor(Date.now() / 1000);
    const durationDays = 1;
    const eip712 = fhevm.createEIP712(keypair.publicKey, [hUSDAddr], startTimestamp, durationDays);

    // Strip EIP712Domain — ethers builds it from the domain object.
    const types = { ...eip712.types };
    delete (types as any).EIP712Domain;

    const signature = await this.wallet.signTypedData(eip712.domain, types as any, eip712.message);

    const result = await fhevm.userDecrypt(
      [{ handle, contractAddress: hUSDAddr }],
      keypair.privateKey,
      keypair.publicKey,
      signature.startsWith("0x") ? signature.slice(2) : signature,
      [hUSDAddr],
      this.wallet.address,
      startTimestamp,
      durationDays,
    );

    const plaintext = result[handle];
    if (plaintext === undefined || plaintext === null) {
      throw new BadRequestException("userDecrypt returned no value for handle");
    }
    return { balance: plaintext.toString() };
  }

  /** Build extraData for finalizeExecute on Transfer proposals. */
  private async buildExecuteExtraData(address: string, propId: number): Promise<string> {
    const prop = await this.getProposal(address, propId);
    if (prop.ptype !== "Transfer") return "0x";
    const amount = (prop.details as any)?.amount;
    if (!amount) throw new Error("Transfer proposal missing amount");
    const fhevm = await this.getFhevmInstance();
    const hUSDAddr = this.getHUSDAddress();
    const input = fhevm.createEncryptedInput(getAddress(hUSDAddr), getAddress(address));
    input.add64(BigInt(amount));
    const enc = await input.encrypt();
    const handle: string =
      typeof enc.handles[0] === "string" ? enc.handles[0] : "0x" + Buffer.from(enc.handles[0]).toString("hex");
    const proof: string =
      typeof enc.inputProof === "string" ? enc.inputProof : "0x" + Buffer.from(enc.inputProof).toString("hex");
    return AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes"], [handle, proof]);
  }

  // ---------------------------------------------------------------------
  // Per-account contract handles
  // ---------------------------------------------------------------------

  private readContract(address: string): Contract {
    return new Contract(getAddress(address), HIDDEN_MULTISIG_ABI, this.provider);
  }

  private writeContract(address: string): Contract {
    return new Contract(getAddress(address), HIDDEN_MULTISIG_ABI, this.wallet);
  }

  // ---------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------

  async getWalletState(address: string) {
    const c = this.readContract(address);
    try {
      const [initialized, threshold, ownersLen, active, nextProp] = await Promise.all([
        c.initialized(),
        c.threshold(),
        c.ownersLength(),
        c.activeOwnerCount(),
        c.nextPropId(),
      ]);
      return {
        address,
        initialized: Boolean(initialized),
        threshold: Number(threshold),
        ownersLength: Number(ownersLen),
        activeOwnerCount: Number(active),
        nextProposalId: Number(nextProp),
      };
    } catch (err: any) {
      this.logger.error(`getWalletState failed for ${address}: ${err?.shortMessage ?? err?.message ?? err}`, err?.stack);
      throw err;
    }
  }

  async listProposals(address: string) {
    const c = this.readContract(address);
    const next = Number(await c.nextPropId());
    const ids = Array.from({ length: next }, (_, i) => i);
    const list = await Promise.all(
      ids.map(async id => {
        try {
          return await this.getProposal(address, id);
        } catch {
          return null;
        }
      }),
    );
    return list.filter((p): p is Awaited<ReturnType<typeof this.getProposal>> => p !== null);
  }

  async getProposal(address: string, propId: number) {
    const c = this.readContract(address);
    const r = await c.getProposal(propId);
    const ptype: ProposalTypeName | "Unknown" = PROPOSAL_TYPES[Number(r.ptype)] ?? "Unknown";
    const exec = await (this.prisma.proposalExecution.findUnique as any)({
      where: { accountAddress_propId: { accountAddress: address, propId } },
    });
    return {
      id: propId,
      ptype,
      data: r.data as string,
      details: this.decodeProposalData(ptype, r.data as string),
      approvalAttempts: Number(r.approvalAttempts),
      decryptionPending: Boolean(r.decryptionPending),
      executed: Boolean(r.executed),
      ready: Boolean(r.ready),
      createdAt: Number(r.createdAt),
      executeTxHash: exec?.txHash ?? null,
    };
  }

  private decodeProposalData(ptype: string, data: string): Record<string, unknown> | null {
    if (!data || data === "0x") return null;
    const coder = AbiCoder.defaultAbiCoder();
    try {
      switch (ptype) {
        case "Transfer": {
          const [to, amount] = coder.decode(["address", "uint64"], data);
          return { to: getAddress(to), amount: amount.toString() };
        }
        case "SetThreshold": {
          const [newT] = coder.decode(["uint8"], data);
          return { newThreshold: Number(newT) };
        }
        case "AddSigner": {
          const [handle] = coder.decode(["bytes32"], data);
          return { encryptedOwnerHandle: handle };
        }
        case "RemoveSigner": {
          const [idx] = coder.decode(["uint256"], data);
          return { ownerIndex: Number(idx) };
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  }

  // ---------------------------------------------------------------------
  // Writes (relayer-signed)
  // ---------------------------------------------------------------------

  proposeTransfer(address: string, to: string, amount: string, creatorCommitment?: string) {
    // amount is uint64 in HiddenMultisig.proposeTransfer (hUSD scope).
    return this.proposeAndAutoApprove(address, "proposeTransfer", [to, BigInt(amount)], creatorCommitment);
  }

  proposeSetThreshold(address: string, newThreshold: number, creatorCommitment?: string) {
    return this.proposeAndAutoApprove(address, "proposeSetThreshold", [newThreshold], creatorCommitment);
  }

  proposeRemoveSigner(address: string, idx: number, creatorCommitment?: string) {
    return this.proposeAndAutoApprove(address, "proposeRemoveSigner", [idx], creatorCommitment);
  }

  /**
   * AddSigner with server-side encryption: caller passes plaintext commitment,
   * backend encrypts it bound to (account, relayer) and submits.
   */
  async proposeAddSigner(address: string, newOwnerCommitment: string, creatorCommitment?: string) {
    const fhevm = await this.getFhevmInstance();
    const input = fhevm.createEncryptedInput(getAddress(address), getAddress(this.wallet.address));
    input.addAddress(getAddress(newOwnerCommitment));
    const enc = await input.encrypt();
    const handle: string =
      typeof enc.handles[0] === "string" ? enc.handles[0] : "0x" + Buffer.from(enc.handles[0]).toString("hex");
    const proof: string =
      typeof enc.inputProof === "string" ? enc.inputProof : "0x" + Buffer.from(enc.inputProof).toString("hex");
    return this.proposeAndAutoApprove(address, "proposeAddSigner", [handle, proof], creatorCommitment);
  }

  /**
   * Submit a propose* call then immediately auto-approve on behalf of the
   * creator (mirrors Polypay's behavior — creating a proposal counts as
   * the first approval). The two on-chain calls are sequential, not
   * atomic; if auto-approve fails the proposal still exists and the user
   * can re-approve manually from the UI.
   */
  private async proposeAndAutoApprove(
    address: string,
    method: string,
    args: unknown[],
    creatorCommitment?: string,
  ): Promise<{ txHash: string; propId: number }> {
    const result = await this.submitProposal(address, method, args);

    // Notify the account room so other signers see the new proposal in real time.
    const txCreated: TxCreatedEventData = {
      txId: result.propId,
      type: METHOD_TO_TX_TYPE[method] ?? TxType.TRANSFER,
      accountAddress: getAddress(address),
    };
    this.events.emitToAccount(address, TX_CREATED_EVENT, txCreated);

    if (creatorCommitment) {
      try {
        await this.approve(address, result.propId, creatorCommitment);
      } catch (err: any) {
        this.logger.warn(
          `auto-approve creator failed for ${address}#${result.propId}: ${err?.shortMessage ?? err?.message ?? err}`,
        );
      }
    }
    return result;
  }

  /**
   * Approve: backend encrypts the signer's commitment server-side bound to
   * (account, relayer), then submits via the contract.
   */
  async approve(address: string, propId: number, commitment: string) {
    // Block users who already denied off-chain from also approving.
    const existing = await (this.prisma as any).vote.findUnique({
      where: {
        accountAddress_propId_commitment: {
          accountAddress: getAddress(address),
          propId,
          commitment: commitment.toLowerCase(),
        },
      },
    });
    if (existing && existing.voteType === "DENY") {
      throw new BadRequestException("You already denied this proposal");
    }

    const fhevm = await this.getFhevmInstance();
    const input = fhevm.createEncryptedInput(getAddress(address), getAddress(this.wallet.address));
    input.addAddress(getAddress(commitment));
    const enc = await input.encrypt();
    const handle: string =
      typeof enc.handles[0] === "string" ? enc.handles[0] : "0x" + Buffer.from(enc.handles[0]).toString("hex");
    const proof: string =
      typeof enc.inputProof === "string" ? enc.inputProof : "0x" + Buffer.from(enc.inputProof).toString("hex");

    const c = this.writeContract(address);
    const tx = await c.approve(propId, handle, proof);
    const receipt = await tx.wait();

    // Record the approve intent off-chain. The contract's encrypted bitmap
    // is the authoritative validator; this row just lets the UI show who
    // already clicked Approve.
    try {
      await (this.prisma as any).vote.upsert({
        where: {
          accountAddress_propId_commitment: {
            accountAddress: getAddress(address),
            propId,
            commitment: commitment.toLowerCase(),
          },
        },
        create: {
          accountAddress: getAddress(address),
          propId,
          commitment: commitment.toLowerCase(),
          voteType: "APPROVE",
          txHash: tx.hash,
        },
        update: { voteType: "APPROVE", txHash: tx.hash },
      });
    } catch (err: any) {
      this.logger.warn(`Vote upsert failed for ${address}#${propId}: ${err?.message ?? err}`);
    }

    await this.emitVoteEvent(address, propId, commitment, VoteType.APPROVE, tx.hash);

    return { txHash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Deny: off-chain only. Zama HiddenMultisig has no deny opcode (the
   * encrypted approval bitmap can only count approvals). We persist a
   * DENY row in the Vote table so the dashboard can show who rejected;
   * the on-chain proposal stays PENDING and simply never reaches the
   * approval threshold if enough signers deny.
   */
  async deny(address: string, propId: number, commitment: string) {
    const existing = await (this.prisma as any).vote.findUnique({
      where: {
        accountAddress_propId_commitment: {
          accountAddress: getAddress(address),
          propId,
          commitment: commitment.toLowerCase(),
        },
      },
    });
    if (existing && existing.voteType === "APPROVE") {
      throw new BadRequestException("You already approved this proposal");
    }

    await (this.prisma as any).vote.upsert({
      where: {
        accountAddress_propId_commitment: {
          accountAddress: getAddress(address),
          propId,
          commitment: commitment.toLowerCase(),
        },
      },
      create: {
        accountAddress: getAddress(address),
        propId,
        commitment: commitment.toLowerCase(),
        voteType: "DENY",
      },
      update: { voteType: "DENY" },
    });

    await this.emitVoteEvent(address, propId, commitment, VoteType.DENY, null);

    return { ok: true, voteType: "DENY" };
  }

  private async emitVoteEvent(
    address: string,
    propId: number,
    commitment: string,
    voteType: VoteType,
    txHash: string | null,
  ): Promise<void> {
    const approveCount = await (this.prisma as any).vote.count({
      where: { accountAddress: getAddress(address), propId, voteType: "APPROVE" },
    });
    const eventData: TxVotedEventData = {
      txId: propId,
      voteType,
      approveCount,
      vote: {
        id: 0 as any,
        txId: propId,
        voterCommitment: commitment.toLowerCase(),
        voterName: null,
        voteType,
        txHash,
        proofStatus: undefined as any,
        zkVerifyStatementHash: null,
        zkVerifyAttestationId: null,
        zkVerifyTxHash: null,
        zkVerifyAggregationId: null,
        zkVerifyJobId: null,
        proofSubmittedAt: null,
        proofVerifiedAt: null,
        proofErrorMessage: null,
        createdAt: new Date(),
      } as any,
    };
    this.events.emitToAccount(address, TX_VOTED_EVENT, eventData);
  }

  async listVotes(address: string, propId: number) {
    return (this.prisma as any).vote.findMany({
      where: { accountAddress: getAddress(address), propId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Two-step execute: requestExecute → publicDecrypt → finalizeExecute.
   *
   * For Transfer proposals the relayer also encrypts the plaintext amount
   * (stored in the proposal data) bound to (hUSD, this multisig) and packs
   * (encAmount, inputProof) into the finalizeExecute extraData parameter
   * so HiddenMultisig._execTransfer can hand it to hUSD.transfer.
   */
  async execute(address: string, propId: number) {
    const c = this.writeContract(address);

    const reqTx = await c.requestExecute(propId);
    await reqTx.wait();
    this.logger.log(`requestExecute ${address}#${propId} mined: ${reqTx.hash}`);

    const handle: string = await c.getReadyHandle(propId);
    if (!handle || handle === "0x0000000000000000000000000000000000000000000000000000000000000000") {
      throw new BadRequestException("readyHandle missing");
    }

    const fhevm = await this.getFhevmInstance();
    const dec = await fhevm.publicDecrypt([handle]);
    const abiEncoded = dec.abiEncodedClearValues;
    const decryptionProof = dec.decryptionProof;
    if (!abiEncoded || !decryptionProof) {
      throw new BadRequestException("publicDecrypt did not return cleartexts/proof");
    }
    this.logger.log(`publicDecrypt(${handle}) ok`);

    // Build extraData for Transfer proposals: encrypt amount fresh bound to
    // (hUSD, multisig) so hUSD.transfer can consume it inside finalizeExecute.
    const extraData = await this.buildExecuteExtraData(address, propId);

    const finTx = await c.finalizeExecute(propId, abiEncoded, decryptionProof, extraData);
    const finReceipt = await finTx.wait();
    this.logger.log(`finalizeExecute ${address}#${propId} mined: ${finTx.hash}`);

    // Persist the execute txHash so the dashboard can render an explorer link.
    await (this.prisma.proposalExecution.upsert as any)({
      where: { accountAddress_propId: { accountAddress: address, propId } },
      create: {
        accountAddress: address,
        propId,
        txHash: finTx.hash,
        blockNumber: finReceipt?.blockNumber ? Number(finReceipt.blockNumber) : null,
      },
      update: {
        txHash: finTx.hash,
        blockNumber: finReceipt?.blockNumber ? Number(finReceipt.blockNumber) : null,
      },
    });

    const prop = await this.getProposal(address, propId);

    const statusEvent: TxStatusEventData = {
      txId: propId,
      status: prop.ready ? TxStatus.EXECUTED : TxStatus.FAILED,
      txHash: finTx.hash,
    };
    this.events.emitToAccount(address, TX_STATUS_EVENT, statusEvent);

    return {
      txHash: finTx.hash,
      blockNumber: finReceipt?.blockNumber,
      ready: prop.ready,
      executed: prop.executed,
    };
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private async submitProposal(
    address: string,
    method: string,
    args: unknown[],
  ): Promise<{ txHash: string; propId: number }> {
    const c = this.writeContract(address);
    const fn = c.getFunction(method);
    const tx = await fn(...args);
    const receipt = await tx.wait();
    return { txHash: tx.hash, propId: this.parseProposalCreated(address, receipt) };
  }

  private parseProposalCreated(address: string, receipt: TransactionReceipt | null): number {
    const c = this.readContract(address);
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = c.interface.parseLog(log);
        if (parsed?.name === "ProposalCreated") return Number(parsed.args.propId);
      } catch {
        // not our event
      }
    }
    throw new Error("ProposalCreated event not found");
  }

  private async getFhevmInstance(): Promise<any> {
    if (this.fhevm) return this.fhevm;
    const mod: any = await import("@zama-fhe/relayer-sdk/node");
    const factory: typeof import("@zama-fhe/relayer-sdk/node").createInstance =
      mod.createInstance ?? mod.default?.createInstance;
    const sepoliaConfig: typeof import("@zama-fhe/relayer-sdk/node").SepoliaConfig =
      mod.SepoliaConfig ?? mod.default?.SepoliaConfig;
    if (!factory || !sepoliaConfig) {
      throw new Error("Zama relayer SDK does not expose createInstance / SepoliaConfig");
    }
    this.fhevm = await factory({
      ...sepoliaConfig,
      network: this.config.get<string>("SEPOLIA_RPC_URL") ?? DEFAULT_SEPOLIA_RPC_URL,
    });
    return this.fhevm;
  }
}
