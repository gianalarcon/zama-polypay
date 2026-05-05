"use client";

import { useState } from "react";
import { Field, PrimaryButton, Section } from "./ui";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function TransferForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (to: string, amount: string, token: string) => void;
}) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState(ZERO_ADDRESS);
  return (
    <Section title="Propose Transfer">
      <Field label="Recipient" value={to} onChange={setTo} placeholder="0xrecipient" />
      <Field
        label="Amount (wei or USDC base units)"
        value={amount}
        onChange={setAmount}
        placeholder="100000000000000000"
      />
      <Field label="Token (0x0000…0 for ETH)" value={token} onChange={setToken} />
      <PrimaryButton onClick={() => onSubmit(to, amount, token)} disabled={busy}>
        Propose Transfer
      </PrimaryButton>
    </Section>
  );
}

export function SetThresholdForm({ busy, onSubmit }: { busy: boolean; onSubmit: (newThreshold: number) => void }) {
  const [newThreshold, setNewThreshold] = useState(3);
  return (
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
        <PrimaryButton onClick={() => onSubmit(newThreshold)} disabled={busy}>
          Propose
        </PrimaryButton>
      </div>
    </Section>
  );
}

export function AddSignerForm({ busy, onSubmit }: { busy: boolean; onSubmit: (addr: string) => void }) {
  const [addr, setAddr] = useState("");
  return (
    <Section title="Propose Add Signer">
      <p className="text-xs text-zinc-400">Owner address gets encrypted client-side before submission.</p>
      <Field label="New owner address" value={addr} onChange={setAddr} placeholder="0x..." />
      <PrimaryButton onClick={() => onSubmit(addr)} disabled={busy || !addr}>
        Propose Add Signer
      </PrimaryButton>
    </Section>
  );
}

export function RemoveSignerForm({
  busy,
  maxIdx,
  onSubmit,
}: {
  busy: boolean;
  maxIdx: number;
  onSubmit: (idx: number) => void;
}) {
  const [idx, setIdx] = useState(0);
  return (
    <Section title="Propose Remove Signer">
      <p className="text-xs text-zinc-400">
        Soft-removes the owner at index `idx` (encrypted address remains, isActive[idx]=false).
      </p>
      <div className="flex items-center gap-2">
        <label className="text-sm">Owner index:</label>
        <input
          type="number"
          min={0}
          max={Math.max(0, maxIdx)}
          className="w-20 rounded bg-zinc-900 p-1 text-sm"
          value={idx}
          onChange={e => setIdx(Number(e.target.value))}
        />
        <PrimaryButton onClick={() => onSubmit(idx)} disabled={busy}>
          Propose
        </PrimaryButton>
      </div>
    </Section>
  );
}
