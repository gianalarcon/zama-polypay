/**
 * Per-package constants for the Polypay-Zama relayer service.
 *
 * Order of PROPOSAL_TYPES MUST match the ProposalType enum in
 * `packages/hardhat/contracts/HiddenMultisig.sol`.
 */
export const CHAIN_ID = 11155111;

/** Public Sepolia RPC default. Env `SEPOLIA_RPC_URL` overrides if set. */
export const DEFAULT_SEPOLIA_RPC_URL = 'https://ethereum-sepolia.publicnode.com';

export const PROPOSAL_TYPES = ['Transfer', 'SetThreshold', 'AddSigner', 'RemoveSigner'] as const;
export type ProposalTypeName = (typeof PROPOSAL_TYPES)[number];
