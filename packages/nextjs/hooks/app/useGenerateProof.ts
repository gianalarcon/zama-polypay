/**
 * Polypay-Zama stub.
 *
 * The legacy `useGenerateProof` ran a Noir + bb.js circuit in the browser to
 * produce a ZK proof for the original zkVerify-on-Horizen flow. Polypay-Zama
 * replaced that with FHE encryption via @zama-fhe/relayer-sdk, so this hook
 * is no longer needed for the main Transfer / Approve / Execute paths.
 *
 * It's kept as a stub because `useSignerTransaction` (still imported by the
 * EditAccountModal) hasn't been fully ported to the Zama proposal endpoints.
 * Calling it will throw — refactor EditAccountModal to hit
 * `/api/zama/accounts/:address/proposals/{add-signer,remove-signer,set-threshold}`
 * directly when the modal flow is ported.
 */
export function useGenerateProof(_options?: { onLoadingStateChange?: (label: string) => void }) {
  return {
    generateProof: async (_txHash: string): Promise<never> => {
      throw new Error(
        "useGenerateProof is not implemented in Polypay-Zama — the EditAccountModal flow needs to be ported to the Zama relayer proposal endpoints.",
      );
    },
  };
}
