"use client";

import React, { useState } from "react";
import axios from "axios";
import Image from "next/image";
import { HUSD_DECIMALS, HUSD_SYMBOL } from "@polypay/shared";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseUnits } from "viem";
import { Spinner } from "~~/components/ui/Spinner";
import { transactionKeys } from "~~/hooks/api/useTransaction";
import { useHusdBalance } from "~~/hooks/api/useHusdBalance";
import { useZodForm } from "~~/hooks/form";
import { TransferFormData, transferSchema } from "~~/lib/form";
import { useAccountStore, useIdentityStore } from "~~/services/store";
import { formatErrorMessage } from "~~/utils/formatError";
import { notification } from "~~/utils/scaffold-eth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const api = axios.create({ baseURL: API_BASE });

/**
 * Polypay-Zama TransferContainer (hUSD only).
 *
 * Reuses the Polypay globe + dashed divider UI but the token is fixed to
 * the singleton hUSD (confidential ERC20). The amount stays plaintext at
 * propose time so signers can review what they're approving — encryption
 * happens at execute time when the relayer hands the value to hUSD.transfer
 * via finalizeExecute extraData.
 */
export default function TransferContainer() {
  const { currentAccount } = useAccountStore();
  const { commitment } = useIdentityStore();
  const accountAddress = currentAccount?.address;
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);

  const { balance: multisigBalance, isLoading: isBalanceLoading, isPending: isBalancePending, refresh: refreshBalance, markPending } = useHusdBalance(
    accountAddress ?? null,
  );

  const isBalanceBusy = isBalanceLoading || isBalancePending;
  const formattedBalance = multisigBalance
    ? Number(formatUnits(BigInt(multisigBalance), HUSD_DECIMALS)).toLocaleString("en-US", {
        maximumFractionDigits: 4,
      })
    : "0";

  const form = useZodForm({
    schema: transferSchema,
    defaultValues: { recipient: "", amount: "" },
  });

  const handleMaxClick = () => {
    if (!multisigBalance) return;
    form.setValue("amount", formatUnits(BigInt(multisigBalance), HUSD_DECIMALS), { shouldValidate: true });
  };

  const handleTransfer = async (data: TransferFormData) => {
    if (!accountAddress) {
      notification.error("No multisig selected. Create or pick an account first.");
      return;
    }
    setIsLoading(true);
    try {
      const baseUnits = parseUnits(data.amount, HUSD_DECIMALS);
      const { data: res } = await api.post<{ propId: number; txHash: string }>(
        `/zama/accounts/${accountAddress}/proposals/transfer`,
        {
          to: data.recipient,
          amount: baseUnits.toString(),
          // Polypay parity: creating a proposal counts as the creator's
          // first approval. Backend will auto-approve after submitting.
          creatorCommitment: commitment ?? undefined,
        },
      );

      notification.success(
        <div className="flex flex-col gap-1">
          <span>Proposal #{res.propId} submitted!</span>
          <a href="/dashboard" className="text-primary underline text-sm">
            View on dashboard →
          </a>
        </div>,
      );
      form.reset();
      // Invalidate the dashboard transaction list so the new proposal shows
      // up immediately (without waiting for the WebSocket round-trip or the
      // user to manually refresh).
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      if (accountAddress) {
        queryClient.invalidateQueries({ queryKey: transactionKeys.byAccount(accountAddress) });
      }
      // Proposal creation itself doesn't move funds — only an executed
      // proposal does. Mark the multisig balance pending so the spinner
      // appears now and clears the moment the post-execute balance lands
      // (or the 90s safety fallback fires).
      markPending();
    } catch (error: any) {
      notification.error(formatErrorMessage(error, "Failed to submit proposal"));
    } finally {
      setIsLoading(false);
    }
  };

  const watchedRecipient = form.watch("recipient");
  const watchedAmount = form.watch("amount");
  const isAmountValid = watchedAmount !== "" && parseFloat(watchedAmount) > 0;

  // Insufficient-balance gate (hUSD-only path).
  const balanceRaw = multisigBalance ? BigInt(multisigBalance) : 0n;
  const inputRaw = (() => {
    if (!isAmountValid) return 0n;
    try {
      return parseUnits(watchedAmount, HUSD_DECIMALS);
    } catch {
      return 0n;
    }
  })();
  const insufficientBalance = isAmountValid && multisigBalance !== null && inputRaw > balanceRaw;

  return (
    <div className="overflow-hidden relative w-full h-full flex flex-col rounded-lg">
      {/* Background globes */}
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

      <div className="flex flex-col gap-6 items-center justify-center flex-1 px-4 relative z-10">
        {/* Title */}
        <div className="flex flex-col items-center justify-center pt-8 relative z-10">
          <div className="text-6xl text-center font-bold uppercase w-full">transfering</div>
          <div className="flex gap-[5px] items-center justify-center w-full">
            <div className="text-6xl text-center font-bold uppercase">t</div>
            <div className="xl:h-11 h-6 relative rounded-full xl:w-32 w-16 border-[4.648px] border-primary border-solid"></div>
            <div className="text-6xl text-center font-bold uppercase">anyone</div>
          </div>
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-2 mt-20">
          <div className="flex gap-2 items-center justify-center w-full">
            <span className="text-[44px] uppercase font-semibold text-primary">{HUSD_SYMBOL}</span>
            <input
              {...form.register("amount")}
              type="text"
              placeholder="0.00"
              onChange={e => {
                const value = e.target.value;
                if (value === "" || /^\d*\.?\d*$/.test(value)) {
                  form.setValue("amount", value, { shouldValidate: true });
                }
              }}
              className="text-text-primary text-[44px] uppercase outline-none w-[150px]"
              disabled={isLoading}
            />
          </div>

          <div className="flex items-center gap-3 text-grey-500 text-base">
            <span>Polypay account balance:</span>
            <span className="font-semibold text-grey-700 flex items-center gap-2">
              {formattedBalance} {HUSD_SYMBOL}
              {isBalanceBusy && <Spinner />}
            </span>
            <button
              type="button"
              onClick={handleMaxClick}
              disabled={isLoading || multisigBalance === null}
              className="bg-blue-500 text-white rounded-lg px-3 py-1 font-medium text-sm disabled:opacity-50 cursor-pointer"
            >
              Max
            </button>
          </div>

          {form.formState.errors.amount && (
            <p className="text-red-500 text-xs">{form.formState.errors.amount.message}</p>
          )}
          {insufficientBalance && <p className="text-red-500 text-xs text-center">Insufficient balance</p>}
        </div>

        {/* Divider */}
        <div className="flex flex-col gap-2.5 items-center justify-center w-full max-w-md h-[100px] relative">
          <div className="h-[75.46px] w-full max-w-[528px] flex items-center justify-center relative">
            <div className="relative w-full h-full">
              <div className="absolute left-1/2 top-0 w-0.5 h-full border-l border-dashed border-gray-300 transform -translate-x-1/2" />
              <div className="absolute left-0 top-1/2 w-full h-0.5 border-t border-dashed border-gray-300 transform -translate-y-1/2" />
            </div>
            <div className="absolute bg-white rounded-[32.842px] w-8 h-8 top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex items-center justify-center border-1 border-dashed shadow-[0 4px 33.5px 0 rgba(26, 32, 111, 0.29)]">
              <div className="text-text-secondary text-sm text-center text-grey-800">To</div>
            </div>
          </div>
        </div>

        {/* Recipient */}
        <div className="flex flex-col gap-[5px] items-center justify-start w-full max-w-xl">
          <div className="flex gap-2.5 items-center justify-center w-full">
            <div className="bg-grey-50 grow min-h-px min-w-px relative rounded-2xl border border-grey-200 p-4 justify-between flex-row flex">
              <input
                {...form.register("recipient")}
                type="text"
                placeholder="Enter address"
                className="text-text-secondary outline-none placeholder:text-text-secondary flex-1 w-full font-medium"
                disabled={isLoading}
              />
            </div>
          </div>
          {form.formState.errors.recipient && (
            <p className="text-red-500 text-sm">{form.formState.errors.recipient.message}</p>
          )}
        </div>

        {/* Submit button */}
        <div className="flex gap-2 items-center justify-center w-full max-w-xs">
          <button
            onClick={form.handleSubmit(handleTransfer)}
            disabled={
              isLoading || !isAmountValid || !watchedRecipient || !accountAddress || insufficientBalance
            }
            className="bg-pink-350 flex items-center justify-center gap-2 px-3 py-2 rounded-[10px] disabled:opacity-50 cursor-pointer border-0 flex-1 hover:bg-pink-450 transition-colors"
          >
            {isLoading && <Spinner />}
            <span className="font-medium xl:text-base text-xs text-center tracking-[-0.16px]">
              {isLoading ? "Submitting…" : insufficientBalance ? "Insufficient balance" : "Submit Proposal"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
