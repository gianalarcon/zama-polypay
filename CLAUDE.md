# CLAUDE.md - Polypay-Zama

## What this is
A confidential multisig payroll dApp on Sepolia using Zama FHE. Hackathon MVP, 5 days build.

Origin: stripped from `Poly-pay/polypay_app` (legacy zkVerify+Horizen version), rewritten for Zama FHE on Sepolia. Fresh git history.

## Scope

### In
- 1 multisig contract per wallet (fixed N=5 owners at deploy)
- 4 proposal types: Transfer, SetThreshold, AddSigner (append-only), RemoveSigner (soft delete)
- Tokens: native ETH + USDC on Sepolia
- Hide: signer identity (FHE on `eaddress`)
- Relayer (single hot wallet) submits all approve/execute txs

### Out
- Batch transfers
- Contact book
- Quest, leaderboard, x402 deposits, recurring payments, escrow
- JWT auth (wallet connect only for hackathon)
- Multi-chain (Sepolia only)

## Key design decisions

- **Encrypted owner array** `eaddress[]` instead of `bytes32 commitments[]`.
- **Encrypted approval bitmap** `ebool[] hasSigned` per proposal — replaces nullifiers (FHE has no hash).
- **Encrypted approval counter** `euint8` — incremented only on first-time match.
- **Threshold check** = `FHE.ge(counter, threshold)` then async `FHE.requestDecryption`.
- **Execute via callback** — Gateway/KMS callback flips `executed` flag and runs transfer.
- **Soft remove** — public `bool[] isActive` parallel to encrypted `owners[]`. Skips inactive in approve loop. Index never shifts.

## Stack pinned
- Solidity 0.8.24+ (FHE requirement)
- `@fhevm/solidity` (latest)
- `@zama-fhe/relayer-sdk` (latest, both FE and BE)
- Network: Sepolia (chain id 11155111)

## Repo layout (post-strip)

```
packages/
├── hardhat/        # Solidity contracts (rewrite for Zama)
├── backend/        # NestJS — keep auth-less, swap zkverify → zama module
├── nextjs/         # Frontend — keep dashboard + transfer routes
└── shared/         # DTOs
docker/             # Postgres + dev compose
```

## What still needs cleanup
- `packages/backend/src/app.module.ts` — references removed modules; needs trim.
- `packages/nextjs` — Noir/bb.js deps + `useGenerateProof` hook still present; remove and replace with Zama SDK.
- `packages/hardhat/hardhat.config.ts` — currently configured for Horizen; switch to Sepolia + add fhevm plugin.
- Prisma schema — drop legacy fields (`commitment`, etc.), add `encryptedOwners`, `decryptReqId`, `walletAddress`.

## Behavior rules
- Reply Vietnamese; code/comments/commits English.
- One topic at a time. Wait for confirmation before advancing.
- Fetch latest Zama docs (https://docs.zama.org/protocol). Don't trust training data for SDK signatures.
- Mark uncertain claims `[inference]` / `[estimate]`.
- No emojis in code/comments/commits.
- `rg` not `grep`, `fd` not `find`.
- Never read `.env` / credentials.
