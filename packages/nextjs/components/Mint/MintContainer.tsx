"use client";

import React, { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { HIDDEN_ERC20_ABI, HUSD_ADDRESS, HUSD_DECIMALS, HUSD_SYMBOL } from "@polypay/shared";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { sepolia } from "wagmi/chains";
import { Spinner } from "~~/components/ui/Spinner";
import { useHusdBalance } from "~~/hooks/api/useHusdBalance";
import { encryptUint64 } from "~~/lib/fhevm";
import { useAccountStore } from "~~/services/store";
import { formatErrorMessage } from "~~/utils/formatError";
import { notification } from "~~/utils/scaffold-eth";

type Tab = "mint" | "deposit";

/**
 * Polypay-Zama Mint page (hUSD faucet).
 *
 * Visual: same Polypay aesthetic as the Transfer page — globe backgrounds,
 * uppercase hero title with a pink rounded accent shape, single big amount
 * input. Two actions live on tabs: Mint (plaintext) and Deposit (FHE-encrypt
 * + send to the active multisig).
 */
export default function MintContainer() {
  const { address: walletAddress, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { currentAccount } = useAccountStore();

  const [tab, setTab] = useState<Tab>("mint");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const wallet = useHusdBalance(walletAddress ?? null);
  const multisig = useHusdBalance(currentAccount?.address ?? null);

  const refreshAll = useCallback(() => {
    wallet.refresh();
    multisig.refresh();
  }, [wallet, multisig]);

  const formatHusd = useCallback((raw: string | null): string => {
    const value = raw ?? "0";
    return Number(formatUnits(BigInt(value), HUSD_DECIMALS)).toLocaleString("en-US", {
      maximumFractionDigits: 4,
    });
  }, []);

  const handleMint = async () => {
    if (!walletClient || !walletAddress) {
      notification.error("Connect wallet first");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      notification.error("Enter a positive amount");
      return;
    }
    setLoading(true);
    try {
      const baseUnits = parseUnits(amount, HUSD_DECIMALS);
      const hash = await walletClient.writeContract({
        address: HUSD_ADDRESS as `0x${string}`,
        abi: HIDDEN_ERC20_ABI,
        functionName: "mint",
        args: [baseUnits],
        chain: sepolia,
      });
      notification.success(`Mint tx submitted: ${hash.slice(0, 10)}…`);
      setAmount("");
      // Track wallet balance change so the indicator clears the moment
      // the new ciphertext lands (no fixed timeout).
      wallet.markPending();
    } catch (error: any) {
      console.error(error);
      notification.error(formatErrorMessage(error, "Mint failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleDeposit = async () => {
    if (!walletClient || !walletAddress) {
      notification.error("Connect wallet first");
      return;
    }
    if (!currentAccount?.address) {
      notification.error("Pick a multisig account first");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      notification.error("Enter a positive amount");
      return;
    }
    setLoading(true);
    try {
      const baseUnits = parseUnits(amount, HUSD_DECIMALS);
      const { handle, proof } = await encryptUint64(HUSD_ADDRESS, walletAddress, baseUnits);
      const hash = await walletClient.writeContract({
        address: HUSD_ADDRESS as `0x${string}`,
        abi: HIDDEN_ERC20_ABI,
        functionName: "transfer",
        args: [currentAccount.address as `0x${string}`, handle, proof],
        chain: sepolia,
      });
      notification.success(`Deposit tx submitted: ${hash.slice(0, 10)}…`);
      setAmount("");
      // Both balances move on a deposit (wallet down, multisig up); track
      // both so the indicator clears as soon as either side updates.
      wallet.markPending();
      multisig.markPending();
    } catch (error: any) {
      console.error(error);
      notification.error(formatErrorMessage(error, "Deposit failed"));
    } finally {
      setLoading(false);
    }
  };

  const handleAction = tab === "mint" ? handleMint : handleDeposit;
  const sourceLabel = tab === "mint" ? "Wallet" : "Wallet → Multisig";
  const sourceBalance = tab === "mint" ? wallet.balance : wallet.balance;

  // Insufficient balance only matters for Deposit (mint is unlimited).
  const balanceRaw = sourceBalance ? BigInt(sourceBalance) : 0n;
  const inputRaw = (() => {
    if (!amount || parseFloat(amount) <= 0) return 0n;
    try {
      return parseUnits(amount, HUSD_DECIMALS);
    } catch {
      return 0n;
    }
  })();
  const insufficient = tab === "deposit" && inputRaw > balanceRaw;

  const handleMaxClick = () => {
    if (tab !== "deposit") return;
    if (!sourceBalance) return;
    setAmount(formatUnits(BigInt(sourceBalance), HUSD_DECIMALS));
  };

  const isActionDisabled =
    loading ||
    !isConnected ||
    !amount ||
    parseFloat(amount) <= 0 ||
    insufficient ||
    (tab === "deposit" && !currentAccount);

  return (
    <div className="overflow-hidden relative w-full h-full flex flex-col rounded-lg">
      {/* Background globes (reuse from Transfer) */}
      <div className="absolute -top-70 flex h-[736.674px] items-center justify-center left-1/2 translate-x-[-50%] w-[780px] pointer-events-none z-0">
        <Image src="/transfer/top-globe.svg" alt="Top globe" className="w-full h-full" width={780} height={736} />
      </div>
      <div className="absolute -bottom-70 flex h-[736.674px] items-center justify-center left-1/2 translate-x-[-50%] w-[780px] pointer-events-none z-0">
        <Image
          src="/transfer/bottom-globe.svg"
          alt="Bottom globe"
          className="w-full h-full"
          width={780}
          height={736}
        />
      </div>

      <div className="flex flex-col gap-6 items-center justify-start flex-1 px-4 pt-12 pb-8 relative z-10 overflow-y-auto">
        {/* Title */}
        <div className="flex flex-col items-center justify-center">
          <div className="text-6xl text-center font-bold uppercase w-full">faucet</div>
          <div className="flex gap-[5px] items-center justify-center w-full">
            <div className="text-6xl text-center font-bold uppercase">h</div>
            <div className="xl:h-11 h-6 relative rounded-full xl:w-24 w-14 border-[4.648px] border-primary border-solid"></div>
            <div className="text-6xl text-center font-bold uppercase">usd</div>
          </div>
        </div>

        {/* Balance stats */}
        <div className="flex gap-3 mt-4 flex-wrap justify-center">
          <div className="bg-white/80 backdrop-blur rounded-2xl px-5 py-3 border border-grey-200 flex items-center gap-3 min-w-[220px]">
            <Image src="/sidebar/transfer.svg" alt="Wallet" width={24} height={24} className="opacity-60" />
            <div className="flex flex-col">
              <span className="text-xs text-grey-500">Your wallet</span>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-grey-1000">
                  {formatHusd(wallet.balance)} {HUSD_SYMBOL}
                </span>
                {wallet.isPending && <Spinner />}
              </div>
            </div>
          </div>

          <div className="bg-white/80 backdrop-blur rounded-2xl px-5 py-3 border border-grey-200 flex items-center gap-3 min-w-[220px]">
            <Image src="/sidebar/dashboard.svg" alt="Multisig" width={24} height={24} className="opacity-60" />
            <div className="flex flex-col">
              <span className="text-xs text-grey-500">Active multisig</span>
              <div className="flex items-center gap-2">
                <span className="text-base font-semibold text-grey-1000">
                  {currentAccount ? `${formatHusd(multisig.balance)} ${HUSD_SYMBOL}` : "—"}
                </span>
                {multisig.isPending && <Spinner />}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-grey-100 rounded-full p-1 mt-2">
          {(["mint", "deposit"] as const).map(t => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setAmount("");
              }}
              className={`px-6 py-2 rounded-full text-sm font-semibold transition-colors cursor-pointer ${
                tab === t ? "bg-white text-grey-1000 shadow-sm" : "text-grey-500 hover:text-grey-700"
              }`}
            >
              {t === "mint" ? "Mint to wallet" : "Deposit to multisig"}
            </button>
          ))}
        </div>

        {/* Description */}
        <p className="text-sm text-grey-500 text-center max-w-md">
          {tab === "mint"
            ? "Faucet-style mint of plaintext hUSD. Anyone can mint any amount on Sepolia testnet."
            : "Encrypts the amount client-side and calls hUSD.transfer to fund the active multisig. MetaMask only signs the prepared tx."}
        </p>

        {/* Amount input */}
        <div className="flex flex-col gap-2 items-center mt-2">
          <div className="flex gap-2 items-center justify-center">
            <span className="text-[44px] uppercase font-semibold text-primary">{HUSD_SYMBOL}</span>
            <input
              type="text"
              placeholder="0.00"
              value={amount}
              onChange={e => {
                const v = e.target.value;
                if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
              }}
              className="text-text-primary text-[44px] uppercase outline-none w-[180px] bg-transparent"
              disabled={loading}
            />
          </div>

          {tab === "deposit" && (
            <div className="flex items-center gap-3 text-grey-500 text-sm">
              <span>{sourceLabel} balance:</span>
              <span className="font-semibold text-grey-700">
                {formatHusd(sourceBalance)} {HUSD_SYMBOL}
              </span>
              <button
                type="button"
                onClick={handleMaxClick}
                disabled={loading || !sourceBalance}
                className="bg-blue-500 text-white rounded-lg px-3 py-1 font-medium text-xs disabled:opacity-50 cursor-pointer"
              >
                Max
              </button>
            </div>
          )}

          {insufficient && <span className="text-red-500 text-xs">Insufficient wallet balance</span>}
          {tab === "deposit" && !currentAccount && (
            <span className="text-amber-600 text-xs">Pick a multisig account first</span>
          )}
        </div>

        {/* Action button */}
        <button
          onClick={handleAction}
          disabled={isActionDisabled}
          className="bg-pink-350 hover:bg-pink-450 transition-colors flex items-center justify-center gap-2 px-10 py-3 rounded-[10px] disabled:opacity-50 cursor-pointer border-0 mt-2"
        >
          {loading && <Spinner />}
          <span className="font-medium text-base text-center tracking-[-0.16px]">
            {loading
              ? tab === "mint"
                ? "Minting…"
                : "Depositing…"
              : insufficient
                ? "Insufficient balance"
                : tab === "mint"
                  ? "Mint hUSD"
                  : "Deposit to multisig"}
          </span>
        </button>

        {/* Subtle refresh */}
        <button
          onClick={refreshAll}
          className="text-xs text-grey-400 hover:text-grey-600 underline cursor-pointer mt-1"
        >
          Refresh balances
        </button>
      </div>
    </div>
  );
}
