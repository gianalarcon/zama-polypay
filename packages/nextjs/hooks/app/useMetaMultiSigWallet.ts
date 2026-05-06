import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccountStore } from "~~/services/store/useAccountStore";

/**
 * Polypay-Zama: the original useMetaMultiSigWallet read directly from the
 * Polypay MetaMultiSigWallet contract via wagmi (commitments + threshold).
 * In Zama those values are either encrypted on-chain (commitments) or
 * already known off-chain via the AccountSigner table. We resolve every
 * read against the active account in the Zustand store, so consumers like
 * DashboardContainer / TransactionRow keep working unchanged.
 */

export const accountContractKeys = {
  all: ["accountContract"] as const,
  commitments: (address: string) => [...accountContractKeys.all, "commitments", address] as const,
  threshold: (address: string) => [...accountContractKeys.all, "threshold", address] as const,
};

export const useMetaMultiSigWallet = () => {
  const { currentAccount } = useAccountStore();
  return useMemo(() => {
    if (!currentAccount?.address) return null;
    return { address: currentAccount.address as `0x${string}` };
  }, [currentAccount?.address]);
};

export const useMetaMultiSigWalletInfo = () => {
  const { currentAccount } = useAccountStore();
  return {
    address: currentAccount?.address as `0x${string}` | undefined,
    abi: [] as const,
  };
};

/** Returns the list of signer commitments registered for the active account. */
export const useWalletCommitments = () => {
  const { currentAccount } = useAccountStore();
  const address = currentAccount?.address || "";
  return useQuery({
    queryKey: accountContractKeys.commitments(address),
    queryFn: async () => {
      const signers = (currentAccount as any)?.signers ?? [];
      return signers.map((s: { commitment: string }) => s.commitment);
    },
    enabled: !!address,
  });
};

/**
 * Returns the threshold (number of approvals required) for the active
 * account. Reads from the Zustand store so the value is available
 * synchronously without any network roundtrip — this matters because
 * TransactionRow gates the Execute button on `walletThreshold` and a
 * stale undefined would force a re-render cycle before the button
 * appears once approvals have hit the threshold.
 */
export const useWalletThreshold = () => {
  const { currentAccount } = useAccountStore();
  const data = BigInt(currentAccount?.threshold ?? 0);
  return { data, isLoading: false } as { data: bigint; isLoading: boolean };
};

export const useWalletSignersCount = () => {
  const { currentAccount } = useAccountStore();
  const signers = (currentAccount as any)?.signers ?? [];
  return {
    data: BigInt(signers.length),
    isLoading: false,
  } as any;
};
