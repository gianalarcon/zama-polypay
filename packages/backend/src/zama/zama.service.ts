import { Injectable, Logger, OnModuleInit, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import { HIDDEN_MULTISIG_ABI } from './abi';

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

    this.provider = new JsonRpcProvider(rpc, 11155111, { staticNetwork: true });
    this.wallet = new Wallet(pk, this.provider);
    this.multisigAddress = multi;

    this.logger.log(`Relayer EOA      = ${this.wallet.address}`);
    this.logger.log(`Multisig address = ${this.multisigAddress}`);
  }

  // ---------------------------------------------------------------------
  // Public info
  // ---------------------------------------------------------------------

  getRelayerInfo() {
    return { relayer: this.wallet.address, multisig: this.multisigAddress, chainId: 11155111 };
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
    return {
      id: propId,
      ptype: ['Transfer', 'SetThreshold', 'AddSigner', 'RemoveSigner'][Number(r.ptype)] ?? 'Unknown',
      data: r.data,
      approvalAttempts: Number(r.approvalAttempts),
      decryptionPending: Boolean(r.decryptionPending),
      executed: Boolean(r.executed),
      ready: Boolean(r.ready),
      createdAt: Number(r.createdAt),
    };
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

  async proposeTransfer(to: string, amount: string, token: string) {
    const c = this.writeContract();
    const tx = await c.proposeTransfer(to, amount, token);
    const receipt = await tx.wait();
    const propId = await this.parseProposalCreated(receipt);
    return { txHash: tx.hash, propId };
  }

  async proposeSetThreshold(newThreshold: number) {
    const c = this.writeContract();
    const tx = await c.proposeSetThreshold(newThreshold);
    const receipt = await tx.wait();
    const propId = await this.parseProposalCreated(receipt);
    return { txHash: tx.hash, propId };
  }

  async proposeAddSigner(encNewOwner: string, proof: string) {
    const c = this.writeContract();
    const tx = await c.proposeAddSigner(encNewOwner, proof);
    const receipt = await tx.wait();
    const propId = await this.parseProposalCreated(receipt);
    return { txHash: tx.hash, propId };
  }

  async proposeRemoveSigner(idx: number) {
    const c = this.writeContract();
    const tx = await c.proposeRemoveSigner(idx);
    const receipt = await tx.wait();
    const propId = await this.parseProposalCreated(receipt);
    return { txHash: tx.hash, propId };
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
    const abiEncoded: string = dec.abiEncodedClearValues ?? dec.abiEncodedCleartexts;
    const decryptionProof: string = dec.decryptionProof;
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

  private async parseProposalCreated(receipt: any): Promise<number> {
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
    const factory = mod.createInstance ?? mod.default?.createInstance;
    const sepoliaConfig = mod.SepoliaConfig ?? mod.default?.SepoliaConfig;
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
