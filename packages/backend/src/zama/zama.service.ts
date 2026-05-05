import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AbiCoder, Contract, JsonRpcProvider, TransactionReceipt, Wallet, getAddress } from 'ethers';
import { HIDDEN_MULTISIG_ABI } from './abi';
import { CHAIN_ID, PROPOSAL_TYPES, ProposalTypeName } from './constants';

/**
 * Zama relayer service.
 *
 * Responsibilities:
 *   - Hold the relayer hot wallet (single EOA).
 *   - Submit every contract write so msg.sender always equals the relayer
 *     (this is what hides signer identity on-chain).
 *   - Drive the off-chain decryption roundtrip required by HiddenMultisig:
 *     requestExecute -> Gateway/KMS publicDecrypt -> finalizeExecute.
 *
 * Notes:
 *   - State is read directly from the contract (no DB). For demo, we trust
 *     the Sepolia RPC.
 *   - The relayer SDK runtime instance is initialised lazily on first
 *     decryption request because the import path is ESM-only.
 */
@Injectable()
export class ZamaService implements OnModuleInit {
  private readonly logger = new Logger(ZamaService.name);

  private provider!: JsonRpcProvider;
  private wallet!: Wallet;
  private multisigAddress!: string;

  // Lazy-initialised Zama Relayer SDK runtime instance.
  private fhevm: any | null = null;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const rpc = this.config.get<string>('SEPOLIA_RPC_URL');
    const pk = this.config.get<string>('RELAYER_PRIVATE_KEY');
    const multi = this.config.get<string>('MULTISIG_ADDRESS');
    if (!rpc) throw new Error('SEPOLIA_RPC_URL missing');
    if (!pk) throw new Error('RELAYER_PRIVATE_KEY missing');
    if (!multi) throw new Error('MULTISIG_ADDRESS missing');

    this.provider = new JsonRpcProvider(rpc, CHAIN_ID, { staticNetwork: true });
    this.wallet = new Wallet(pk, this.provider);
    this.multisigAddress = multi;

    this.logger.log(`Relayer EOA      = ${this.wallet.address}`);
    this.logger.log(`Multisig address = ${this.multisigAddress}`);
  }

  // ---------------------------------------------------------------------
  // Public info
  // ---------------------------------------------------------------------

  getRelayerInfo() {
    return { relayer: this.wallet.address, multisig: this.multisigAddress, chainId: CHAIN_ID };
  }

  // ---------------------------------------------------------------------
  // Read-only contract views
  // ---------------------------------------------------------------------

  private readContract(): Contract {
    return new Contract(this.multisigAddress, HIDDEN_MULTISIG_ABI, this.provider);
  }

  private writeContract(): Contract {
    return new Contract(this.multisigAddress, HIDDEN_MULTISIG_ABI, this.wallet);
  }

  async getWalletState() {
    const c = this.readContract();
    const [initialized, threshold, ownersLen, active, nextProp] = await Promise.all([
      c.initialized(),
      c.threshold(),
      c.ownersLength(),
      c.activeOwnerCount(),
      c.nextPropId(),
    ]);
    return {
      address: this.multisigAddress,
      initialized: Boolean(initialized),
      threshold: Number(threshold),
      ownersLength: Number(ownersLen),
      activeOwnerCount: Number(active),
      nextProposalId: Number(nextProp),
    };
  }

  async getProposal(propId: number) {
    const c = this.readContract();
    const r = await c.getProposal(propId);
    const ptype: ProposalTypeName | 'Unknown' = PROPOSAL_TYPES[Number(r.ptype)] ?? 'Unknown';
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
    if (!data || data === '0x') return null;
    const coder = AbiCoder.defaultAbiCoder();
    try {
      switch (ptype) {
        case 'Transfer': {
          const [to, amount, token] = coder.decode(['address', 'uint256', 'address'], data);
          return { to: getAddress(to), amount: amount.toString(), token: getAddress(token) };
        }
        case 'SetThreshold': {
          const [newT] = coder.decode(['uint8'], data);
          return { newThreshold: Number(newT) };
        }
        case 'AddSigner': {
          const [handle] = coder.decode(['bytes32'], data);
          return { encryptedOwnerHandle: handle };
        }
        case 'RemoveSigner': {
          const [idx] = coder.decode(['uint256'], data);
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

  async initialize(encOwners: string[], proof: string, threshold: number) {
    const c = this.writeContract();
    const tx = await c.initialize(encOwners, proof, threshold);
    const receipt = await tx.wait();
    return { txHash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  proposeTransfer(to: string, amount: string, token: string) {
    return this.submitProposal('proposeTransfer', [to, amount, token]);
  }

  proposeSetThreshold(newThreshold: number) {
    return this.submitProposal('proposeSetThreshold', [newThreshold]);
  }

  proposeAddSigner(encNewOwner: string, proof: string) {
    return this.submitProposal('proposeAddSigner', [encNewOwner, proof]);
  }

  proposeRemoveSigner(idx: number) {
    return this.submitProposal('proposeRemoveSigner', [idx]);
  }

  async approve(propId: number, encSigner: string, proof: string) {
    const c = this.writeContract();
    const tx = await c.approve(propId, encSigner, proof);
    const receipt = await tx.wait();
    return { txHash: tx.hash, blockNumber: receipt?.blockNumber };
  }

  /**
   * Two-step execute roundtrip:
   *   1. requestExecute on-chain -> contract makes the `ready` ebool publicly
   *      decryptable and stores its handle.
   *   2. publicDecrypt off-chain via Zama relayer SDK -> get cleartext +
   *      KMS signatures.
   *   3. finalizeExecute on-chain -> contract verifies signatures and runs
   *      the proposal payload.
   *
   * Returns the final tx hash and whether the proposal cleared the threshold.
   */
  async execute(propId: number) {
    const c = this.writeContract();

    const reqTx = await c.requestExecute(propId);
    await reqTx.wait();
    this.logger.log(`requestExecute ${propId} mined: ${reqTx.hash}`);

    const handle: string = await c.getReadyHandle(propId);
    if (!handle || handle === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      throw new BadRequestException('readyHandle missing');
    }

    const fhevm = await this.getFhevmInstance();
    const dec = await fhevm.publicDecrypt([handle]);
    const abiEncoded = dec.abiEncodedClearValues;
    const decryptionProof = dec.decryptionProof;
    if (!abiEncoded || !decryptionProof) {
      throw new BadRequestException('publicDecrypt did not return cleartexts/proof');
    }
    this.logger.log(`publicDecrypt(${handle}) ok`);

    const finTx = await c.finalizeExecute(propId, abiEncoded, decryptionProof);
    const finReceipt = await finTx.wait();
    this.logger.log(`finalizeExecute ${propId} mined: ${finTx.hash}`);

    const prop = await this.getProposal(propId);
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

  /**
   * Submit a propose* call and return the on-chain propId emitted in
   * ProposalCreated. Single source of truth for the propose-receipt flow.
   */
  private async submitProposal(method: string, args: unknown[]): Promise<{ txHash: string; propId: number }> {
    const c = this.writeContract();
    const fn = c.getFunction(method);
    const tx = await fn(...args);
    const receipt = await tx.wait();
    return { txHash: tx.hash, propId: this.parseProposalCreated(receipt) };
  }

  private parseProposalCreated(receipt: TransactionReceipt | null): number {
    const c = this.readContract();
    for (const log of receipt?.logs ?? []) {
      try {
        const parsed = c.interface.parseLog(log);
        if (parsed?.name === 'ProposalCreated') return Number(parsed.args.propId);
      } catch {
        // not our event
      }
    }
    throw new Error('ProposalCreated event not found');
  }

  private async getFhevmInstance(): Promise<any> {
    if (this.fhevm) return this.fhevm;

    // Dynamic import keeps the ESM-only relayer SDK out of the CommonJS build graph.
    const mod: any = await import('@zama-fhe/relayer-sdk/node');
    const factory: typeof import('@zama-fhe/relayer-sdk/node').createInstance =
      mod.createInstance ?? mod.default?.createInstance;
    const sepoliaConfig: typeof import('@zama-fhe/relayer-sdk/node').SepoliaConfig =
      mod.SepoliaConfig ?? mod.default?.SepoliaConfig;
    if (!factory || !sepoliaConfig) {
      throw new Error('Zama relayer SDK does not expose createInstance / SepoliaConfig');
    }
    this.fhevm = await factory({
      ...sepoliaConfig,
      network: this.config.get<string>('SEPOLIA_RPC_URL'),
    });
    return this.fhevm;
  }
}
