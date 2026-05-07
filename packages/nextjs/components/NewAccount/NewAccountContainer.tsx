"use client";

import React, { useEffect, useState } from "react";
import axios from "axios";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";
import AccountName from "./AccountName";
import SignersConfirmations from "./SignersConfirmations";
import StatusContainer from "./StatusContainer";
import SuccessScreen from "./SuccessScreen";
import { accountKeys } from "~~/hooks/api/useAccount";
import { userKeys } from "~~/hooks/api/useUser";
import { useZodForm } from "~~/hooks/form";
import { CreateAccountFormData, createAccountSchema } from "~~/lib/form";
import { useAccountStore } from "~~/services/store";
import { useIdentityStore } from "~~/services/store/useIdentityStore";
import { formatErrorMessage } from "~~/utils/formatError";
import { notification } from "~~/utils/scaffold-eth";
import { getValidSigners } from "~~/utils/signer";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api";
const api = axios.create({ baseURL: API_BASE });
const SEPOLIA_CHAIN_ID = 11155111;

/**
 * Polypay-Zama NewAccount flow.
 *
 * Reuses the original Polypay UI: AccountName → SignersConfirmations →
 * StatusContainer → SuccessScreen. Network selection is hidden (Sepolia
 * only). Identity is the 20-byte commitment derived from a signed
 * message — produced by useAuth.login() through the
 * GenerateCommitmentModal that pops automatically on wallet connect.
 *
 * Submission posts to /api/zama/accounts which deploys a fresh
 * HiddenMultisig + initializes its encrypted commitment set in one call.
 */
export default function NewAccountContainer() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: walletClient } = useWalletClient();
  const { commitment } = useIdentityStore();
  const { setCurrentAccount } = useAccountStore();

  const [currentStep, setCurrentStep] = useState(1); // 1=AccountName, 2=Signers, 3=Success
  const [selectedChainIds] = useState<number[]>([SEPOLIA_CHAIN_ID]);
  const [createdAccounts, setCreatedAccounts] = useState<any[] | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [relayerInfo, setRelayerInfo] = useState<{ relayer: string; multisig: string } | null>(null);

  useEffect(() => {
    api
      .get<{ relayer: string; multisig: string }>("/zama/relayer")
      .then(r => setRelayerInfo(r.data))
      .catch(() => null);
  }, []);

  const form = useZodForm({
    schema: createAccountSchema,
    defaultValues: {
      name: "",
      signers: [
        { name: "", commitment: commitment || "" },
        { name: "", commitment: "" },
      ],
      threshold: 2,
    },
  });

  const { watch } = form;
  const formData = watch() as CreateAccountFormData;

  const handleNextStep = () => {
    if (!commitment) {
      notification.error("Generate your membership ID first (sign the identity message).");
      return;
    }
    setCurrentStep(prev => prev + 1);
  };
  const handleGoBack = () => setCurrentStep(prev => Math.max(1, prev - 1));

  const handleCreateAccount = async () => {
    if (!walletClient) {
      notification.error("Connect a wallet first.");
      return;
    }
    if (!commitment) {
      notification.error("Generate your membership ID first.");
      return;
    }
    if (!relayerInfo) {
      notification.error("Backend relayer not reachable.");
      return;
    }

    try {
      setIsCreating(true);

      const validSigners = formData.signers.filter(
        (s: { commitment: string; name?: string }) => s?.commitment?.trim() !== "",
      );

      const hasCreator = validSigners.some(
        (s: { commitment: string; name?: string }) => s.commitment.toLowerCase() === commitment.toLowerCase(),
      );
      if (!hasCreator) {
        notification.error("Your membership ID must be in the signers list.");
        setIsCreating(false);
        return;
      }

      // Single-shot: backend deploys, server-side encrypts the commitments
      // bound to the freshly deployed address, then initializes.
      const { data: account } = await api.post("/zama/accounts", {
        name: formData.name,
        threshold: formData.threshold,
        signers: validSigners.map((s, i) => ({
          commitment: s.commitment,
          name: s.name,
          ownerIndex: i,
          isCreator: s.commitment.toLowerCase() === commitment.toLowerCase(),
        })),
      });

      setCreatedAccounts([account]);
      // Use the full account object from response (includes signers list)
      // so the sidebar AccountItem can render signers without a refetch.
      setCurrentAccount(account);

      // Invalidate React Query caches so Sidebar/ManageAccountsSidebar
      // re-fetches and shows the new account immediately.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: userKeys.accountsForCommitment(commitment) }),
        queryClient.invalidateQueries({ queryKey: userKeys.meAccounts }),
        queryClient.invalidateQueries({ queryKey: accountKeys.all }),
      ]);

      setCurrentStep(3);
    } catch (err: any) {
      const msg = err?.response?.data?.message ?? err?.message ?? String(err);
      notification.error(formatErrorMessage(err, `Failed: ${msg}`));
    } finally {
      setIsCreating(false);
    }
  };

  // Keep first signer slot synced to creator commitment
  useEffect(() => {
    if (commitment && form.getValues("signers.0.commitment") !== commitment) {
      form.setValue("signers.0.commitment", commitment);
    }
  }, [commitment, form]);

  const validSigners = getValidSigners(formData.signers);
  const isSignersValid =
    validSigners.length >= 2 && formData.threshold >= 2 && formData.threshold <= validSigners.length;
  const isNameValid = formData.name.trim().length > 0;

  const EarthBackground = (
    <div className="w-full relative z-1">
      <div className="absolute -top-50 flex h-[736.674px] items-center justify-center left-1/2 translate-x-[-50%] w-[780px] pointer-events-none">
        <Image src="/new-account/earth.svg" alt="Globe" className="w-full h-full" width={780} height={736} />
      </div>
      <div className="absolute top-10 left-0 right-0 h-[400px] w-full bg-gradient-to-t from-white via-white/80 to-transparent pointer-events-none" />
    </div>
  );

  if (currentStep === 3) {
    return (
      <div className="flex flex-row gap-1 w-full h-full bg-app-background">
        <div className="flex-1 overflow-hidden relative flex flex-col rounded-lg bg-background border border-divider">
          {EarthBackground}
          <SuccessScreen className="w-full" createdAccounts={createdAccounts ?? undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-row gap-1 w-full h-full bg-grey-100">
      <div className="flex-1 overflow-hidden relative flex flex-col rounded-lg bg-background border border-divider">
        {EarthBackground}
        <div className="flex-1 overflow-y-auto relative z-10">
          {currentStep === 1 && (
            <AccountName
              className="flex-1"
              form={form}
              onNextStep={handleNextStep}
              onGoBack={() => router.push("/dashboard")}
              isValid={isNameValid}
            />
          )}
          {currentStep === 2 && <SignersConfirmations className="flex-1" form={form} onGoBack={handleGoBack} />}
        </div>
      </div>

      <StatusContainer
        className="w-[280px] lg:w-[400px] flex-shrink-0"
        accountName={formData.name}
        currentStep={currentStep}
        signers={validSigners}
        threshold={formData.threshold}
        selectedChainIds={selectedChainIds}
        onCreateAccount={handleCreateAccount}
        loading={isCreating}
        isFormValid={isSignersValid}
      />
    </div>
  );
}
