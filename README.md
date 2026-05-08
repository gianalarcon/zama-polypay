# Polypay-Zama

A confidential multisig payroll demo on Sepolia, built on [Zama Protocol](https://docs.zama.org/protocol)'s Fully Homomorphic Encryption (FHE).

Two contracts compose the privacy story:
- **HiddenMultisig** — encrypts who's in the multisig and who voted on each proposal.
- **HiddenERC20 (hUSD)** — a confidential token where balances are encrypted on-chain.

-----
- Repo: [github.com/gianalarcon/zama-polypay](https://github.com/gianalarcon/zama-polypay)
- Network: Sepolia (chainId `11155111`)
- Deployed hUSD: `0xD72DD55D40289beF71a7ef309a7DDd8208809c71`

---

## Privacy at a glance

| What | Public on Etherscan? |
|---|---|
| Multisig contract address, signer count | Yes |
| Recipient address of a payment | Yes |
| **Token balance of any address (multisig or user)** | **Hidden** (encrypted handle) |
| **Transfer amount in the hUSD `Transfer` event** | **Hidden** (event has no amount field) |
| **Identities of signers (who's in the multisig)** | **Hidden** (encrypted owner array) |
| **Who approved or denied a proposal** | **Hidden** (encrypted bitmap) |
| **Approval count vs. threshold** | **Hidden** (encrypted counter; only the met-or-not boolean is published at execute time) |
| **Demo limitation: proposal recipient + amount stored on the multisig** | **Public** — see note below |

> **Demo limitation.** `HiddenMultisig.proposeTransfer(to, amount)` stores `(to, amount)` in plaintext inside the proposal so signers can review what they're voting on. Anyone can call `multisig.getProposal(propId)` and read both. The hUSD layer itself stays fully encrypted (balance + transfer event), but the multisig leaks the proposal's (to, amount) pair. To close this leak, the proposal would need to store an encrypted amount handle and signers would have to `userDecrypt` to review — out of scope for this hackathon build.

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    FE[Next.js frontend<br/>Wallet connect<br/>Zama relayer SDK]
  end

  subgraph Backend
    BE[NestJS relayer<br/>Submits all on-chain txs<br/>Decrypts hUSD balances]
  end

  subgraph Sepolia
    HM[HiddenMultisig<br/>encrypted owners + bitmap]
    HUSD[HiddenERC20 hUSD<br/>encrypted balances]
  end

  subgraph Zama
    GW[Gateway HTTP API]
    KMS[KMS<br/>threshold decryption]
  end

  FE --> BE
  BE --> HM
  BE --> HUSD
  HM <--> KMS
  BE <--> GW
  GW <--> KMS
```

### How the pieces fit

- **Identity = pseudonym, not wallet address.** A signer signs the message `Polypay-Zama identity v1` once with their wallet. The signature is hashed twice into a 20-byte commitment. The same wallet always re-derives the same commitment, so no backup is needed. The commitment is what the multisig stores (encrypted) and what the backend persists. The wallet address never leaves the browser.
- **HiddenMultisig.** Owners are stored as `eaddress[]` (encrypted commitments). Approving submits an encrypted commitment; the contract uses `FHE.eq` against every owner and increments an encrypted `euint8` counter only on a fresh first-time match (a per-proposal `ebool[]` bitmap prevents double-counting). When the encrypted counter reaches the threshold, the contract publishes only a met-or-not boolean for KMS to decrypt.
- **HiddenERC20 (hUSD).** Balances live as `mapping(address => euint64)`. `transfer` takes an externally-encrypted amount + ZKPoK proof. FHE arithmetic (`FHE.add` / `FHE.sub`) updates the ciphertexts on-chain. The `Transfer` event emits only `(from, to)` — no amount field at all.
- **Relayer.** A single backend EOA submits every on-chain tx so `msg.sender` never leaks a signer's wallet. The same EOA holds an FHE ACL on every hUSD balance so the backend can decrypt and show plaintext balances to authorised users in the app.

---

## Setup

### Prerequisites

- Node.js ≥ 20.18.3
- Yarn 3 (Berry, ships with the repo)
- Docker + Docker Compose
- A Sepolia wallet with ~0.1 ETH for the relayer EOA

### 1. Clone and install

```bash
git clone git@github.com:gianalarcon/zama-polypay.git
cd zama-polypay
yarn install
```

### 2. Start Postgres

The compose file lives under `docker/`. From the repo root:

```bash
docker compose -f docker/docker-compose.yml up postgres -d
```

(Or `cd docker && docker compose up postgres -d`.)

### 3. Configure environment (only secrets)

```bash
# packages/backend/.env
RELAYER_PRIVATE_KEY=0x<your relayer EOA>
DATABASE_URL=postgresql://polypay:polypay@localhost:5433/polypay_zama

# packages/hardhat/.env  (only if you want to deploy your own contracts)
DEPLOYER_PRIVATE_KEY=0x<deployer key>
RELAYER_ADDRESS=0x<same EOA as RELAYER_PRIVATE_KEY above>
```

The frontend has no `.env` — defaults are baked in.

### 4. Apply database migrations

```bash
yarn workspace @polypay-zama/backend prisma:migrate
```

### 5. (Optional) Deploy your own hUSD

Skip this and use the shared one (`0xD72DD55D40289beF71a7ef309a7DDd8208809c71`). To deploy fresh:

```bash
cd packages/hardhat
yarn deploy --tags HiddenERC20 --network sepolia
# update HUSD_ADDRESS in packages/shared/src/contracts/husd-config.ts
yarn workspace @polypay/shared build
```

### 6. Run

```bash
# Terminal 1 — backend
yarn workspace @polypay-zama/backend start:dev    # http://localhost:4000

# Terminal 2 — frontend
yarn workspace @polypay-zama/frontend dev         # http://localhost:3000
```

---

## End-to-end demo

> Easiest with two browser profiles so you can play signer A and signer B.

1. Open http://localhost:3000, connect wallet (Sepolia).
2. Click **Generate Membership ID**, sign `Polypay-Zama identity v1` in MetaMask. Your commitment lands in `localStorage`.
3. Go to `/dashboard/new-account`, name the account, add yourself + a second signer's commitment, set threshold (e.g. 2-of-2), Create. Wait ~30–60 s for FHE encrypt + deploy + initialize.
4. `/mint`, tab **Mint to wallet**: enter `1000`, Mint. Wallet balance card flips once the relayer can decrypt it.
5. `/mint`, tab **Deposit to multisig**: enter `100`, Deposit. The browser FHE-encrypts the amount and your wallet signs the prepared `hUSD.transfer(multisig, encAmount, proof)` call.
6. `/transfer`: recipient + amount, Submit Proposal. Backend submits and auto-approves on your behalf.
7. Switch to signer B's wallet, reload, Approve the proposal. Realtime WebSocket pushes the vote — the row updates without a refetch.
8. With the threshold met, click **Execute**. Three on-chain steps run: `requestExecute` → KMS public-decrypt → `finalizeExecute` (which dispatches `hUSD.transfer` with a freshly encrypted amount).
9. The row flips to a **Succeed** badge linking to Etherscan.
10. Verify on Etherscan: the hUSD `Transfer` event has no amount; balances all read as ciphertext handles. Open the multisig contract → you'll see the proposal's plaintext `(to, amount)` if you call `getProposal(propId)` (the demo limitation called out above).

---

## Tech stack

- **Frontend**: Next.js 15, React 19, RainbowKit 2, wagmi 2, viem 2, `@zama-fhe/relayer-sdk` (web), Tailwind CSS 4, TanStack Query 5, Zustand.
- **Backend**: NestJS 11, Prisma 5 + Postgres, ethers 6, `@zama-fhe/relayer-sdk` (node), socket.io.
- **Contracts**: Solidity 0.8.27, `@fhevm/solidity`, Hardhat + hardhat-deploy.
- **Network**: Sepolia (Zama Protocol's only supported testnet at time of writing).

---

## Limitations

- **Sepolia only.** Zama FHE coprocessor + KMS aren't on mainnet yet.
- **Recipient address stays public.** EVM transfers need a plaintext destination to update storage. Hiding the recipient too would need a stealth-address scheme — out of scope.
- **Proposal amount + recipient are public.** Stored in plaintext on the multisig (see demo limitation above). The hUSD `Transfer` event itself stays encrypted; only the multisig's proposal record leaks.
- **Relayer is a trusted operator.** It holds an FHE ACL on every balance, so it can decrypt any user's hUSD. Acceptable for a demo; production would split this across a multi-party operator.
- **Latency.** Each on-chain action is bounded by a Sepolia block (~12 s) plus FHE encrypt + ZKPoK proof generation (~5–15 s). Propose → execute end-to-end is ~60–90 s.
- **Balance read takes 2–4 s.** It does an `eth_call` to `balanceOf` plus a Zama Gateway + KMS userDecrypt round-trip.
- **No batch transfers.** A proposal moves one recipient at a time.

---

## Repo layout

```
packages/
├── hardhat/        Solidity (HiddenMultisig.sol, HiddenERC20.sol) + deploy scripts
├── backend/        NestJS relayer (REST + WebSocket), Prisma schema, FHE helpers
├── nextjs/         Frontend — /dashboard, /transfer, /mint, /dashboard/new-account
└── shared/         Cross-package types, DTOs, contract artifacts (ABI + bytecode + addresses)
```

---

## Disclaimer

Hackathon code, not audited. The relayer EOA is a single point of trust. Don't use mainnet funds. Forked from the original [Polypay](https://github.com/Poly-pay/polypay_app) (zkVerify + Horizen) and rewritten for Zama Protocol.
