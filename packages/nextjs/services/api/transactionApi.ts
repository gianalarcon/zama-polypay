import axios from "axios";
import {
  ApproveTransactionDto,
  CreateTransactionDto,
  DenyTransactionDto,
  ExecuteTransactionDto,
  PaginatedResponse,
  PaginationParams,
  Transaction,
  TxStatus,
  TxType,
  VoteType,
} from "@polypay/shared";
import { useAccountStore } from "~~/services/store/useAccountStore";

/**
 * Polypay-Zama transaction API.
 *
 * The Polypay backend exposed CRUD over /api/transactions with ZK proof
 * voting + per-vote rows. The Zama relayer instead exposes proposal
 * endpoints rooted at /api/zama/accounts/:address/proposals/*. This adapter
 * shapes the Zama proposals into the original Transaction type so all
 * existing components (DashboardContainer, TransactionRow, etc.) keep
 * working without modification.
 *
 * Privacy note: Zama proposals do NOT track per-signer votes (the contract
 * stores an encrypted `hasSigned` bitmap on-chain). We synthesise the
 * `votes` array from the AccountSigner roster but mark every entry as
 * "unknown" — the UI can still render the signer list, just without per
 * row vote ticks.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const zamaClient = axios.create({ baseURL: API_BASE });

type ZamaProposal = {
  id: number;
  ptype: "Transfer" | "SetThreshold" | "AddSigner" | "RemoveSigner";
  data: string;
  details: any;
  approvalAttempts: number;
  decryptionPending: boolean;
  executed: boolean;
  ready: boolean;
  createdAt: number;
};

type ZamaAccount = {
  id: string;
  address: string;
  name: string | null;
  threshold: number;
  signers: Array<{ commitment: string; name: string | null; ownerIndex: number; isCreator: boolean }>;
};

const ZAMA_TO_TX_TYPE: Record<ZamaProposal["ptype"], TxType> = {
  Transfer: TxType.TRANSFER,
  SetThreshold: TxType.SET_THRESHOLD,
  AddSigner: TxType.ADD_SIGNER,
  RemoveSigner: TxType.REMOVE_SIGNER,
};

function mapStatus(p: ZamaProposal): TxStatus {
  if (p.executed) return p.ready ? TxStatus.EXECUTED : TxStatus.REJECTED;
  if (p.decryptionPending) return TxStatus.APPROVED; // waiting for decrypt
  return TxStatus.PENDING;
}

async function fetchAccount(address: string): Promise<ZamaAccount | null> {
  try {
    const { data } = await zamaClient.get<ZamaAccount>(`/zama/accounts/${address}`);
    return data;
  } catch {
    return null;
  }
}

type ZamaVote = {
  id: string;
  accountAddress: string;
  propId: number;
  commitment: string;
  txHash: string | null;
  createdAt: string;
};

async function fetchVotes(address: string, propId: number): Promise<ZamaVote[]> {
  try {
    const { data } = await zamaClient.get<ZamaVote[]>(`/zama/accounts/${address}/proposals/${propId}/votes`);
    return data;
  } catch {
    return [];
  }
}

function proposalToTx(p: ZamaProposal, account: ZamaAccount | null, dbVotes: ZamaVote[] = []): Transaction {
  const ptype = ZAMA_TO_TX_TYPE[p.ptype];
  const status = mapStatus(p);
  const creator = account?.signers.find(s => s.isCreator)?.commitment ?? "";
  // Approve intents are persisted off-chain in the Vote table. The on-chain
  // FHE bitmap remains the authoritative validator; this just lets the UI
  // show "Bob approved" instead of an opaque counter.
  const signerByCommitment = new Map(
    (account?.signers ?? []).map(s => [s.commitment.toLowerCase(), s] as const),
  );
  const votes = dbVotes.map(v => {
    const signer = signerByCommitment.get(v.commitment.toLowerCase());
    return {
      voterCommitment: signer?.commitment ?? v.commitment,
      voterName: signer?.name ?? null,
      voteType: VoteType.APPROVE,
    };
  }) as any[];

  return {
    id: String(p.id),
    txId: p.id,
    accountAddress: account?.address ?? "",
    type: ptype,
    status,
    nonce: p.id,
    txHash: null,
    value: p.details?.amount ?? null,
    to: p.details?.to ?? null,
    tokenAddress: p.details?.token ?? null,
    threshold: account?.threshold ?? 0,
    newThreshold: p.details?.newThreshold ?? null,
    signerData: null,
    batchData: null,
    createdBy: creator,
    createdAt: new Date(p.createdAt * 1000).toISOString(),
    updatedAt: new Date(p.createdAt * 1000).toISOString(),
    votes,
    contact: null,
  } as unknown as Transaction;
}

export const transactionApi = {
  /**
   * No-op: legacy JWT-secured /api/transactions endpoint. The transfer
   * flow now goes through TransferContainer → POST /api/zama/accounts/:addr
   * /proposals/transfer, so this method is never called by our pages.
   */
  create: async (
    _dto: CreateTransactionDto,
  ): Promise<{ nonce: number; type: TxType; status: TxStatus; jobId: string }> => {
    throw new Error("transactionApi.create is not used in Polypay-Zama");
  },

  getAll: async (
    accountAddress: string,
    status?: TxStatus,
    _pagination?: PaginationParams,
  ): Promise<PaginatedResponse<Transaction>> => {
    if (!accountAddress) return { data: [], hasMore: false, nextCursor: null } as any;
    const [proposalsRes, account] = await Promise.all([
      zamaClient.get<ZamaProposal[]>(`/zama/accounts/${accountAddress}/proposals`),
      fetchAccount(accountAddress),
    ]);
    const proposals = proposalsRes.data;
    const voteLists = await Promise.all(proposals.map(p => fetchVotes(accountAddress, p.id)));
    let txs = proposals.map((p, i) => proposalToTx(p, account, voteLists[i]));
    if (status) txs = txs.filter(t => t.status === status);
    return { data: txs, hasMore: false, nextCursor: null } as any;
  },

  getById: async (txId: number): Promise<Transaction> => {
    const accountAddress = useAccountStore.getState().currentAccount?.address;
    if (!accountAddress) throw new Error("No active account");
    const [{ data: proposal }, account, votes] = await Promise.all([
      zamaClient.get<ZamaProposal>(`/zama/accounts/${accountAddress}/proposals/${txId}`),
      fetchAccount(accountAddress),
      fetchVotes(accountAddress, txId),
    ]);
    return proposalToTx(proposal, account, votes);
  },

  approve: async (txId: number, _dto: ApproveTransactionDto) => {
    const accountAddress = useAccountStore.getState().currentAccount?.address;
    const commitment = (await import("~~/services/store")).useIdentityStore.getState().commitment;
    if (!accountAddress) throw new Error("No active account");
    if (!commitment) throw new Error("No membership ID — sign the identity message first");
    await zamaClient.post(`/zama/accounts/${accountAddress}/proposals/${txId}/approve`, { commitment });
    return { txId, voteType: VoteType.APPROVE, jobId: "", status: TxStatus.PENDING, approveCount: 0, threshold: 0 };
  },

  deny: async (txId: number, _dto: DenyTransactionDto) => {
    // Zama protocol has no on-chain "deny" — denial is implicit (don't approve).
    return { txId, voteType: VoteType.DENY, status: TxStatus.REJECTED, denyCount: 0 };
  },

  markExecuted: async (txId: number, _txHash: string): Promise<Transaction> => {
    return transactionApi.getById(txId);
  },

  execute: async (txId: number, _dto: ExecuteTransactionDto) => {
    const accountAddress = useAccountStore.getState().currentAccount?.address;
    if (!accountAddress) throw new Error("No active account");
    const { data } = await zamaClient.post<{ txHash: string; ready: boolean; executed: boolean }>(
      `/zama/accounts/${accountAddress}/proposals/${txId}/execute`,
    );
    return { txId, txHash: data.txHash, status: data.ready ? TxStatus.EXECUTED : TxStatus.REJECTED };
  },

  reserveNonce: async (_accountAddress: string) => {
    return { nonce: 0, expiresAt: new Date(Date.now() + 60_000).toISOString() };
  },
};
