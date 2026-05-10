/**
 * Polypay-Zama hUSD deployment constants.
 *
 * Lives in its own file (separate from HiddenERC20.ts which is regenerated
 * from compiled artifacts) so the address survives ABI re-sync.
 */

/** Sepolia deployment of the singleton hUSD token shared across multisigs. */
export const HUSD_ADDRESS = "0x727b8EFc5f0F589e1059767DEBC344e21ba6aF82" as const;
export const HUSD_DECIMALS = 6;
export const HUSD_SYMBOL = "hUSD";
export const HUSD_NAME = "Hidden USD";
