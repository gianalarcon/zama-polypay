"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import { sepolia } from "wagmi/chains";
import { ProposalState, RelayerInfo, WalletState, zamaApi } from "~~/lib/api";
import { encryptAddressFor, encryptAddressesFor } from "~~/lib/fhevm";

type Status = { kind: "info" | "success" | "error"; text: string } | null;

export default function DemoPage() {
  const { address, isConnected } = useAccount();

  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  // Initialize form
  const [initOwners, setInitOwners] = useState("");
  const [initThreshold, setInitThreshold] = useState(3);

  // Transfer form
  const [tferTo, setTferTo] = useState("");
  const [tferAmount, setTferAmount] = useState("");
  const [tferToken, setTferToken] = useState("0x0000000000000000000000000000000000000000");

  // SetThreshold / AddSigner / RemoveSigner
  const [newThreshold, setNewThreshold] = useState(3);
  const [newOwnerAddr, setNewOwnerAddr] = useState("");
  const [removeIdx, setRemoveIdx] = useState(0);

  const multisigBalance = useBalance({
    address: relayer?.multisig as `0x${string}` | undefined,
    chainId: sepolia.id,
    query: { enabled: Boolean(relayer?.multisig), refetchInterval: 10_000 },
  });

  async function refresh() {
    try {
      const [r, w] = await Promise.all([zamaApi.getRelayerInfo(), zamaApi.getWallet()]);
      setRelayer(r);
      setWallet(w);

      const ids: number[] = [];
      for (let i = 0; i < w.nextProposalId; i++) ids.push(i);
      const list = await Promise.all(ids.map(id => zamaApi.getProposal(id).catch(() => null)));
      setProposals(list.filter((p): p is ProposalState => p !== null));
    } catch (e: any) {
      setStatus({ kind: "error", text: `Refresh failed: ${e?.message ?? e}` });
    }
  }

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, []);

  async function withBusy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    if (busy) return;
    setBusy(true);
    setStatus({ kind: "info", text: label });
    try {
      const result = await fn();
      setStatus({ kind: "success", text: `${label} ok` });
      void refresh();
      return result;
    } catch (e: any) {
      setStatus({ kind: "error", text: `${label} failed: ${e?.response?.data?.message ?? e?.message ?? e}` });
    } finally {
      setBusy(false);
    }
  }

  async function handleInitialize() {
    if (!relayer) return;
    const owners = initOwners
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (owners.length === 0) {
      setStatus({ kind: "error", text: "no owners provided" });
      return;
    }
    await withBusy("initialize", async () => {
      const { handles, proof } = await encryptAddressesFor(relayer.multisig, relayer.relayer, owners);
      return zamaApi.initialize(handles, proof, initThreshold);
    });
  }

  async function handleProposeTransfer() {
    await withBusy("proposeTransfer", () => zamaApi.proposeTransfer(tferTo, tferAmount, tferToken));
  }

  async function handleProposeSetThreshold() {
    await withBusy(`proposeSetThreshold(${newThreshold})`, () => zamaApi.proposeSetThreshold(newThreshold));
  }

  async function handleProposeAddSigner() {
    if (!relayer || !newOwnerAddr) return;
    await withBusy("proposeAddSigner", async () => {
      const { handle, proof } = await encryptAddressFor(relayer.multisig, relayer.relayer, newOwnerAddr);
      return zamaApi.proposeAddSigner(handle, proof);
    });
  }

  async function handleProposeRemoveSigner() {
    await withBusy(`proposeRemoveSigner(${removeIdx})`, () => zamaApi.proposeRemoveSigner(removeIdx));
  }

  async function handleApprove(propId: number) {
    if (!relayer || !address) return;
    await withBusy(`approve #${propId}`, async () => {
      const { handle, proof } = await encryptAddressFor(relayer.multisig, relayer.relayer, address);
      return zamaApi.approve(propId, handle, proof);
    });
  }

  async function handleExecute(propId: number) {
    await withBusy(`execute #${propId}`, () => zamaApi.execute(propId));
  }

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Polypay-Zama</h1>
          <p className="text-zinc-400 text-sm">Confidential multisig payroll on Sepolia (FHE)</p>
        </div>
        <ConnectButton />
      </header>

      {status && (
        <div
          className={`rounded border p-3 text-sm ${
            status.kind === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-200"
              : status.kind === "success"
                ? "border-green-500/40 bg-green-500/10 text-green-200"
                : "border-blue-500/40 bg-blue-500/10 text-blue-200"
          }`}
        >
          {status.text}
        </div>
      )}

      <Section title="Backend / Relayer">
        <KV label="Relayer EOA" value={relayer?.relayer ?? "—"} />
        <KV label="Multisig" value={relayer?.multisig ?? "—"} />
        <KV label="Chain" value={relayer ? `Sepolia (${relayer.chainId})` : "—"} />
      </Section>

      <Section title="Multisig State">
        <KV label="Initialized" value={wallet ? String(wallet.initialized) : "—"} />
        <KV label="Threshold" value={wallet ? String(wallet.threshold) : "—"} />
        <KV
          label="Owners (active / total)"
          value={wallet ? `${wallet.activeOwnerCount} / ${wallet.ownersLength}` : "—"}
        />
        <KV label="Proposals" value={wallet ? String(wallet.nextProposalId) : "—"} />
        <KV
          label="Multisig ETH balance"
          value={multisigBalance.data ? `${formatEther(multisigBalance.data.value)} ETH` : "—"}
        />
        <button
          className="mt-2 rounded border border-zinc-700 px-3 py-1 text-sm hover:bg-zinc-800"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </Section>

      {!wallet?.initialized && (
        <Section title="Initialize Multisig">
          <p className="text-xs text-zinc-400">
            Encrypted owner addresses are bound to (multisig contract, relayer EOA). Anyone can call initialize once.
          </p>
          <textarea
            className="w-full rounded bg-zinc-900 p-2 text-sm font-mono"
            rows={4}
            placeholder="0xowner1, 0xowner2, ..."
            value={initOwners}
            onChange={e => setInitOwners(e.target.value)}
          />
          <div className="flex items-center gap-2">
            <label className="text-sm">Threshold:</label>
            <input
              type="number"
              min={1}
              max={32}
              className="w-20 rounded bg-zinc-900 p-1 text-sm"
              value={initThreshold}
              onChange={e => setInitThreshold(Number(e.target.value))}
            />
            <button
              disabled={busy}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              onClick={() => void handleInitialize()}
            >
              Initialize
            </button>
          </div>
        </Section>
      )}

      {wallet?.initialized && (
        <>
          <Section title="Propose Transfer">
            <Field label="Recipient" value={tferTo} onChange={setTferTo} placeholder="0xrecipient" />
            <Field
              label="Amount (wei or USDC base units)"
              value={tferAmount}
              onChange={setTferAmount}
              placeholder="100000000000000000"
            />
            <Field label="Token (0x0000…0 for ETH)" value={tferToken} onChange={setTferToken} />
            <button
              disabled={busy}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              onClick={() => void handleProposeTransfer()}
            >
              Propose Transfer
            </button>
          </Section>

          <Section title="Propose Set Threshold">
            <div className="flex items-center gap-2">
              <label className="text-sm">New threshold:</label>
              <input
                type="number"
                min={1}
                max={32}
                className="w-20 rounded bg-zinc-900 p-1 text-sm"
                value={newThreshold}
                onChange={e => setNewThreshold(Number(e.target.value))}
              />
              <button
                disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                onClick={() => void handleProposeSetThreshold()}
              >
                Propose
              </button>
            </div>
          </Section>

          <Section title="Propose Add Signer">
            <p className="text-xs text-zinc-400">Owner address gets encrypted client-side before submission.</p>
            <Field label="New owner address" value={newOwnerAddr} onChange={setNewOwnerAddr} placeholder="0x..." />
            <button
              disabled={busy || !newOwnerAddr}
              className="rounded bg-blue-600 px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              onClick={() => void handleProposeAddSigner()}
            >
              Propose Add Signer
            </button>
          </Section>

          <Section title="Propose Remove Signer">
            <p className="text-xs text-zinc-400">Soft-removes the owner at index `idx` (encrypted address remains, isActive[idx]=false).</p>
            <div className="flex items-center gap-2">
              <label className="text-sm">Owner index:</label>
              <input
                type="number"
                min={0}
                max={wallet ? wallet.ownersLength - 1 : 0}
                className="w-20 rounded bg-zinc-900 p-1 text-sm"
                value={removeIdx}
                onChange={e => setRemoveIdx(Number(e.target.value))}
              />
              <button
                disabled={busy}
                className="rounded bg-blue-600 px-3 py-1 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                onClick={() => void handleProposeRemoveSigner()}
              >
                Propose
              </button>
            </div>
          </Section>
        </>
      )}

      {wallet?.initialized && (
        <Section title="Proposals">
          {proposals.length === 0 && <p className="text-sm text-zinc-400">none yet</p>}
          {proposals.map(p => (
            <div key={p.id} className="rounded border border-zinc-700 p-3 space-y-1">
              <div className="font-mono text-sm">
                #{p.id} <span className="text-zinc-400">/ {p.ptype}</span>
              </div>
              {p.details && (
                <pre className="text-xs text-zinc-400 whitespace-pre-wrap break-all">
                  {JSON.stringify(p.details, null, 2)}
                </pre>
              )}
              <div className="text-xs text-zinc-400">
                attempts={p.approvalAttempts} pending={String(p.decryptionPending)} executed={String(p.executed)} ready=
                {String(p.ready)}
              </div>
              <div className="flex gap-2">
                <button
                  disabled={busy || !isConnected || p.executed}
                  className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                  onClick={() => void handleApprove(p.id)}
                >
                  Approve as {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "?"}
                </button>
                <button
                  disabled={busy || p.executed || p.decryptionPending}
                  className="rounded bg-purple-600 px-3 py-1 text-xs font-medium hover:bg-purple-700 disabled:opacity-50"
                  onClick={() => void handleExecute(p.id)}
                >
                  Execute (request + finalize)
                </button>
              </div>
            </div>
          ))}
        </Section>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm border-b border-zinc-800 pb-1">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-zinc-400">{label}</label>
      <input
        className="w-full rounded bg-zinc-900 p-2 text-sm font-mono"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
