// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, ebool, euint8, eaddress, externalEaddress } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title HiddenMultisig
/// @notice Confidential multisig payroll: signer identities are encrypted on-chain
///         using Zama FHE. Approvals authenticated by encrypted equality against
///         the encrypted owner set; threshold met-or-not is decided via an async
///         KMS decryption callback.
/// @dev    All approval txs go through a single relayer EOA so that msg.sender does
///         not leak the signer's wallet.
contract HiddenMultisig is SepoliaConfig {
    // -----------------------------------------------------------------------
    // Types
    // -----------------------------------------------------------------------

    enum ProposalType {
        Transfer,
        SetThreshold,
        AddSigner,
        RemoveSigner
    }

    struct Proposal {
        ProposalType ptype;
        bytes data;
        ebool[] hasSigned;
        euint8 approvalCount;
        bytes32 readyHandle;
        uint256 createdAt;
        uint256 approvalAttempts;
        bool decryptionPending;
        bool executed;
        bool ready;
    }

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    eaddress[] private _owners;
    bool[] public isActive;
    uint8 public threshold;
    bool public initialized;
    address public immutable relayer;

    mapping(uint256 => Proposal) private _proposals;
    uint256 public nextPropId;
    mapping(uint256 => uint256) private _decryptReqToProp;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event Initialized(uint8 threshold, uint256 ownersCount);
    event ProposalCreated(uint256 indexed propId, ProposalType ptype);
    event Approved(uint256 indexed propId, uint256 attempts);
    event ExecutionRequested(uint256 indexed propId, uint256 reqId);
    event Executed(uint256 indexed propId, ProposalType ptype, bool ready);
    event Deposit(address indexed from, uint256 value);

    // -----------------------------------------------------------------------
    // Modifiers
    // -----------------------------------------------------------------------

    modifier onlyRelayer() {
        require(msg.sender == relayer, "only relayer");
        _;
    }

    // -----------------------------------------------------------------------
    // Construction & initialization
    // -----------------------------------------------------------------------

    constructor(address _relayer) {
        require(_relayer != address(0), "bad relayer");
        relayer = _relayer;
    }

    /// @notice One-shot initialization: register encrypted owner addresses and threshold.
    /// @param encOwners array of encrypted owner addresses (externalEaddress = bytes32 handles)
    /// @param proof shared ZKPoK proving all encOwners are correctly encrypted
    /// @param _threshold required approvals to execute a proposal
    function initialize(externalEaddress[] calldata encOwners, bytes calldata proof, uint8 _threshold) external {
        require(!initialized, "already initialized");
        require(encOwners.length > 0 && encOwners.length <= 32, "owners count out of range");
        require(_threshold > 0 && _threshold <= encOwners.length, "threshold out of range");

        for (uint256 i = 0; i < encOwners.length; i++) {
            eaddress o = FHE.fromExternal(encOwners[i], proof);
            FHE.allowThis(o);
            _owners.push(o);
            isActive.push(true);
        }
        threshold = _threshold;
        initialized = true;
        emit Initialized(_threshold, encOwners.length);
    }

    // -----------------------------------------------------------------------
    // Proposals
    // -----------------------------------------------------------------------

    function proposeTransfer(address to, uint256 amount, address token) external onlyRelayer returns (uint256) {
        require(to != address(0), "bad recipient");
        require(amount > 0, "bad amount");
        bytes memory data = abi.encode(to, amount, token);
        return _createProposal(ProposalType.Transfer, data);
    }

    function proposeSetThreshold(uint8 newThreshold) external onlyRelayer returns (uint256) {
        require(newThreshold > 0, "bad threshold");
        bytes memory data = abi.encode(newThreshold);
        return _createProposal(ProposalType.SetThreshold, data);
    }

    /// @dev FHE.fromExternal is run NOW so that the resulting eaddress carries
    ///      contract-permanent ACL by the time the callback executes _execAddSigner.
    function proposeAddSigner(
        externalEaddress encNewOwner,
        bytes calldata proof
    ) external onlyRelayer returns (uint256) {
        eaddress newOwner = FHE.fromExternal(encNewOwner, proof);
        FHE.allowThis(newOwner);
        bytes32 handle = FHE.toBytes32(newOwner);
        bytes memory data = abi.encode(handle);
        return _createProposal(ProposalType.AddSigner, data);
    }

    function proposeRemoveSigner(uint256 idx) external onlyRelayer returns (uint256) {
        require(idx < _owners.length, "bad index");
        require(isActive[idx], "already inactive");
        bytes memory data = abi.encode(idx);
        return _createProposal(ProposalType.RemoveSigner, data);
    }

    function _createProposal(ProposalType ptype, bytes memory data) internal returns (uint256 propId) {
        require(initialized, "not initialized");
        propId = nextPropId++;
        Proposal storage p = _proposals[propId];
        p.ptype = ptype;
        p.data = data;
        p.createdAt = block.timestamp;

        // Initialize per-owner encrypted bitmap and approval counter to zero.
        for (uint256 i = 0; i < _owners.length; i++) {
            ebool init = FHE.asEbool(false);
            FHE.allowThis(init);
            p.hasSigned.push(init);
        }
        p.approvalCount = FHE.asEuint8(0);
        FHE.allowThis(p.approvalCount);

        emit ProposalCreated(propId, ptype);
    }

    // -----------------------------------------------------------------------
    // Approval
    // -----------------------------------------------------------------------

    /// @notice Submit an encrypted signer-address as an approval to a proposal.
    /// @dev Idempotent: a signer approving twice does NOT increment the counter,
    ///      because the encrypted bitmap blocks double-counting.
    function approve(uint256 propId, externalEaddress encSigner, bytes calldata proof) external onlyRelayer {
        Proposal storage p = _proposals[propId];
        require(p.createdAt != 0, "no proposal");
        require(!p.executed && !p.decryptionPending, "not approvable");

        eaddress submitted = FHE.fromExternal(encSigner, proof);

        for (uint256 i = 0; i < _owners.length; i++) {
            if (!isActive[i]) continue;

            ebool isMatch = FHE.eq(submitted, _owners[i]);
            ebool fresh = FHE.and(isMatch, FHE.not(p.hasSigned[i]));

            // Toggle bitmap (FHE.or is idempotent for repeat-sign).
            p.hasSigned[i] = FHE.or(p.hasSigned[i], isMatch);
            FHE.allowThis(p.hasSigned[i]);

            // Increment counter only on first-time match.
            euint8 delta = FHE.select(fresh, FHE.asEuint8(1), FHE.asEuint8(0));
            p.approvalCount = FHE.add(p.approvalCount, delta);
            FHE.allowThis(p.approvalCount);
        }

        p.approvalAttempts += 1;
        emit Approved(propId, p.approvalAttempts);
    }

    // -----------------------------------------------------------------------
    // Execution (async via KMS decryption callback)
    // -----------------------------------------------------------------------

    function requestExecute(uint256 propId) external onlyRelayer {
        Proposal storage p = _proposals[propId];
        require(p.createdAt != 0, "no proposal");
        require(!p.executed && !p.decryptionPending, "not executable");

        ebool ready = FHE.ge(p.approvalCount, FHE.asEuint8(threshold));
        FHE.allowThis(ready);

        bytes32 handle = FHE.toBytes32(ready);
        p.readyHandle = handle;
        p.decryptionPending = true;

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = handle;
        uint256 reqId = FHE.requestDecryption(cts, this.onExecuteCallback.selector);
        _decryptReqToProp[reqId] = propId;

        emit ExecutionRequested(propId, reqId);
    }

    /// @notice KMS decryption callback. Anyone can call; security is enforced by
    ///         FHE.checkSignatures verifying the cleartext against the bound handle.
    function onExecuteCallback(uint256 reqId, bytes memory cleartexts, bytes memory decryptionProof) public {
        uint256 propId = _decryptReqToProp[reqId];
        Proposal storage p = _proposals[propId];
        require(p.decryptionPending && !p.executed, "bad state");

        // Verify KMS signatures bind cleartexts to the recorded handle.
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = p.readyHandle;
        FHE.checkSignatures(cts, cleartexts, decryptionProof);

        bool ready = abi.decode(cleartexts, (bool));

        // Set state BEFORE external calls (reentrancy guard).
        p.executed = true;
        p.decryptionPending = false;
        p.ready = ready;

        if (ready) {
            ProposalType ptype = p.ptype;
            if (ptype == ProposalType.Transfer) _execTransfer(p.data);
            else if (ptype == ProposalType.SetThreshold) _execSetThreshold(p.data);
            else if (ptype == ProposalType.AddSigner) _execAddSigner(p.data);
            else if (ptype == ProposalType.RemoveSigner) _execRemoveSigner(p.data);
        }

        emit Executed(propId, p.ptype, ready);
    }

    // -----------------------------------------------------------------------
    // Internal executors
    // -----------------------------------------------------------------------

    function _execTransfer(bytes memory data) internal {
        (address to, uint256 amount, address token) = abi.decode(data, (address, uint256, address));
        if (token == address(0)) {
            (bool ok, ) = payable(to).call{ value: amount }("");
            require(ok, "ETH transfer failed");
        } else {
            (bool ok, bytes memory ret) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
            require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ERC20 transfer failed");
        }
    }

    function _execSetThreshold(bytes memory data) internal {
        uint8 newT = abi.decode(data, (uint8));
        uint256 active = activeOwnerCount();
        require(newT > 0 && newT <= active, "bad threshold");
        threshold = newT;
    }

    function _execAddSigner(bytes memory data) internal {
        bytes32 handle = abi.decode(data, (bytes32));
        eaddress o = eaddress.wrap(handle);
        FHE.allowThis(o);
        _owners.push(o);
        isActive.push(true);
    }

    function _execRemoveSigner(bytes memory data) internal {
        uint256 idx = abi.decode(data, (uint256));
        require(idx < _owners.length && isActive[idx], "bad index");
        require(activeOwnerCount() > threshold, "would break threshold");
        isActive[idx] = false;
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    function activeOwnerCount() public view returns (uint256 count) {
        for (uint256 i = 0; i < isActive.length; i++) {
            if (isActive[i]) count++;
        }
    }

    function ownersLength() external view returns (uint256) {
        return _owners.length;
    }

    function getProposal(
        uint256 propId
    )
        external
        view
        returns (
            ProposalType ptype,
            bytes memory data,
            uint256 approvalAttempts,
            bool decryptionPending,
            bool executed,
            bool ready,
            uint256 createdAt
        )
    {
        Proposal storage p = _proposals[propId];
        return (p.ptype, p.data, p.approvalAttempts, p.decryptionPending, p.executed, p.ready, p.createdAt);
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value);
    }
}
