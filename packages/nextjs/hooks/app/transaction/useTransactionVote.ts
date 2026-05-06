import { useState } from "react";
import { createTransactionSteps } from "./transactionSteps";
import {
  SignerData,
  TxStatus,
  TxType,
  ZERO_ADDRESS,
  encodeAddSigners,
  encodeBatchTransfer,
  encodeBatchTransferMulti,
  encodeERC20Transfer,
  encodeRemoveSigners,
  encodeUpdateThreshold,
} from "@polypay/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletClient } from "wagmi";
import { accountKeys, useMetaMultiSigWallet, userKeys } from "~~/hooks";
import { useApproveTransaction, useDenyTransaction, useExecuteTransaction } from "~~/hooks/api/useTransaction";
import { useGenerateProof } from "~~/hooks/app/useGenerateProof";
import { useStepLoading } from "~~/hooks/app/useStepLoading";
import { useIdentityStore } from "~~/services/store/useIdentityStore";
import { formatErrorMessage } from "~~/utils/formatError";
import { notification } from "~~/utils/scaffold-eth";

interface UseTransactionVoteOptions {
  onSuccess?: () => void;
}

export type VoteStatus = "approved" | "denied";

export interface Member {
  commitment: string;
  name: string | null;
  isInitiator: boolean;
  isMe: boolean;
  voteStatus: VoteStatus;
}

export interface BatchTransfer {
  recipient: string;
  amount: string;
  contactId?: string;
  contactName?: string;
  tokenAddress?: string;
}

export interface TransactionRowData {
  id: string;
  txId: number;
  type: TxType;
  nonce: number;
  status: TxStatus;
  txHash?: string;
  amount?: string;
  recipientAddress?: string;
  tokenAddress?: string;
  signerData?: SignerData[] | null;
  oldThreshold?: number;
  newThreshold?: number;
  batchData?: BatchTransfer[];
  contact?: {
    id: string;
    name: string;
    address: string;
  };
  members: Member[];
  votedCount: number;
  threshold: number;
  approveCount: number;
  myVoteStatus: VoteStatus | null;
  accountAddress: string;
}

/**
 * Build callData, to, and value based on transaction type
 */
function buildTransactionParams(tx: TransactionRowData): {
  to: `0x${string}`;
  value: bigint;
  callData: `0x${string}`;
} {
  let callData: `0x${string}` = "0x";
  let to: `0x${string}` = tx.recipientAddress as `0x${string}`;
  let value = BigInt(tx.amount || "0");

  if (tx.type === TxType.TRANSFER) {
    // Check if ERC20 transfer
    if (tx.tokenAddress && tx.tokenAddress !== ZERO_ADDRESS) {
      to = tx.tokenAddress as `0x${string}`;
      value = 0n;
      callData = encodeERC20Transfer(tx.recipientAddress!, BigInt(tx.amount || "0")) as `0x${string}`;
    }
  } else {
    // For non-transfer types, to = account address
    to = tx.accountAddress as `0x${string}`;
    value = 0n;

    if (tx.type === TxType.ADD_SIGNER) {
      const commitments = tx.signerData?.map(s => s.commitment) || [];
      callData = encodeAddSigners(commitments, tx.newThreshold!);
    } else if (tx.type === TxType.REMOVE_SIGNER) {
      const commitments = tx.signerData?.map(s => s.commitment) || [];
      callData = encodeRemoveSigners(commitments, tx.newThreshold!);
    } else if (tx.type === TxType.SET_THRESHOLD) {
      callData = encodeUpdateThreshold(tx.newThreshold!);
    } else if (tx.type === TxType.BATCH && tx.batchData) {
      const recipients = tx.batchData.map(item => item.recipient as `0x${string}`);
      const amounts = tx.batchData.map(item => BigInt(item.amount));
      const tokenAddresses = tx.batchData.map(item => item.tokenAddress || ZERO_ADDRESS);

      const hasERC20 = tokenAddresses.some(addr => addr !== ZERO_ADDRESS);

      callData = hasERC20
        ? encodeBatchTransferMulti(recipients, amounts, tokenAddresses)
        : encodeBatchTransfer(recipients, amounts);
    }
  }

  return { to, value, callData };
}

export const useTransactionVote = (options?: UseTransactionVoteOptions) => {
  const { isLoading, loadingState, loadingStep, totalSteps, startStep, setStepByLabel, reset, startLoading } =
    useStepLoading(createTransactionSteps("approval"));

  const { commitment } = useIdentityStore();
  const { data: walletClient } = useWalletClient();
  const metaMultiSigWallet = useMetaMultiSigWallet();

  const { mutateAsync: approveApi } = useApproveTransaction();
  const { mutateAsync: denyApi } = useDenyTransaction();
  const { mutateAsync: executeApi } = useExecuteTransaction();
  const { generateProof } = useGenerateProof({
    onLoadingStateChange: setStepByLabel,
  });
  const queryClient = useQueryClient();

  const approve = async (tx: TransactionRowData) => {
    if (!commitment) {
      notification.error("No membership ID — sign the identity message first");
      return;
    }

    // Polypay-Zama: skip the legacy ZK proof generation and contract.read.
    // The transactionApi.approve adapter encrypts the commitment server-side
    // and submits the on-chain approve(); per-vote intent is also persisted
    // in the Vote table for the UI.
    startLoading("Submitting approval…");
    try {
      await approveApi({ txId: tx.txId, dto: {} as any });
      notification.success("Vote submitted!");
      options?.onSuccess?.();
    } catch (error: any) {
      console.error("Approve error:", error);
      notification.error(formatErrorMessage(error, "Failed to approve"));
    } finally {
      reset();
    }
  };

  const deny = async (_tx: TransactionRowData) => {
    // Zama protocol has no on-chain deny — denial is implicit (don't approve).
    notification.info("Polypay-Zama has no explicit deny — just don't approve.");
  };

  const execute = async (txId: number) => {
    // Two-step async: backend runs requestExecute → publicDecrypt →
    // finalizeExecute. The whole roundtrip can take 30s–2 min.
    startLoading("Executing (request + decrypt + finalize)…");
    try {
      const result = await executeApi({ txId, dto: {} as any });
      console.log("Transaction executed:", result.txHash);
      notification.success("Transaction executed successfully!");

      queryClient.invalidateQueries({ queryKey: userKeys.all });
      queryClient.invalidateQueries({
        queryKey: accountKeys.byAddress(metaMultiSigWallet?.address || ""),
      });
      options?.onSuccess?.();
    } catch (error: any) {
      console.error("Execute error:", error);
      notification.error(formatErrorMessage(error, "Failed to execute"));
    } finally {
      reset();
    }
  };

  return {
    approve,
    deny,
    execute,
    isLoading,
    loadingState,
    loadingStep,
    totalSteps,
  };
};
