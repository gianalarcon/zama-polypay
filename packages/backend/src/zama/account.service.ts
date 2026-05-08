import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ACCOUNT_CREATED_EVENT, AccountCreatedEventData, HIDDEN_MULTISIG_ABI, HIDDEN_MULTISIG_BYTECODE, HUSD_ADDRESS } from "@polypay/shared";
import { Contract, ContractFactory, JsonRpcProvider, Wallet, getAddress } from "ethers";
import { PrismaService } from "../database/prisma.service";
import { CHAIN_ID, DEFAULT_SEPOLIA_RPC_URL } from "./constants";
import { EventsGateway } from "./events.gateway";

export type SignerInput = {
  commitment: string;
  name?: string;
  ownerIndex: number;
  isCreator?: boolean;
};

export type CreateAccountArgs = {
  name?: string;
  threshold: number;
  signers: SignerInput[];
};

/**
 * Polypay-Zama account service.
 *
 * Single-step flow (Option 3):
 *   1. Deploy a fresh HiddenMultisig (constructor takes the relayer EOA).
 *   2. Server-side: encrypt the plaintext commitments via the Zama relayer
 *      SDK, bound to the freshly deployed contract address.
 *   3. Call contract.initialize(encOwners, proof, threshold).
 *   4. Persist Account + AccountSigner rows.
 *
 * The FE sends only plaintext commitments + threshold + names. The
 * backend already sees commitments via the AccountSigner table, so doing
 * the encryption here does not weaken privacy.
 */
@Injectable()
export class AccountService implements OnModuleInit {
  private readonly logger = new Logger(AccountService.name);

  private provider!: JsonRpcProvider;
  private wallet!: Wallet;
  private fhevm: any | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit(): void {
    const rpc = this.config.get<string>("SEPOLIA_RPC_URL") ?? DEFAULT_SEPOLIA_RPC_URL;
    const pk = this.config.get<string>("RELAYER_PRIVATE_KEY");
    if (!pk) throw new Error("RELAYER_PRIVATE_KEY missing");

    this.provider = new JsonRpcProvider(rpc, CHAIN_ID, { staticNetwork: true, batchMaxCount: 1 });
    this.wallet = new Wallet(pk, this.provider);
  }

  getRelayerAddress(): string {
    return this.wallet.address;
  }

  private async getFhevmInstance(): Promise<any> {
    if (this.fhevm) return this.fhevm;
    const mod: any = await import("@zama-fhe/relayer-sdk/node");
    const factory = mod.createInstance ?? mod.default?.createInstance;
    const sepoliaConfig = mod.SepoliaConfig ?? mod.default?.SepoliaConfig;
    if (!factory || !sepoliaConfig) {
      throw new Error("Zama relayer SDK does not expose createInstance / SepoliaConfig");
    }
    this.fhevm = await factory({
      ...sepoliaConfig,
      network: this.config.get<string>("SEPOLIA_RPC_URL") ?? DEFAULT_SEPOLIA_RPC_URL,
    });
    return this.fhevm;
  }

  /**
   * Atomic create: deploy → encrypt server-side → initialize → persist.
   */
  async create(args: CreateAccountArgs) {
    if (!HIDDEN_MULTISIG_BYTECODE || HIDDEN_MULTISIG_BYTECODE.length < 4) {
      throw new BadRequestException(
        "HIDDEN_MULTISIG_BYTECODE missing in @polypay/shared/contracts/HiddenMultisig",
      );
    }
    if (args.signers.length === 0) {
      throw new BadRequestException("at least one signer required");
    }
    if (args.threshold < 1 || args.threshold > args.signers.length) {
      throw new BadRequestException("threshold out of range");
    }

    // 1. Deploy.
    const hUSDAddr = getAddress(HUSD_ADDRESS);
    const factory = new ContractFactory(HIDDEN_MULTISIG_ABI as any, HIDDEN_MULTISIG_BYTECODE, this.wallet);
    this.logger.log(`Deploying HiddenMultisig (relayer=${this.wallet.address}, hUSD=${hUSDAddr})`);
    const deploy = await factory.deploy(this.wallet.address, hUSDAddr);
    const deployTx = deploy.deploymentTransaction();
    if (!deployTx) throw new Error("deploymentTransaction unavailable");
    await deploy.waitForDeployment();
    const address = await deploy.getAddress();
    this.logger.log(`Deployed at ${address} (tx: ${deployTx.hash})`);

    // 2. Encrypt commitments server-side, bound to (newContract, relayer).
    const fhevm = await this.getFhevmInstance();
    const input = fhevm.createEncryptedInput(getAddress(address), getAddress(this.wallet.address));
    for (const s of args.signers) {
      input.addAddress(getAddress(s.commitment));
    }
    const enc = await input.encrypt();
    const encOwners: string[] = enc.handles.map((h: any) =>
      typeof h === "string" ? h : "0x" + Buffer.from(h).toString("hex"),
    );
    const proof: string =
      typeof enc.inputProof === "string" ? enc.inputProof : "0x" + Buffer.from(enc.inputProof).toString("hex");

    // 3. Initialize.
    const contract = new Contract(address, HIDDEN_MULTISIG_ABI, this.wallet);
    const initTx = await contract.initialize(encOwners, proof, args.threshold);
    await initTx.wait();
    this.logger.log(`Initialized ${address} (tx: ${initTx.hash})`);

    // 4. Persist.
    const account = await (this.prisma.account.create as any)({
      data: {
        address,
        name: args.name ?? null,
        threshold: args.threshold,
        ownersCount: args.signers.length,
        chainId: CHAIN_ID,
        deployTxHash: deployTx.hash,
        initTxHash: initTx.hash,
        signers: {
          create: args.signers.map(s => ({
            commitment: s.commitment.toLowerCase(),
            name: s.name ?? null,
            ownerIndex: s.ownerIndex,
            isCreator: s.isCreator ?? false,
          })),
        },
      },
      include: { signers: true },
    });

    // Broadcast so any signer connected to the socket (regardless of which
    // account room they joined) gets notified the account is live.
    const eventData: AccountCreatedEventData = {
      accountAddress: account.address,
      name: account.name ?? "",
      threshold: account.threshold,
      signerCount: account.signers.length,
      createdAt: account.createdAt.toISOString(),
    };
    this.events.broadcast(ACCOUNT_CREATED_EVENT, eventData);

    return account;
  }

  async list(options?: { commitment?: string }) {
    if (options?.commitment) {
      return (this.prisma.account.findMany as any)({
        where: {
          signers: {
            some: { commitment: options.commitment.toLowerCase() },
          },
        },
        orderBy: { createdAt: "desc" },
        include: { signers: true },
      });
    }
    return (this.prisma.account.findMany as any)({
      orderBy: { createdAt: "desc" },
      include: { signers: true },
    });
  }

  async findByAddress(address: string) {
    const account = await (this.prisma.account.findUnique as any)({
      where: { address },
      include: { signers: true },
    });
    if (!account) throw new NotFoundException(`Account ${address} not found`);
    return account;
  }

  async update(address: string, dto: { name?: string }) {
    const existing = await (this.prisma.account.findUnique as any)({
      where: { address },
    });
    if (!existing) throw new NotFoundException(`Account ${address} not found`);
    return (this.prisma.account.update as any)({
      where: { address },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
      },
      include: { signers: true },
    });
  }
}
