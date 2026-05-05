"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { formatEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import { CHAIN_ID } from "~~/lib/constants";
import { usePolypay } from "~~/lib/hooks/usePolypay";
import { InitForm } from "~~/lib/components/InitForm";
import { ProposalList } from "~~/lib/components/ProposalList";
import {
  AddSignerForm,
  RemoveSignerForm,
  SetThresholdForm,
  TransferForm,
} from "~~/lib/components/ProposalForms";
import { KV, Section, StatusBanner } from "~~/lib/components/ui";

export default function DemoPage() {
  const { address } = useAccount();
  const { relayer, wallet, proposals, status, busy, refresh, actions } = usePolypay();

  const multisigBalance = useBalance({
    address: relayer?.multisig as `0x${string}` | undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(relayer?.multisig), refetchInterval: 10_000 },
  });

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Polypay-Zama</h1>
          <p className="text-zinc-400 text-sm">Confidential multisig payroll on Sepolia (FHE)</p>
        </div>
        <ConnectButton />
      </header>

      <StatusBanner status={status} />

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

      {!wallet?.initialized && <InitForm busy={busy} onSubmit={(owners, t) => void actions.initialize(owners, t)} />}

      {wallet?.initialized && (
        <>
          <TransferForm busy={busy} onSubmit={(to, amt, tok) => void actions.proposeTransfer(to, amt, tok)} />
          <SetThresholdForm busy={busy} onSubmit={t => void actions.proposeSetThreshold(t)} />
          <AddSignerForm busy={busy} onSubmit={addr => void actions.proposeAddSigner(addr)} />
          <RemoveSignerForm
            busy={busy}
            maxIdx={Math.max(0, (wallet?.ownersLength ?? 1) - 1)}
            onSubmit={idx => void actions.proposeRemoveSigner(idx)}
          />
          <ProposalList
            proposals={proposals}
            busy={busy}
            connectedAddress={address as `0x${string}` | undefined}
            onApprove={id => address && void actions.approve(id, address)}
            onExecute={id => void actions.execute(id)}
          />
        </>
      )}
    </main>
  );
}
