import axios from "axios";
import { Account, User } from "@polypay/shared";

/**
 * Polypay-Zama user/accounts API.
 *
 * Maps to the backend /api/zama/* endpoints:
 *   getMyAccounts(commitment) → GET /zama/accounts?commitment=...
 *   getMe()                   → identity is the wallet+commitment
 *
 * Returns Account[] shaped like Polypay's, with `signers` populated from
 * the AccountSigner table so the original UI components keep working.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const zamaClient = axios.create({ baseURL: API_BASE });

type ApiAccount = {
  id: string;
  address: string;
  name: string | null;
  threshold: number;
  ownersCount: number;
  chainId: number;
  contractVersion: string;
  deployTxHash: string | null;
  initTxHash: string | null;
  createdAt: string;
  signers: Array<{
    id: string;
    accountId: string;
    commitment: string;
    name: string | null;
    ownerIndex: number;
    isCreator: boolean;
    createdAt: string;
  }>;
};

function toAccount(a: ApiAccount): Account {
  return {
    id: a.id,
    address: a.address,
    name: a.name,
    threshold: a.threshold,
    chainId: a.chainId,
    contractVersion: a.contractVersion as any,
    createdAt: a.createdAt,
    signers: (a.signers ?? []).map(s => ({
      commitment: s.commitment,
      name: s.name,
      isCreator: s.isCreator,
    })),
  } as unknown as Account;
}

export const userApi = {
  create: async (): Promise<User> => {
    return { id: "wallet", commitment: "", createdAt: "" } as unknown as User;
  },

  getMe: async (): Promise<User> => {
    return { id: "wallet", commitment: "", createdAt: "" } as unknown as User;
  },

  getMyAccounts: async (commitment?: string): Promise<Account[]> => {
    const params = commitment ? { commitment } : {};
    const { data } = await zamaClient.get<ApiAccount[]>("/zama/accounts", { params });
    return data.map(toAccount);
  },
};
