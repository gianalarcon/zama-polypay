import axios from "axios";

const baseURL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";

export const api = axios.create({ baseURL });

export type RelayerInfo = {
  relayer: string;
  multisig: string;
  chainId: number;
};

export type WalletState = {
  address: string;
  initialized: boolean;
  threshold: number;
  ownersLength: number;
  activeOwnerCount: number;
  nextProposalId: number;
};

export type ProposalDetails =
  | { to: string; amount: string; token: string }
  | { newThreshold: number }
  | { encryptedOwnerHandle: string }
  | { ownerIndex: number }
  | null;

export type ProposalState = {
  id: number;
  ptype: "Transfer" | "SetThreshold" | "AddSigner" | "RemoveSigner";
  data: string;
  details: ProposalDetails;
  approvalAttempts: number;
  decryptionPending: boolean;
  executed: boolean;
  ready: boolean;
  createdAt: number;
};

export const zamaApi = {
  getRelayerInfo: () => api.get<RelayerInfo>("/zama/relayer").then(r => r.data),
  getWallet: () => api.get<WalletState>("/zama/wallet").then(r => r.data),
  getProposal: (id: number) => api.get<ProposalState>(`/zama/proposals/${id}`).then(r => r.data),

  initialize: (encOwners: string[], proof: string, threshold: number) =>
    api.post("/zama/initialize", { encOwners, proof, threshold }).then(r => r.data),

  proposeTransfer: (to: string, amount: string, token: string) =>
    api.post<{ txHash: string; propId: number }>("/zama/proposals/transfer", { to, amount, token }).then(r => r.data),

  proposeSetThreshold: (newThreshold: number) =>
    api
      .post<{ txHash: string; propId: number }>("/zama/proposals/set-threshold", { newThreshold })
      .then(r => r.data),

  proposeRemoveSigner: (idx: number) =>
    api.post<{ txHash: string; propId: number }>("/zama/proposals/remove-signer", { idx }).then(r => r.data),

  proposeAddSigner: (encNewOwner: string, proof: string) =>
    api.post<{ txHash: string; propId: number }>("/zama/proposals/add-signer", { encNewOwner, proof }).then(r => r.data),

  approve: (id: number, encSigner: string, proof: string) =>
    api.post(`/zama/proposals/${id}/approve`, { encSigner, proof }).then(r => r.data),

  execute: (id: number) => api.post<{ txHash: string; ready: boolean }>(`/zama/proposals/${id}/execute`).then(r => r.data),
};
