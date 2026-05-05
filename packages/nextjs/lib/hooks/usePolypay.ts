"use client";

import { useCallback, useEffect, useState } from "react";
import { ProposalState, RelayerInfo, WalletState, zamaApi } from "../api";
import { encryptAddresses } from "../fhevm";

export type Status = { kind: "info" | "success" | "error"; text: string } | null;

const REFRESH_INTERVAL_MS = 5_000;

export function usePolypay() {
  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [r, w] = await Promise.all([zamaApi.getRelayerInfo(), zamaApi.getWallet()]);
      setRelayer(r);
      setWallet(w);
      const ids = Array.from({ length: w.nextProposalId }, (_, i) => i);
      const list = await Promise.all(ids.map(id => zamaApi.getProposal(id).catch(() => null)));
      setProposals(list.filter((p): p is ProposalState => p !== null));
    } catch (e: any) {
      setStatus({ kind: "error", text: `Refresh failed: ${e?.message ?? e}` });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  const withBusy = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
      if (busy) return undefined;
      setBusy(true);
      setStatus({ kind: "info", text: label });
      try {
        const result = await fn();
        setStatus({ kind: "success", text: `${label} ok` });
        void refresh();
        return result;
      } catch (e: any) {
        setStatus({ kind: "error", text: `${label} failed: ${e?.response?.data?.message ?? e?.message ?? e}` });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [busy, refresh],
  );

  // ---- Actions (each one-liner so caller code stays declarative) ----

  const initialize = (owners: string[], threshold: number) =>
    withBusy("initialize", async () => {
      if (!relayer) throw new Error("relayer not loaded");
      const { handles, proof } = await encryptAddresses(relayer.multisig, relayer.relayer, owners);
      return zamaApi.initialize(handles, proof, threshold);
    });

  const proposeTransfer = (to: string, amount: string, token: string) =>
    withBusy("proposeTransfer", () => zamaApi.proposeTransfer(to, amount, token));

  const proposeSetThreshold = (newThreshold: number) =>
    withBusy(`proposeSetThreshold(${newThreshold})`, () => zamaApi.proposeSetThreshold(newThreshold));

  const proposeAddSigner = (newOwnerAddr: string) =>
    withBusy("proposeAddSigner", async () => {
      if (!relayer) throw new Error("relayer not loaded");
      const { handles, proof } = await encryptAddresses(relayer.multisig, relayer.relayer, [newOwnerAddr]);
      return zamaApi.proposeAddSigner(handles[0], proof);
    });

  const proposeRemoveSigner = (idx: number) =>
    withBusy(`proposeRemoveSigner(${idx})`, () => zamaApi.proposeRemoveSigner(idx));

  const approve = (propId: number, signerAddr: string) =>
    withBusy(`approve #${propId}`, async () => {
      if (!relayer) throw new Error("relayer not loaded");
      const { handles, proof } = await encryptAddresses(relayer.multisig, relayer.relayer, [signerAddr]);
      return zamaApi.approve(propId, handles[0], proof);
    });

  const execute = (propId: number) => withBusy(`execute #${propId}`, () => zamaApi.execute(propId));

  return {
    relayer,
    wallet,
    proposals,
    status,
    busy,
    refresh,
    actions: { initialize, proposeTransfer, proposeSetThreshold, proposeAddSigner, proposeRemoveSigner, approve, execute },
  };
}
