import { useCallback } from "react";
import { accountContractKeys } from "../app";
import { useSocketEvent } from "../app/useSocketEvent";
import { useAuthenticatedQuery } from "./useAuthenticatedQuery";
import {
  ApproveTransactionDto,
  DEFAULT_PAGE_SIZE,
  DenyTransactionDto,
  ExecuteTransactionDto,
  PaginatedResponse,
  TX_CREATED_EVENT,
  TX_STATUS_EVENT,
  TX_VOTED_EVENT,
  Transaction,
  TxCreatedEventData,
  TxStatus,
  TxStatusEventData,
  TxVotedEventData,
} from "@polypay/shared";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { transactionApi } from "~~/services/api";

// ============ Query Keys ============

export const transactionKeys = {
  all: ["transactions"] as const,
  byAccount: (accountAddress: string) => [...transactionKeys.all, accountAddress] as const,
  byAccountAndStatus: (accountAddress: string, status: TxStatus) =>
    [...transactionKeys.all, accountAddress, status] as const,
  byTxId: (txId: number) => [...transactionKeys.all, "detail", txId] as const,
};

// ============ Hooks ============

/**
 * Create new transaction with ZK proof
 */
export const useCreateTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: transactionApi.create,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: transactionKeys.byAccount(variables.accountAddress),
      });
    },
  });
};

/**
 * Infinite scroll hook for transactions
 */
export const useTransactionsInfinite = (accountAddress: string, status?: TxStatus) => {
  // Polypay-Zama dropped JWT auth — gating on `accessToken` would keep this
  // query permanently disabled and prevent React Query from refetching after
  // an approve / propose action. Gate solely on the account address.
  return useInfiniteQuery({
    queryKey: status
      ? [...transactionKeys.byAccountAndStatus(accountAddress, status), "infinite"]
      : [...transactionKeys.byAccount(accountAddress), "infinite"],
    queryFn: ({ pageParam }) =>
      transactionApi.getAll(accountAddress, status, {
        limit: DEFAULT_PAGE_SIZE,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PaginatedResponse<Transaction>) =>
      lastPage.hasMore ? lastPage.nextCursor : undefined,
    enabled: !!accountAddress,
  });
};

/**
 * Get single transaction by txId
 */
export const useTransaction = (txId: number) => {
  return useAuthenticatedQuery({
    queryKey: transactionKeys.byTxId(txId),
    queryFn: () => transactionApi.getById(txId),
    enabled: txId > 0,
  });
};

/**
 * Approve transaction with ZK proof
 */
export const useApproveTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ txId, dto }: { txId: number; dto: ApproveTransactionDto }) => transactionApi.approve(txId, dto),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.byTxId(data.txId) });
    },
  });
};

/**
 * Deny transaction
 */
export const useDenyTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ txId, dto }: { txId: number; dto: DenyTransactionDto }) => transactionApi.deny(txId, dto),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.byTxId(data.txId) });
    },
  });
};

/**
 * Mark transaction as executed
 */
export const useMarkTransactionExecuted = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ txId, txHash }: { txId: number; txHash: string }) => transactionApi.markExecuted(txId, txHash),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.byTxId(data.txId) });
    },
  });
};

/**
 * Execute transaction on-chain via relayer
 */
export const useExecuteTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ txId, dto }: { txId: number; dto: ExecuteTransactionDto }) => transactionApi.execute(txId, dto),
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: transactionKeys.all });
      queryClient.invalidateQueries({ queryKey: transactionKeys.byTxId(data.txId) });
    },
  });
};

/**
 * Reserve nonce for new transaction
 */
export const useReserveNonce = () => {
  return useMutation({
    mutationFn: transactionApi.reserveNonce,
  });
};

// ============ Utility Hooks ============

/**
 * Get pending transactions for an account
 */
export const usePendingTransactions = (accountAddress: string) => {
  return useTransactionsInfinite(accountAddress, TxStatus.PENDING);
};

/**
 * Listen for realtime transaction updates and patch the React Query cache
 * directly from the WebSocket payload — no extra refetch RTT, so the row
 * reflects the new state the moment the event lands.
 *
 * - TX_VOTED_EVENT carries the full Vote record + approveCount; we splice
 *   the vote into the matching proposal's `votes` array so myVoteStatus +
 *   approveCount + isExecutable update in one render.
 * - TX_STATUS_EVENT carries (status, txHash); we patch the row in-place so
 *   the StatusBadge flips to Succeed / Denied without waiting for a list
 *   refetch.
 * - TX_CREATED_EVENT only carries (txId, type) — not enough to construct
 *   a full Transaction — so we still fall back to an invalidateQueries
 *   here. The new proposal arrives on the next refetch (typically within
 *   one Sepolia block).
 */
export const useTransactionRealtime = (accountAddress: string | undefined) => {
  const queryClient = useQueryClient();

  const patchTransactionInCache = useCallback(
    (txId: number, mutator: (tx: any) => any) => {
      if (!accountAddress) return;
      // useTransactionsInfinite stores data under
      //   [...transactionKeys.byAccount(addr), "infinite"]
      // and possibly the byAccountAndStatus variant. Use a partial-match
      // query filter so both flavours get patched.
      queryClient.setQueriesData(
        { queryKey: transactionKeys.byAccount(accountAddress), exact: false },
        (oldData: any) => {
          if (!oldData?.pages) return oldData;
          return {
            ...oldData,
            pages: oldData.pages.map((page: any) => ({
              ...page,
              data: page.data.map((tx: any) => (tx.txId === txId ? mutator(tx) : tx)),
            })),
          };
        },
      );
    },
    [queryClient, accountAddress],
  );

  const handleTxCreated = useCallback(
    (data: TxCreatedEventData) => {
      if (!accountAddress) return;
      queryClient.invalidateQueries({ queryKey: transactionKeys.byAccount(accountAddress) });
    },
    [queryClient, accountAddress],
  );

  const handleTxStatus = useCallback(
    (data: TxStatusEventData) => {
      if (!accountAddress) return;
      patchTransactionInCache(data.txId, tx => ({
        ...tx,
        status: data.status,
        txHash: data.txHash ?? tx.txHash,
      }));
      if (data.status === TxStatus.EXECUTED) {
        // Contract-derived signers / threshold may have changed if the
        // executed proposal was AddSigner / RemoveSigner / SetThreshold.
        queryClient.invalidateQueries({
          queryKey: accountContractKeys.commitments(accountAddress),
        });
        queryClient.invalidateQueries({
          queryKey: accountContractKeys.threshold(accountAddress),
        });
      }
    },
    [queryClient, accountAddress, patchTransactionInCache],
  );

  const handleTxVoted = useCallback(
    (data: TxVotedEventData) => {
      patchTransactionInCache(data.txId, tx => {
        const next = (tx.votes ?? []).filter((v: any) => v.voterCommitment !== data.vote.voterCommitment);
        next.push({
          voterCommitment: data.vote.voterCommitment,
          voterName: data.vote.voterName,
          voteType: data.voteType,
        });
        return { ...tx, votes: next };
      });
    },
    [patchTransactionInCache],
  );

  useSocketEvent(TX_CREATED_EVENT, handleTxCreated);
  useSocketEvent(TX_STATUS_EVENT, handleTxStatus);
  useSocketEvent(TX_VOTED_EVENT, handleTxVoted);
};
