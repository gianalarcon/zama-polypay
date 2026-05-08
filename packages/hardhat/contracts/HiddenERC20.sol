// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { FHE, euint64, externalEuint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title HiddenERC20 ("hUSD" — Hidden USD)
/// @notice Confidential ERC20-like token used by Polypay-Zama for payroll.
///         Balances are stored as encrypted euint64 handles; transfer amounts
///         travel as externally-encrypted inputs validated via ZKPoK at the
///         contract boundary. Etherscan can see that a transfer happened
///         (sender, recipient, ciphertext handle) but cannot read the amount
///         or any balance.
/// @dev    Privacy boundary documentation:
///           - PUBLIC observer: sees nothing (ciphertext handles only).
///           - HOLDER: can decrypt own balance via FHE ACL (`userDecrypt`).
///           - RELAYER: granted ACL to every balance so the backend can
///             expose balance figures to authenticated signers in the app.
///             This is a deliberate trade-off — privacy is asserted vs the
///             public, not vs the trusted operator.
contract HiddenERC20 is ZamaEthereumConfig {
    string public constant name = "Hidden USD";
    string public constant symbol = "hUSD";
    uint8 public constant decimals = 6;

    /// @notice The relayer EOA that operates the Polypay-Zama backend.
    ///         It is granted FHE ACL access to every balance so the
    ///         backend can decrypt and serve balance views to signers.
    address public immutable relayer;

    mapping(address => euint64) internal _balances;

    event Transfer(address indexed from, address indexed to);
    event Mint(address indexed to);

    constructor(address _relayer) {
        require(_relayer != address(0), "relayer required");
        relayer = _relayer;
    }

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    /// @notice Encrypted balance of `holder`. Caller must decrypt off-chain
    ///         via the FHE gateway (userDecrypt) — only addresses present in
    ///         the handle's ACL succeed.
    function balanceOf(address holder) external view returns (euint64) {
        return _balances[holder];
    }

    // -----------------------------------------------------------------------
    // Writes
    // -----------------------------------------------------------------------

    /// @notice Public faucet-style mint: anyone can mint to themselves with a
    ///         plaintext amount (testnet only). Encrypts the amount on-chain
    ///         and credits the caller's encrypted balance.
    function mint(uint64 amount) external {
        euint64 enc = FHE.asEuint64(amount);
        euint64 newBalance = FHE.add(_balances[msg.sender], enc);
        _balances[msg.sender] = newBalance;
        _grantBalanceACL(msg.sender);
        emit Mint(msg.sender);
    }

    /// @notice Confidential transfer. Caller pre-encrypts the amount via
    ///         the relayer SDK bound to (this contract, msg.sender) and
    ///         provides the ZKPoK input proof.
    function transfer(address to, externalEuint64 encAmount, bytes calldata inputProof) external returns (bool) {
        require(to != address(0), "to=0");
        euint64 amount = FHE.fromExternal(encAmount, inputProof);
        _transfer(msg.sender, to, amount);
        return true;
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    function _transfer(address from, address to, euint64 amount) internal {
        // Encrypted arithmetic. No revert on insufficient balance — FHE has
        // no observable comparison without a decryption roundtrip; relayer
        // is expected to gate at the application layer (Polypay-Zama
        // multisig refuses transfers above the visible plaintext amount in
        // the proposal).
        _balances[from] = FHE.sub(_balances[from], amount);
        _balances[to] = FHE.add(_balances[to], amount);
        _grantBalanceACL(from);
        _grantBalanceACL(to);
        emit Transfer(from, to);
    }

    /// @dev Grant FHE ACL: holder + relayer can decrypt the holder's balance.
    function _grantBalanceACL(address holder) internal {
        FHE.allowThis(_balances[holder]);
        FHE.allow(_balances[holder], holder);
        FHE.allow(_balances[holder], relayer);
    }
}
