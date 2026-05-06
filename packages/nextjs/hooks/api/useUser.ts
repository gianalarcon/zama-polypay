import { useAuthenticatedQuery } from "./useAuthenticatedQuery";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { userApi } from "~~/services/api";
import { useIdentityStore } from "~~/services/store";

export const userKeys = {
  all: ["users"] as const,
  me: ["users", "me"] as const,
  meAccounts: ["users", "me", "accounts"] as const,
  accountsForCommitment: (commitment: string | null) => ["users", "me", "accounts", commitment ?? "anon"] as const,
};

export const useCreateUser = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: userApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.all });
      queryClient.invalidateQueries({ queryKey: userKeys.me });
    },
  });
};

export const useMe = () => {
  return useAuthenticatedQuery({
    queryKey: userKeys.me,
    queryFn: () => userApi.getMe(),
  });
};

export const useMyAccounts = () => {
  const { commitment } = useIdentityStore();
  return useAuthenticatedQuery({
    queryKey: userKeys.accountsForCommitment(commitment),
    queryFn: () => userApi.getMyAccounts(commitment ?? undefined),
    enabled: Boolean(commitment),
  });
};
