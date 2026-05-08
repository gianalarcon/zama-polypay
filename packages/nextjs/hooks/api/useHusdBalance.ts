import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const api = axios.create({ baseURL: API_BASE });

const PENDING_POLL_MS = 5_000;
const PENDING_MAX_MS = 90_000;

/**
 * Reads the plaintext hUSD balance of an address through the relayer-side
 * decrypt endpoint (`/zama/husd/balance/:address`). The relayer holds an FHE
 * ACL grant on every hUSD balance via HiddenERC20._grantBalanceACL, so this
 * call returns the cleartext while still keeping the value off-limits to
 * etherscan watchers.
 *
 * `markPending(currentBalance)` snapshots the balance at the time of an
 * action (mint/deposit) and polls every PENDING_POLL_MS until either:
 *   - balance differs from the snapshot (success), or
 *   - PENDING_MAX_MS elapses (safety fallback for failed/silent tx).
 * Components observe `isPending` to render an "updating…" hint that
 * disappears precisely when the new balance lands — no hardcoded delay.
 */
export function useHusdBalance(address: string | null | undefined, refreshMs = 30_000) {
  const [balance, setBalance] = useState<string | null>("0");
  const [isLoading, setIsLoading] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const pendingRef = useRef<{ baseline: string | null; pollerId: any; safetyId: any } | null>(null);

  const fetchOnce = useCallback(async (): Promise<string | null> => {
    if (!address) return null;
    try {
      const { data } = await api.get<{ balance: string }>(`/zama/husd/balance/${address}`);
      return data.balance;
    } catch {
      return null;
    }
  }, [address]);

  const refresh = useCallback(async () => {
    if (!address) {
      setBalance("0");
      return;
    }
    setIsLoading(true);
    const next = await fetchOnce();
    if (next !== null) setBalance(next);
    setIsLoading(false);

    // If we're inside a pending window, see if the value diverged from the
    // baseline; if so, exit the pending state immediately.
    if (next !== null && pendingRef.current && next !== pendingRef.current.baseline) {
      clearPending();
    }
  }, [address, fetchOnce]);

  const clearPending = useCallback(() => {
    if (!pendingRef.current) return;
    if (pendingRef.current.pollerId) clearInterval(pendingRef.current.pollerId);
    if (pendingRef.current.safetyId) clearTimeout(pendingRef.current.safetyId);
    pendingRef.current = null;
    setIsPending(false);
  }, []);

  /** Mark the next balance change as the resolution of an in-flight tx. */
  const markPending = useCallback(() => {
    clearPending();
    const baseline = balance;
    setIsPending(true);
    const pollerId = setInterval(async () => {
      const next = await fetchOnce();
      if (next === null) return;
      setBalance(next);
      if (next !== baseline) {
        clearPending();
      }
    }, PENDING_POLL_MS);
    const safetyId = setTimeout(() => {
      clearPending();
    }, PENDING_MAX_MS);
    pendingRef.current = { baseline, pollerId, safetyId };
  }, [balance, fetchOnce, clearPending]);

  useEffect(() => {
    refresh();
    if (!refreshMs) return;
    const id = setInterval(refresh, refreshMs);
    return () => clearInterval(id);
  }, [refresh, refreshMs]);

  // Cleanup pending on unmount.
  useEffect(() => {
    return () => clearPending();
  }, [clearPending]);

  return { balance, isLoading, isPending, refresh, markPending };
}
