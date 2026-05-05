"use client";

import type { ProposalState } from "../api";
import { PrimaryButton, Section } from "./ui";

export function ProposalList({
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
            <PrimaryButton
              variant="emerald"
              disabled={busy || !connectedAddress || p.executed}
              onClick={() => onApprove(p.id)}
            >
              {`Approve as ${connectedAddress ? `${connectedAddress.slice(0, 6)}…${connectedAddress.slice(-4)}` : "?"}`}
            </PrimaryButton>
            <PrimaryButton
              variant="purple"
              disabled={busy || p.executed || p.decryptionPending}
              onClick={() => onExecute(p.id)}
            >
              Execute (request + finalize)
            </PrimaryButton>
          </div>
        </div>
      ))}
    </Section>
  );
}
