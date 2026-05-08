/**
 * Polypay-Zama hUSD deployment constants.
 *
 * Lives in its own file (separate from HiddenERC20.ts which is regenerated
 * from compiled artifacts) so the address survives ABI re-sync.
 */

/** Sepolia deployment of the singleton hUSD token shared across multisigs. */
export const HUSD_ADDRESS = "0xD72DD55D40289beF71a7ef309a7DDd8208809c71" as const;
export const HUSD_DECIMALS = 6;
export const HUSD_SYMBOL = "hUSD";
export const HUSD_NAME = "Hidden USD";
