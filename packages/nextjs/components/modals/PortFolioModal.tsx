"use client";

import React from "react";
import Image from "next/image";
import { Button } from "../ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "../ui/sheet";
import { HUSD_DECIMALS, HUSD_NAME, HUSD_SYMBOL } from "@polypay/shared";
import { Eye, EyeOff, MoveDown, MoveUp, X } from "lucide-react";
import { Address, formatUnits } from "viem";
import NetworkBadge from "~~/components/Common/NetworkBadge";
import { Spinner } from "~~/components/ui/Spinner";
import { useMetaMultiSigWallet } from "~~/hooks";
import { useHusdBalance } from "~~/hooks/api/useHusdBalance";
import { useAppRouter } from "~~/hooks/app/useRouteApp";
import { useAccountStore } from "~~/services/store";
import { getDefaultChainId } from "~~/utils/network";

interface PortfolioModalProps {
  children: React.ReactNode;
}

export const PortfolioModal: React.FC<PortfolioModalProps> = ({ children }) => {
  const metaMultiSigWallet = useMetaMultiSigWallet();
  const router = useAppRouter();
  const [showBalance, setShowBalance] = React.useState(true);
  const { currentAccount } = useAccountStore();

  const husd = useHusdBalance(metaMultiSigWallet?.address ?? null);

  const balanceWei = husd.balance ? BigInt(husd.balance) : 0n;
  const husdAmount = Number(formatUnits(balanceWei, HUSD_DECIMALS));
  // hUSD is a USD-pegged demo token: 1 hUSD = $1.
  const usdValue = husdAmount;

  const formattedHusd = husdAmount.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const formattedTotalUsd = usdValue.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const isBusy = husd.isPending || husd.isLoading;
  const chainId = currentAccount?.chainId ?? getDefaultChainId();

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetTitle></SheetTitle>
      <SheetContent
        side="right"
        className="w-[332px] h-[98%] p-1 border-l-0 top-[8px] right-[5px] rounded-[19px] bg-grey-50 shadow-[7px_4px_108px_rgba(0,0,0,0.25)]"
      >
        <div className="flex flex-col h-full gap-1">
          {/* Header Card */}
          <div className="relative bg-[url('/common/bg-main.png')] bg-no-repeat bg-cover rounded-2xl overflow-hidden">
            <div className="px-5 pt-6 pb-6 relative">
              <SheetClose asChild>
                <Button
                  size="sm"
                  className="absolute top-2 right-2 h-icon-btn w-[38px] p-2 bg-white hover:bg-white/70 rounded-[10px] cursor-pointer"
                >
                  <X className="h-[18px] w-[18px] text-grey-950" />
                </Button>
              </SheetClose>

              <div className="flex items-center gap-2 mb-2">
                <span className="text-grey-1000 text-sm font-medium leading-[22px]">Account balance</span>
                <button onClick={() => setShowBalance(v => !v)} className="cursor-pointer">
                  {showBalance ? (
                    <Eye className="w-[14px] h-[14px] text-main-violet" />
                  ) : (
                    <EyeOff className="w-[14px] h-[14px] text-main-violet" />
                  )}
                </button>
                {isBusy && <Spinner />}
              </div>

              <div className="flex items-center gap-2 pt-4 mb-6">
                {showBalance ? (
                  <>
                    <span className="text-grey-1000 text-4xl font-normal uppercase leading-9">$</span>
                    <span className="text-grey-1000 text-4xl font-medium uppercase leading-9">
                      {formattedTotalUsd}
                    </span>
                  </>
                ) : (
                  <span className="text-grey-1000 text-4xl font-medium leading-9">*****</span>
                )}
              </div>

              <div className="flex gap-1 p-1 bg-[rgba(0,0,0,0.47)] backdrop-blur-[15px] rounded-[15px]">
                <SheetClose asChild>
                  <Button
                    className="flex-1 min-w-0 h-icon-btn px-6 py-2 gap-1 bg-[rgba(248,248,248,0.13)] hover:bg-[rgba(248,248,248,0.25)] rounded-xl border border-[rgba(255,255,255,0.25)] cursor-pointer"
                    onClick={() => router.goToTransfer()}
                  >
                    <MoveUp className="h-5 w-5 text-grey-50 shrink-0" />
                    <span className="text-grey-50 text-base font-normal leading-[19px]">Transfer</span>
                  </Button>
                </SheetClose>
                <SheetClose asChild>
                  <Button
                    className="flex-1 min-w-0 h-icon-btn px-6 py-2 gap-1 bg-[rgba(248,248,248,0.13)] hover:bg-[rgba(248,248,248,0.25)] rounded-xl border border-[rgba(255,255,255,0.25)] cursor-pointer"
                    onClick={() => router.push("/mint" as any)}
                  >
                    <MoveDown className="h-5 w-5 text-grey-50 shrink-0" />
                    <span className="text-grey-50 text-base font-normal leading-[19px]">Mint / Deposit</span>
                  </Button>
                </SheetClose>
              </div>
            </div>
          </div>

          {/* My Assets Section */}
          <div className="flex-1 bg-white rounded-2xl border border-grey-200 overflow-hidden">
            <div className="px-5 pt-4 pb-4">
              <span className="text-grey-850 text-2xl font-medium">My Assets</span>
            </div>

            <div className="flex flex-col">
              <div className="flex items-center gap-3 px-5 py-4">
                <div className="relative">
                  <div className="w-10 h-10 rounded-full bg-pink-25 flex items-center justify-center">
                    <Image src="/logo/polypay-icon.svg" alt="hUSD" width={24} height={24} />
                  </div>
                  <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full overflow-hidden border border-white bg-black">
                    <NetworkBadge chainId={chainId} size={20} />
                  </div>
                </div>
                <div className="flex-1 flex flex-col">
                  <span className="text-grey-850 text-base font-semibold leading-6">{HUSD_SYMBOL}</span>
                  <span className="text-grey-600 text-sm font-medium leading-5">{HUSD_NAME}</span>
                </div>
                <div className="flex-1 flex flex-col items-end gap-1">
                  <span className="flex items-center gap-2 text-grey-850 text-base font-medium leading-6">
                    {formattedHusd} {HUSD_SYMBOL}
                    {husd.isPending && <Spinner />}
                  </span>
                  <span className="text-grey-600 text-sm font-medium leading-5">${formattedTotalUsd}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
