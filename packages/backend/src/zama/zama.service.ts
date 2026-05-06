import { Injectable, Logger, OnModuleInit, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AbiCoder, Contract, JsonRpcProvider, TransactionReceipt, Wallet, getAddress } from "ethers";
import { PrismaService } from "../database/prisma.service";
import { HIDDEN_MULTISIG_ABI } from "./abi";
import { CHAIN_ID, PROPOSAL_TYPES, ProposalTypeName } from "./constants";

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
  ) {}

  onModuleInit(): void {
    const rpc = this.config.get<string>("SEPOLIA_RPC_URL");
    const pk = this.config.get<string>("RELAYER_PRIVATE_KEY");
    if (!rpc) throw new Error("SEPOLIA_RPC_URL missing");
    if (!pk) throw new Error("RELAYER_PRIVATE_KEY missing");

    this.provider = new JsonRpcProvider(rpc, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
    this.wallet = new Wallet(pk, this.provider);

    this.logger.log(`Relayer EOA = ${this.wallet.address}`);
  }

  // ---------------------------------------------------------------------
  // Public info (no account context)
  // ---------------------------------------------------------------------

  getRelayerInfo() {
    return { relayer: this.wallet.address, chainId: CHAIN_ID };
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
    };
  }

  private decodeProposalData(ptype: string, data: string): Record<string, unknown> | null {
    if (!data || data === "0x") return null;
    const coder = AbiCoder.defaultAbiCoder();
    try {
      switch (ptype) {
        case "Transfer": {
          const [to, amount, token] = coder.decode(["address", "uint256", "address"], data);
          return { to: getAddress(to), amount: amount.toString(), token: getAddress(token) };
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

  proposeTransfer(address: string, to: string, amount: string, token: string, creatorCommitment?: string) {
    return this.proposeAndAutoApprove(address, "proposeTransfer", [to, amount, token], creatorCommitment);
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
          txHash: tx.hash,
        },
        update: { txHash: tx.hash },
      });
    } catch (err: any) {
      this.logger.warn(`Vote upsert failed for ${address}#${propId}: ${err?.message ?? err}`);
    }

    return { txHash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  async listVotes(address: string, propId: number) {
    return (this.prisma as any).vote.findMany({
      where: { accountAddress: getAddress(address), propId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Two-step execute: requestExecute → publicDecrypt → finalizeExecute.
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

    const finTx = await c.finalizeExecute(propId, abiEncoded, decryptionProof);
    const finReceipt = await finTx.wait();
    this.logger.log(`finalizeExecute ${address}#${propId} mined: ${finTx.hash}`);

    const prop = await this.getProposal(address, propId);
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
      network: this.config.get<string>("SEPOLIA_RPC_URL"),
    });
    return this.fhevm;
  }
}
