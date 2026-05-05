/**
 * Frontend constants. Order of PROPOSAL_TYPES MUST stay in sync with
 * `packages/hardhat/contracts/HiddenMultisig.sol` and the backend
 * counterpart in `packages/backend/src/zama/constants.ts`.
 */
export const CHAIN_ID = 11155111;

export const PROPOSAL_TYPES = ["Transfer", "SetThreshold", "AddSigner", "RemoveSigner"] as const;
export type ProposalTypeName = (typeof PROPOSAL_TYPES)[number];
