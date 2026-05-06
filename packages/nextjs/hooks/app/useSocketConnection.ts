/**
 * No-op socket connection. Polypay-Zama backend has no Socket.io server;
 * the frontend polls /api/zama/proposals via React Query instead.
 */
export function useSocketConnection(): void {
  // intentionally empty
}
