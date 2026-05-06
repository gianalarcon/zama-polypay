import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { keccak256 } from "viem";
import { useWalletClient } from "wagmi";
import { userKeys } from "../api";
import { useIdentityStore } from "~~/services/store";
import { formatErrorMessage } from "~~/utils/formatError";

/**
 * Polypay-Zama auth flow.
 *
 * Drops the original Noir ZK + JWT login. The "membership ID" is a
 * 20-byte commitment deterministically derived from a wallet signature
 * over a fixed identity message:
 *
 *   secret     = keccak256(signMessage("Polypay-Zama identity v1"))
 *   commitment = keccak256(secret)[-20:]   // address-shaped, fits eaddress
 *
 * The same wallet always produces the same commitment, so the user can
 * close the tab and re-derive on next connect — no backup needed. The
 * commitment is what we register on-chain (encrypted) and what the
 * backend stores in the AccountSigner table; the wallet address itself
 * never appears in the DB or in any encrypted ciphertext.
 */
export const useAuth = () => {
  const { data: walletClient } = useWalletClient();
  const {
    isAuthenticated,
    accessToken,
    commitment,
    setIdentity,
    setTokens,
    logout: storeLogout,
  } = useIdentityStore();

  const queryClient = useQueryClient();

  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (): Promise<boolean> => {
    if (!walletClient) {
      setError("Connect a wallet first.");
      return false;
    }

    setIsLoggingIn(true);
    setError(null);

    try {
      const [walletAddress] = await walletClient.getAddresses();
      const signature = await walletClient.signMessage({
        account: walletAddress,
        message: "Polypay-Zama identity v1",
      });

      const secret = keccak256(signature);
      const commitmentHex = `0x${keccak256(secret as `0x${string}`).slice(-40)}`;

      setIdentity(secret, commitmentHex);
      // Drop JWT — keep useIdentityStore.isAuthenticated true so existing
      // gates (sidebar, transfer guards) flip on.
      setTokens("zama-wallet-session", "zama-wallet-session");

      queryClient.invalidateQueries({ queryKey: userKeys.me });
      return true;
    } catch (err: any) {
      setError(formatErrorMessage(err, "Failed to derive commitment"));
      return false;
    } finally {
      setIsLoggingIn(false);
    }
  }, [walletClient, setIdentity, setTokens, queryClient]);

  const refresh = useCallback(async (): Promise<boolean> => {
    // No-op: the session is derived locally from the wallet signature, there
    // is no refresh flow against an external auth server.
    return Boolean(accessToken);
  }, [accessToken]);

  const logout = useCallback(() => {
    storeLogout();
    queryClient.invalidateQueries({ queryKey: userKeys.me });
  }, [storeLogout, queryClient]);

  return {
    isAuthenticated,
    isLoading: isLoggingIn,
    error,
    commitment,
    login,
    refresh,
    logout,
  };
};
