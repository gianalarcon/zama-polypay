"use client";

import { ReactNode } from "react";
import type { Status } from "../hooks/usePolypay";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm border-b border-zinc-800 pb-1">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

export function Field({
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

export function StatusBanner({ status }: { status: Status }) {
  if (!status) return null;
  const cls =
    status.kind === "error"
      ? "border-red-500/40 bg-red-500/10 text-red-200"
      : status.kind === "success"
        ? "border-green-500/40 bg-green-500/10 text-green-200"
        : "border-blue-500/40 bg-blue-500/10 text-blue-200";
  return <div className={`rounded border p-3 text-sm ${cls}`}>{status.text}</div>;
}

export function PrimaryButton({
  onClick,
  disabled,
  children,
  variant = "blue",
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
  variant?: "blue" | "emerald" | "purple";
}) {
  const colors = {
    blue: "bg-blue-600 hover:bg-blue-700",
    emerald: "bg-emerald-600 hover:bg-emerald-700",
    purple: "bg-purple-600 hover:bg-purple-700",
  } as const;
  return (
    <button
      disabled={disabled}
      className={`rounded ${colors[variant]} px-3 py-1 text-sm font-medium disabled:opacity-50`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
