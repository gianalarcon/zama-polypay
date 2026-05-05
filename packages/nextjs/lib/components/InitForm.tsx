"use client";

import { useState } from "react";
import { PrimaryButton, Section } from "./ui";

export function InitForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (owners: string[], threshold: number) => void;
}) {
  const [ownersText, setOwnersText] = useState("");
  const [threshold, setThreshold] = useState(3);

  function handleSubmit() {
    const owners = ownersText
      .split(/[\s,]+/)
      .map(s => s.trim())
      .filter(Boolean);
    if (owners.length === 0) return;
    onSubmit(owners, threshold);
  }

  return (
    <Section title="Initialize Multisig">
      <p className="text-xs text-zinc-400">
        Encrypted owner addresses are bound to (multisig contract, relayer EOA). Anyone can call initialize once.
      </p>
      <textarea
        className="w-full rounded bg-zinc-900 p-2 text-sm font-mono"
        rows={4}
        placeholder="0xowner1, 0xowner2, ..."
        value={ownersText}
        onChange={e => setOwnersText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <label className="text-sm">Threshold:</label>
        <input
          type="number"
          min={1}
          max={32}
          className="w-20 rounded bg-zinc-900 p-1 text-sm"
          value={threshold}
          onChange={e => setThreshold(Number(e.target.value))}
        />
        <PrimaryButton onClick={handleSubmit} disabled={busy}>
          Initialize
        </PrimaryButton>
      </div>
    </Section>
  );
}
