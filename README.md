# Polypay-Zama

A confidential multisig payroll platform on Sepolia powered by Zama's Fully Homomorphic Encryption (FHE).

> **Hide signers, not amounts.** Use Zama's FHE coprocessor to keep multisig signer identities private while keeping recipients and amounts public for compliance.

## What it does

- **Confidential multisig**: signer identities are encrypted on-chain (`eaddress[]`).
- **Anonymous approvals**: signers approve through a relayer; `msg.sender` reveals nothing.
- **Threshold check via FHE**: encrypted approval counter; threshold met-or-not is decided by Zama KMS via async callback.
- **Payroll transfers**: ETH and USDC payments to public recipients.
- **Multisig governance**: add signer, soft-remove signer, update threshold — all gated by the same approval flow.

## Tech stack

| Layer | Stack |
|---|---|
| FHE primitives | `@fhevm/solidity`, Zama Sepolia coprocessor + KMS |
| Smart contracts | Solidity 0.8.x, Hardhat, `@fhevm/hardhat-plugin` |
| Frontend | Next.js 15, React 19, wagmi, viem, RainbowKit, `@zama-fhe/relayer-sdk` |
| Backend | NestJS 11, Prisma 7 + PostgreSQL, Socket.io, JWT-less |
| Network | Sepolia (testnet) |

## Privacy model

| Public | Hidden |
|---|---|
| Recipient address | Owner addresses (encrypted set) |
| Transfer amount | Which owner approved which proposal |
| Threshold value | Approval counter (encrypted) |
| Relayer EOA | Signer EOAs |

## Status

Hackathon MVP — not audited, not production-ready.

## License

MIT — see [LICENSE](./LICENSE).
