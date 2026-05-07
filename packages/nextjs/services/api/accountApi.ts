import { apiClient } from "./apiClient";
import { API_ENDPOINTS, Account, CreateAccountBatchDto, CreateAccountDto, UpdateAccountDto } from "@polypay/shared";

export const accountApi = {
  create: async (dto: CreateAccountDto): Promise<Account> => {
    const { data } = await apiClient.post<Account>(API_ENDPOINTS.accounts.base, dto);
    return data;
  },

  createBatch: async (dto: CreateAccountBatchDto): Promise<Account[]> => {
    const { data } = await apiClient.post<Account[]>(`${API_ENDPOINTS.accounts.base}/batch`, dto);
    return data;
  },

  getByAddress: async (address: string): Promise<Account> => {
    // Polypay-Zama backend exposes the multisig account at /api/zama/accounts/:address.
    const { data } = await apiClient.get<Account>(`/api/zama/accounts/${address}`);
    return data;
  },

  update: async (address: string, dto: UpdateAccountDto): Promise<Account> => {
    // Polypay-Zama backend exposes the multisig account at /api/zama/accounts/:address.
    const { data } = await apiClient.patch<Account>(`/api/zama/accounts/${address}`, dto);
    return data;
  },
};
