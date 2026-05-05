# Polypay-Zama

A confidential multisig payroll dApp on Sepolia powered by Zama's Fully Homomorphic Encryption (FHE).

> **Hide signers, not amounts.** Owner addresses are stored as `eaddress[]`; approvals authenticate via FHE equality; the threshold check is decided through an off-chain KMS public-decryption verified on-chain. Recipients and transfer amounts stay public for compliance.

## Privacy model

| Public on Sepolia | Hidden |
|---|---|
| Recipient, transfer amount, threshold value | Owner addresses (encrypted set) |
| Relayer EOA (single submitter for every tx) | Signer EOAs (anonymous behind the relayer) |
| Per-proposal approval attempt count | Which owner approved (encrypted bitmap) |
| Whether threshold was met after `finalizeExecute` | True approval count (encrypted counter) |

## Architecture

```
┌──────────┐ encrypt addr (FHE)    ┌─────────┐ ethers tx     ┌────────────┐
│ Browser  ├──────────────────────►│ Relayer │──────────────►│ Sepolia    │
│ (FE SDK) │                       │ (NestJS)│               │ HiddenMs.. │
└──────────┘                       └────┬────┘               └────┬───────┘
                                        │                         │ event
                                        │ publicDecrypt           │ FHE op
                                        ▼                         ▼
                                ┌──────────────┐           ┌─────────────┐
                                │ Zama Gateway │◄──────────┤ Coprocessor │
                                └──────┬───────┘           └─────────────┘
                                       │ decrypt
                                       ▼
                                  ┌────────┐
                                  │  KMS   │ (13 nodes, Nitro Enclaves)
                                  └────────┘
```

The relayer is the only EOA that submits transactions, so observers cannot link approvals to signer wallets.

## Repo layout

```
packages/
  hardhat/   # HiddenMultisig.sol, deploy script, mock-FHEVM tests
  backend/   # NestJS relayer service (single ZamaModule)
  nextjs/    # Demo UI (single page)
  shared/    # Legacy DTOs (kept but unused by demo)
```

## Quick start

### 0. Prerequisites

- Node.js >= 20.18.3
- Yarn (workspaces)
- 0.5+ Sepolia ETH on a dedicated relayer wallet ([Alchemy faucet](https://www.alchemy.com/faucets/ethereum-sepolia), [QuickNode faucet](https://faucet.quicknode.com/ethereum/sepolia))

### 1. Install

```bash
yarn install
```

### 2. Compile + test the contract

```bash
yarn workspace @polypay-zama/hardhat compile
yarn workspace @polypay-zama/hardhat test
```

12/12 mock-FHEVM tests should pass.

### 3. Deploy `HiddenMultisig` to Sepolia

```bash
cd packages/hardhat
cp ../../README.md . # placeholder; create .env from your secrets
cat <<EOF > .env
SEPOLIA_RPC_URL=https://sepolia.drpc.org
DEPLOYER_PRIVATE_KEY=0x<funded deployer key>
RELAYER_ADDRESS=0x<relayer EOA address>
EOF

yarn deploy:sepolia
```

The deploy script reads `RELAYER_ADDRESS` and bakes it into the immutable `relayer` field on the contract. Save the printed address — you'll need it as `MULTISIG_ADDRESS` for the backend.

### 4. Run the backend

```bash
cd packages/backend
cat <<EOF > .env
SEPOLIA_RPC_URL=https://sepolia.drpc.org
RELAYER_PRIVATE_KEY=0x<relayer hot-wallet key>
MULTISIG_ADDRESS=0x<deployed contract>
PORT=4000
API_PREFIX=api
CORS_ORIGIN=http://localhost:3000
EOF

yarn start:dev
```

Health check: `curl http://localhost:4000/api/zama/relayer`.

### 5. Run the frontend

```bash
cd packages/nextjs
cat <<EOF > .env.local
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
NEXT_PUBLIC_SEPOLIA_RPC_URL=https://sepolia.drpc.org
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<optional walletconnect id>
EOF

yarn dev
```

Open `http://localhost:3000` and:

1. Connect a Sepolia wallet (RainbowKit).
2. Paste 5 owner addresses + threshold (e.g. 3) into the **Initialize Multisig** form. Submit.
3. Fund the multisig contract on Sepolia with some ETH.
4. **Propose Transfer** with recipient + wei amount + token (`0x0…0` for ETH).
5. Switch RainbowKit account, click **Approve** as each owner. Each click encrypts the connected EOA into a fresh ciphertext bound to (multisig, relayer) and POSTs to `/api/zama/proposals/:id/approve`.
6. After `>= threshold` distinct owners approved, click **Execute**. The relayer runs `requestExecute → publicDecrypt → finalizeExecute`. Recipient receives the transfer when the encrypted threshold check decrypts to `true`.

## Scope

### In
- Single multisig contract per deployment, fixed N owners at init.
- 4 proposal types: `Transfer`, `SetThreshold`, `AddSigner` (append-only), `RemoveSigner` (soft-delete via public `isActive[]`).
- Tokens: native ETH and USDC (or any ERC-20).

### Out
- Batch transfers, contact book, recurring/escrow payments.
- JWT auth (wallet-connect only).
- Multi-chain (Sepolia only).
- Owner array compaction (use append + soft-delete instead).

## Status

Hackathon MVP — not audited, not production-ready. Forked-and-stripped from `Poly-pay/polypay_app`.

## License

[MIT](./LICENSE).
