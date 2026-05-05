/**
 * Minimal ABI fragments for HiddenMultisig used by the relayer service.
 * Keep in sync with packages/hardhat/contracts/HiddenMultisig.sol.
 */
export const HIDDEN_MULTISIG_ABI = [
  // Views
  'function relayer() view returns (address)',
  'function initialized() view returns (bool)',
  'function threshold() view returns (uint8)',
  'function ownersLength() view returns (uint256)',
  'function activeOwnerCount() view returns (uint256)',
  'function isActive(uint256) view returns (bool)',
  'function nextPropId() view returns (uint256)',
  'function getReadyHandle(uint256) view returns (bytes32)',
  'function getProposal(uint256) view returns (uint8 ptype, bytes data, uint256 approvalAttempts, bool decryptionPending, bool executed, bool ready, uint256 createdAt)',
  // Init / proposals
  'function initialize(bytes32[] encOwners, bytes proof, uint8 _threshold)',
  'function proposeTransfer(address to, uint256 amount, address token) returns (uint256)',
  'function proposeSetThreshold(uint8 newThreshold) returns (uint256)',
  'function proposeAddSigner(bytes32 encNewOwner, bytes proof) returns (uint256)',
  'function proposeRemoveSigner(uint256 idx) returns (uint256)',
  // Approve / execute
  'function approve(uint256 propId, bytes32 encSigner, bytes proof)',
  'function requestExecute(uint256 propId)',
  'function finalizeExecute(uint256 propId, bytes abiEncodedCleartexts, bytes decryptionProof)',
  // Events
  'event Initialized(uint8 threshold, uint256 ownersCount)',
  'event ProposalCreated(uint256 indexed propId, uint8 ptype)',
  'event Approved(uint256 indexed propId, uint256 attempts)',
  'event ExecutionRequested(uint256 indexed propId, bytes32 readyHandle)',
  'event Executed(uint256 indexed propId, uint8 ptype, bool ready)',
  'event Deposit(address indexed from, uint256 value)',
] as const;
