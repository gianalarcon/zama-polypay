"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ArrowRight, CheckCircle2, Clock3, KeyRound, Lock, Plus, Send, Shield, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { formatEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import { Button } from "~~/components/ui/button";
import { Input } from "~~/components/ui/input";
import { Skeleton } from "~~/components/ui/skeleton";
import type { ProposalState } from "~~/lib/api";
import { CHAIN_ID } from "~~/lib/constants";
import { usePolypay } from "~~/lib/hooks/usePolypay";

export default function PolypayZamaPage() {
  const { address } = useAccount();
  const { relayer, wallet, proposals, status, busy, refresh, actions } = usePolypay();

  const multisigBalance = useBalance({
    address: relayer?.multisig as `0x${string}` | undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(relayer?.multisig), refetchInterval: 10_000 },
  });

  return (
    <main className="min-h-screen bg-gradient-to-br from-violet-50 via-pink-50 to-blue-50 text-grey-1000">
      <Header />

      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {status && <StatusBanner kind={status.kind} text={status.text} />}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <RelayerCard relayer={relayer} />
          <StateCard
            wallet={wallet}
            balance={multisigBalance.data ? formatEther(multisigBalance.data.value) : null}
            onRefresh={refresh}
          />
          <PrivacyCard />
        </div>

        {!wallet?.initialized && (
          <InitializeCard busy={busy} onSubmit={(owners, t) => void actions.initialize(owners, t)} />
        )}

        {wallet?.initialized && (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <TransferCard busy={busy} onSubmit={(to, amt, tok) => void actions.proposeTransfer(to, amt, tok)} />
              <GovernanceCard
                busy={busy}
                ownersLength={wallet.ownersLength}
                onProposeSetThreshold={t => void actions.proposeSetThreshold(t)}
                onProposeAddSigner={addr => void actions.proposeAddSigner(addr)}
                onProposeRemoveSigner={idx => void actions.proposeRemoveSigner(idx)}
              />
            </div>

            <ProposalsSection
              proposals={proposals}
              busy={busy}
              connectedAddress={address as `0x${string}` | undefined}
              onApprove={id => address && void actions.approve(id, address)}
              onExecute={id => void actions.execute(id)}
            />
          </>
        )}
      </div>
    </main>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="border-b border-grey-200 bg-white/70 backdrop-blur sticky top-0 z-30">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-gradient-to-br from-pink-400 to-violet-500 flex items-center justify-center">
            <Shield className="size-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-xl leading-tight">Polypay-Zama</h1>
            <p className="text-xs text-grey-700">Confidential multisig payroll · Sepolia · FHE</p>
          </div>
        </div>
        <ConnectButton />
      </div>
    </header>
  );
}

// ─── Status banner ───────────────────────────────────────────────────────────

function StatusBanner({ kind, text }: { kind: "info" | "success" | "error"; text: string }) {
  const styles = {
    info: "border-blue-100 bg-blue-50 text-blue-600",
    success: "border-green-200 bg-green-50 text-green-700",
    error: "border-red-200 bg-red-50 text-red-700",
  } as const;
  return <div className={`rounded-xl border-2 px-4 py-3 text-sm font-medium ${styles[kind]}`}>{text}</div>;
}

// ─── Cards ───────────────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-grey-200 bg-white shadow-center p-6 ${className}`}>
      {children}
    </section>
  );
}

function CardTitle({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <Icon className="size-5 text-violet-300" />
      <h2 className="text-lg font-semibold">{children}</h2>
    </div>
  );
}

function StatRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center text-sm py-1.5 border-b border-grey-100 last:border-0">
      <span className="text-grey-700">{label}</span>
      <span className={mono ? "font-mono text-xs" : "font-semibold"}>{value ?? <Skeleton className="h-4 w-20" />}</span>
    </div>
  );
}

// ─── Relayer / State / Privacy ───────────────────────────────────────────────

function RelayerCard({ relayer }: { relayer: { relayer: string; multisig: string; chainId: number } | null }) {
  return (
    <Card>
      <CardTitle icon={KeyRound}>Backend / Relayer</CardTitle>
      <StatRow label="Relayer EOA" value={relayer ? short(relayer.relayer) : null} mono />
      <StatRow label="Multisig" value={relayer ? short(relayer.multisig) : null} mono />
      <StatRow label="Chain" value={relayer ? `Sepolia (${relayer.chainId})` : null} />
    </Card>
  );
}

function StateCard({
  wallet,
  balance,
  onRefresh,
}: {
  wallet: { initialized: boolean; threshold: number; ownersLength: number; activeOwnerCount: number; nextProposalId: number } | null;
  balance: string | null;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users className="size-5 text-violet-300" />
          <h2 className="text-lg font-semibold">Multisig State</h2>
        </div>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <StatRow
        label="Initialized"
        value={
          wallet ? (
            wallet.initialized ? (
              <span className="text-green-600 inline-flex items-center gap-1">
                <CheckCircle2 className="size-4" /> yes
              </span>
            ) : (
              <span className="text-grey-700">no</span>
            )
          ) : null
        }
      />
      <StatRow label="Threshold" value={wallet ? wallet.threshold : null} />
      <StatRow label="Owners" value={wallet ? `${wallet.activeOwnerCount} / ${wallet.ownersLength} active` : null} />
      <StatRow label="Proposals" value={wallet ? wallet.nextProposalId : null} />
      <StatRow label="ETH balance" value={balance !== null ? `${balance} ETH` : null} />
    </Card>
  );
}

function PrivacyCard() {
  return (
    <Card className="bg-gradient-to-br from-violet-25 via-pink-25 to-white">
      <CardTitle icon={Lock}>What's hidden</CardTitle>
      <ul className="text-sm space-y-2">
        <li className="flex gap-2">
          <CheckCircle2 className="size-4 text-violet-300 shrink-0 mt-0.5" />
          <span>Owner addresses (encrypted set on-chain)</span>
        </li>
        <li className="flex gap-2">
          <CheckCircle2 className="size-4 text-violet-300 shrink-0 mt-0.5" />
          <span>Which owner approved each proposal</span>
        </li>
        <li className="flex gap-2">
          <CheckCircle2 className="size-4 text-violet-300 shrink-0 mt-0.5" />
          <span>True approval count until threshold check</span>
        </li>
      </ul>
    </Card>
  );
}

// ─── Initialize ──────────────────────────────────────────────────────────────

function InitializeCard({ busy, onSubmit }: { busy: boolean; onSubmit: (owners: string[], threshold: number) => void }) {
  const [ownersText, setOwnersText] = useState("");
  const [threshold, setThreshold] = useState(3);
  return (
    <Card>
      <CardTitle icon={Plus}>Initialize Multisig</CardTitle>
      <p className="text-sm text-grey-700 mb-3">
        Encrypted owner addresses bind to (multisig contract, relayer EOA). Anyone can call once.
      </p>
      <textarea
        rows={4}
        placeholder="0xowner1, 0xowner2, ..."
        value={ownersText}
        onChange={e => setOwnersText(e.target.value)}
        className="w-full rounded-md border border-grey-200 p-3 text-sm font-mono mb-3 focus:border-black focus:ring-2 focus:ring-black/30 outline-none"
      />
      <div className="flex items-center gap-3">
        <label className="text-sm text-grey-700">Threshold:</label>
        <Input
          type="number"
          min={1}
          max={32}
          value={threshold}
          onChange={e => setThreshold(Number(e.target.value))}
          className="w-20"
        />
        <Button
          disabled={busy}
          onClick={() => {
            const owners = ownersText.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
            if (owners.length) onSubmit(owners, threshold);
          }}
        >
          Initialize <ArrowRight className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

// ─── Transfer ────────────────────────────────────────────────────────────────

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

function TransferCard({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (to: string, amount: string, token: string) => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState(ZERO_ADDR);
  return (
    <Card>
      <CardTitle icon={Send}>Propose Transfer</CardTitle>
      <Field label="Recipient" value={to} onChange={setTo} placeholder="0x..." />
      <Field label="Amount (wei or USDC base units)" value={amount} onChange={setAmount} placeholder="100000000000000000" />
      <Field label="Token (0x000...0 for ETH)" value={token} onChange={setToken} />
      <Button className="mt-3" disabled={busy} onClick={() => onSubmit(to, amount, token)}>
        Propose Transfer <ArrowRight className="size-4" />
      </Button>
    </Card>
  );
}

// ─── Governance: SetThreshold + AddSigner + RemoveSigner ────────────────────

function GovernanceCard({
  busy,
  ownersLength,
  onProposeSetThreshold,
  onProposeAddSigner,
  onProposeRemoveSigner,
}: {
  busy: boolean;
  ownersLength: number;
  onProposeSetThreshold: (t: number) => void;
  onProposeAddSigner: (addr: string) => void;
  onProposeRemoveSigner: (idx: number) => void;
}) {
  const [tab, setTab] = useState<"threshold" | "add" | "remove">("threshold");
  const [threshold, setThreshold] = useState(3);
  const [newOwner, setNewOwner] = useState("");
  const [removeIdx, setRemoveIdx] = useState(0);

  return (
    <Card>
      <CardTitle icon={Users}>Governance</CardTitle>
      <div className="flex gap-1 mb-4 p-1 bg-grey-100 rounded-md">
        {(["threshold", "add", "remove"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded ${tab === t ? "bg-white shadow-sm" : "text-grey-700"}`}
          >
            {t === "threshold" ? "Threshold" : t === "add" ? "Add Signer" : "Remove Signer"}
          </button>
        ))}
      </div>

      {tab === "threshold" && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-grey-700">New threshold:</label>
          <Input
            type="number"
            min={1}
            max={32}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-20"
          />
          <Button disabled={busy} onClick={() => onProposeSetThreshold(threshold)}>
            Propose
          </Button>
        </div>
      )}

      {tab === "add" && (
        <div className="space-y-2">
          <p className="text-xs text-grey-700">Address gets encrypted client-side before submission.</p>
          <Field label="New owner address" value={newOwner} onChange={setNewOwner} placeholder="0x..." />
          <Button disabled={busy || !newOwner} onClick={() => onProposeAddSigner(newOwner)}>
            <Plus className="size-4" /> Propose Add Signer
          </Button>
        </div>
      )}

      {tab === "remove" && (
        <div className="flex items-center gap-3">
          <label className="text-sm text-grey-700">Owner index:</label>
          <Input
            type="number"
            min={0}
            max={Math.max(0, ownersLength - 1)}
            value={removeIdx}
            onChange={e => setRemoveIdx(Number(e.target.value))}
            className="w-20"
          />
          <Button disabled={busy} variant="destructive" onClick={() => onProposeRemoveSigner(removeIdx)}>
            <UserMinus className="size-4" /> Propose Remove
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── Proposal list ───────────────────────────────────────────────────────────

function ProposalsSection({
  proposals,
  busy,
  connectedAddress,
  onApprove,
  onExecute,
}: {
  proposals: ProposalState[];
  busy: boolean;
  connectedAddress: `0x${string}` | undefined;
  onApprove: (propId: number) => void;
  onExecute: (propId: number) => void;
}) {
  return (
    <Card>
      <CardTitle icon={Clock3}>Proposals ({proposals.length})</CardTitle>
      {proposals.length === 0 && <p className="text-sm text-grey-700">none yet — create a proposal above.</p>}
      <div className="space-y-3">
        {proposals.map(p => (
          <ProposalRow
            key={p.id}
            proposal={p}
            busy={busy}
            connectedAddress={connectedAddress}
            onApprove={() => onApprove(p.id)}
            onExecute={() => onExecute(p.id)}
          />
        ))}
      </div>
    </Card>
  );
}

function ProposalRow({
  proposal: p,
  busy,
  connectedAddress,
  onApprove,
  onExecute,
}: {
  proposal: ProposalState;
  busy: boolean;
  connectedAddress: `0x${string}` | undefined;
  onApprove: () => void;
  onExecute: () => void;
}) {
  const status = p.executed
    ? p.ready
      ? { label: "Executed", cls: "bg-green-100 text-green-700" }
      : { label: "Rejected", cls: "bg-red-100 text-red-700" }
    : p.decryptionPending
      ? { label: "Decrypting…", cls: "bg-blue-100 text-blue-600" }
      : { label: "Pending", cls: "bg-yellow-100 text-yellow-700" };

  return (
    <div className="rounded-xl border border-grey-200 p-4 hover:border-violet-300 transition">
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-xs text-grey-700">#{p.id}</span>
            <span className="font-semibold text-sm">{p.ptype}</span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${status.cls}`}>{status.label}</span>
          </div>
          <ProposalDetails details={p.details} />
        </div>
        <span className="text-xs text-grey-700">{p.approvalAttempts} attempts</span>
      </div>
      <div className="flex gap-2 mt-3">
        <Button
          variant="outline"
          size="sm"
          disabled={busy || !connectedAddress || p.executed || p.decryptionPending}
          onClick={onApprove}
        >
          Approve as {connectedAddress ? short(connectedAddress) : "?"}
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy || p.executed || p.decryptionPending}
          onClick={onExecute}
        >
          Execute <ArrowRight className="size-3" />
        </Button>
      </div>
    </div>
  );
}

function ProposalDetails({ details }: { details: ProposalState["details"] }) {
  if (!details) return null;
  if ("to" in details) {
    return (
      <p className="text-xs text-grey-700">
        Send <span className="font-mono">{details.amount}</span> base units of {short(details.token)} → {short(details.to)}
      </p>
    );
  }
  if ("newThreshold" in details) {
    return (
      <p className="text-xs text-grey-700">
        Set threshold to <span className="font-semibold">{details.newThreshold}</span>
      </p>
    );
  }
  if ("ownerIndex" in details) {
    return (
      <p className="text-xs text-grey-700">
        Remove owner at index <span className="font-semibold">#{details.ownerIndex}</span>
      </p>
    );
  }
  if ("encryptedOwnerHandle" in details) {
    return <p className="text-xs text-grey-700 font-mono">Add encrypted owner ({short(details.encryptedOwnerHandle)})</p>;
  }
  return null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
    <div className="space-y-1 mb-2">
      <label className="text-xs text-grey-700">{label}</label>
      <Input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
    </div>
  );
}

function short(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
