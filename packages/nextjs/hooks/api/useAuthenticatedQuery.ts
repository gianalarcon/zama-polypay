import { QueryKey, UseQueryOptions, useQuery } from "@tanstack/react-query";

/**
 * Polypay-Zama: auth bypass.
 *
 * The original implementation gated queries on a JWT accessToken in the
 * identityStore. We now use wallet-connect identity, so we drop that gate
 * and forward straight to useQuery. Individual queries that target the
 * legacy backend endpoints simply error out and the React Query state
 * surfaces that to the caller.
 */
export function useAuthenticatedQuery<
  TQueryFnData = unknown,
  TError = Error,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>) {
  return useQuery(options);
}
