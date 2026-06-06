# x402 Weather Shop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a working x402 payment-gated weather API as `projects/algo-safe-x402-shop/`, adapted from the hackathon reference template, and verify it returns HTTP 402 with valid Algorand payment requirements.

**Architecture:** Standalone Hono (Node + tsx) server, single source file, no database. Copied ~verbatim from the reference `seller/`. Returns `402` for paid routes, settles USDC on Algorand testnet via the public goplausible facilitator. Independent of the AlgoKit workspace build.

**Tech Stack:** TypeScript, Hono, `@x402/hono` + `@x402/core` + `@x402/avm`, tsx, dotenv, algosdk (placeholder-address generation only).

**Reference source:** `resources/x402-reference/seller/` (cloned template, deleted in the final task).

---

## File Structure

```
projects/algo-safe-x402-shop/
  src/index.ts        Hono server — copied verbatim from reference seller (sells weather; no code edits)
  package.json        copied from reference seller; "name" changed to algo-safe-x402-shop
  tsconfig.json       copied verbatim from reference seller
  .env.example        documents required/optional env vars
  .env                real config (gitignored) — SELLER_ADDRESS
  .gitignore          ignores .env, node_modules, logs/, dist/
  README.md           run + verify instructions
```

No edits to `src/index.ts`: the template's default routes already sell weather, which is exactly the goal. All customization is via `.env`.

---

### Task 1: Scaffold the project from the reference seller

**Files:**
- Create: `projects/algo-safe-x402-shop/src/index.ts` (copy)
- Create: `projects/algo-safe-x402-shop/package.json` (copy + rename)
- Create: `projects/algo-safe-x402-shop/tsconfig.json` (copy)

- [ ] **Step 1: Create the project dir and copy the three source files**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
mkdir -p projects/algo-safe-x402-shop/src
cp resources/x402-reference/seller/src/index.ts projects/algo-safe-x402-shop/src/index.ts
cp resources/x402-reference/seller/package.json   projects/algo-safe-x402-shop/package.json
cp resources/x402-reference/seller/tsconfig.json  projects/algo-safe-x402-shop/tsconfig.json
```

- [ ] **Step 2: Rename the package**

Edit `projects/algo-safe-x402-shop/package.json`: change the `"name"` field from `"seller"` to `"algo-safe-x402-shop"`. Leave everything else (scripts, dependencies, versions) untouched.

- [ ] **Step 3: Verify the copy is intact**

Run:
```bash
ls projects/algo-safe-x402-shop/src/index.ts && grep -c "x402ResourceServer" projects/algo-safe-x402-shop/src/index.ts
```
Expected: the path prints and the grep count is `>= 1` (the server wiring is present).

- [ ] **Step 4: Commit**

```bash
git add projects/algo-safe-x402-shop/src/index.ts projects/algo-safe-x402-shop/package.json projects/algo-safe-x402-shop/tsconfig.json
git commit -m "Scaffold x402 weather shop from reference seller"
```

---

### Task 2: Add config, ignore rules, and README

**Files:**
- Create: `projects/algo-safe-x402-shop/.env.example`
- Create: `projects/algo-safe-x402-shop/.gitignore`
- Create: `projects/algo-safe-x402-shop/README.md`

- [ ] **Step 1: Write `.env.example`**

```bash
# Required — Algorand TESTNET address that receives payments.
SELLER_ADDRESS=

# Optional (defaults shown)
FACILITATOR_URL=https://facilitator.goplausible.xyz
PORT=4021
NETWORK=testnet
SELLER_WEATHER_PRICE=0.001
SELLER_FORECAST_PRICE=0.005
# WEBHOOK_URL=
LOG_DIR=./logs
RATE_LIMIT_RPM=30
RATE_LIMIT_WINDOW_MS=60000
```

- [ ] **Step 2: Write `.gitignore`**

```
.env
node_modules/
logs/
dist/
```

- [ ] **Step 3: Write `README.md`**

````markdown
# algo-safe-x402-shop

An x402 payment-gated weather API — the "shop" an AI agent pays via the x402
protocol. Returns HTTP 402 with Algorand payment requirements and delivers
weather only after a USDC payment settles on Algorand testnet (via the
goplausible facilitator). Adapted from the `camohe90/x402` hackathon template.

## Endpoints

| Method | Path        | Price        | Notes              |
| ------ | ----------- | ------------ | ------------------ |
| GET    | `/health`   | free         | status + catalog   |
| GET    | `/`         | free         | service metadata   |
| GET    | `/weather`  | $0.001 USDC  | current conditions |
| GET    | `/forecast` | $0.005 USDC  | 7-day forecast     |
| POST   | `/analyze`  | $0.002 USDC  | example POST route |

## Run

```bash
cp .env.example .env          # then set SELLER_ADDRESS to a testnet address
npm install
npm run dev                   # tsx server on http://localhost:4021
```

## Verify (no funds — gating check)

```bash
curl -s http://localhost:4021/health           # -> 200 JSON
curl -s -i http://localhost:4021/weather        # -> HTTP/1.1 402, PAYMENT-REQUIRED header
```

A `402` carrying payment requirements (scheme `exact`, Algorand testnet,
`payTo`, price) confirms the shop is correctly gated.

## Verify (full on-chain loop — needs testnet funds)

Use the reference template's bundled buyer (`resources/x402-reference/buyer`)
with an account funded with testnet ALGO (fees) + testnet USDC (ASA `10458941`).
Faucets: ALGO `bank.testnet.algorand.network`, USDC `faucet.circle.com`
(select Algorand Testnet). Expect `402 -> sign -> settle -> 200 + weather`,
with the txid in `logs/payments.jsonl`.
````

- [ ] **Step 4: Commit**

```bash
git add projects/algo-safe-x402-shop/.env.example projects/algo-safe-x402-shop/.gitignore projects/algo-safe-x402-shop/README.md
git commit -m "Add x402 shop config, gitignore, and README"
```

---

### Task 3: Install dependencies and confirm `@x402/*` resolve

**Files:**
- Create: `projects/algo-safe-x402-shop/package-lock.json` (generated)
- Create: `projects/algo-safe-x402-shop/node_modules/` (generated, gitignored)

- [ ] **Step 1: Install**

Run:
```bash
cd /Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-x402-shop && npm install
```
Expected: install completes with no `ETARGET`/`404` errors. The `@x402/hono`, `@x402/core`, `@x402/avm` packages resolve.

- [ ] **Step 2: Fallback if a version fails to resolve**

If `npm install` errors on an `@x402/*` version, copy the proven lockfile and node_modules resolution from the reference and retry:
```bash
cp /Users/sid/Desktop/Projects/algo-safe/resources/x402-reference/package-lock.json /Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-x402-shop/package-lock.json
npm install
```
If it still fails, inspect `resources/x402-reference/package-lock.json` for the exact resolved `@x402/*` versions and pin those in `package.json`, then reinstall. Do not proceed until install succeeds.

- [ ] **Step 3: Type-check compiles**

Run:
```bash
npx tsc --noEmit
```
Expected: exits 0 (no type errors). If the reference `tsconfig.json` lacks `skipLibCheck` and third-party types error, that is acceptable to ignore only if `tsx` still runs the server in Task 4 — note any errors but prioritize a running server.

- [ ] **Step 4: Commit the lockfile**

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-x402-shop/package-lock.json
git commit -m "Add x402 shop lockfile (pinned working @x402/* versions)"
```

---

### Task 4: Verification A — gating check (no funds)

**Files:**
- Create: `projects/algo-safe-x402-shop/.env` (gitignored — not committed)

- [ ] **Step 1: Generate a valid placeholder testnet address and write `.env`**

The server exits at startup unless `SELLER_ADDRESS` is set to a valid Algorand
address. For the gating check any valid address works (no funds move). Generate one:

```bash
cd /Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-x402-shop
PLACEHOLDER_ADDR=$(node -e "const a=require('algosdk');console.log(a.generateAccount().addr)")
printf 'SELLER_ADDRESS=%s\n' "$PLACEHOLDER_ADDR" > .env
cat .env
```
Expected: `.env` contains `SELLER_ADDRESS=` followed by a 58-character address. (algosdk is a transitive dep available via node_modules; if `require('algosdk')` is not found, run `npm install algosdk --no-save` first.)

- [ ] **Step 2: Start the server in the background**

```bash
cd /Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-x402-shop && npm run dev
```
Run this in the background. Expected log: `[seller] x402 Resource Server ready` and `URL: http://localhost:4021`.

- [ ] **Step 3: Check the free health endpoint**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:4021/health
```
Expected: `200`.

- [ ] **Step 4: Check the paid endpoint returns 402 with payment requirements**

Run:
```bash
curl -s -i http://localhost:4021/weather | head -n 30
```
Expected: status line `HTTP/1.1 402 Payment Required`, and a `PAYMENT-REQUIRED` (or `payment-required`) header present. Decode it to confirm it carries `accepts[]` with the testnet network, the generated `payTo`, and a price:
```bash
curl -s -D - -o /dev/null http://localhost:4021/weather | grep -i payment-required
```
Expected: a non-empty base64 header value. (Decoding with `base64 -d` should reveal JSON containing `payTo`, `scheme":"exact"`, and the Algorand testnet network id.)

- [ ] **Step 5: Stop the server**

Stop the background server process.

- [ ] **Step 6: Record verification in the README and commit**

Append a short "Verified (gating check A): /health 200, /weather 402 with payment requirements on <date>" line to the README's verify section, then:
```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-x402-shop/README.md
git commit -m "Verify x402 shop gating check (402 with payment requirements)"
```

---

### Task 5: Cleanup the reference clone

**Files:**
- Delete: `resources/x402-reference/`

- [ ] **Step 1: Confirm the shop no longer depends on the clone**

The clone was only a copy source. Confirm the project stands alone:
```bash
ls /Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-x402-shop/src/index.ts
ls /Users/sid/Desktop/Projects/algo-safe/projects/algo-safe-x402-shop/node_modules >/dev/null && echo "deps present"
```
Expected: file exists and `deps present` prints.

- [ ] **Step 2: Decide on the clone**

If Verification B (full on-chain loop) is NOT yet done, KEEP `resources/x402-reference` — its `buyer/` is needed for B. Skip deletion and note this. Only delete once B is complete or the user confirms B will not be run.

If B is done or declined, remove the clone:
```bash
rm -rf /Users/sid/Desktop/Projects/algo-safe/resources/x402-reference
rmdir /Users/sid/Desktop/Projects/algo-safe/resources 2>/dev/null || true
```
Expected: `resources/` is gone (already gitignored, so no commit needed).

---

### Task 6 (user-gated): Verification B — full on-chain payment loop

> Prerequisite: the user provides a funded Algorand **testnet** account mnemonic
> (ALGO for fees + testnet USDC) and the `SELLER_ADDRESS` they want to receive to.
> Do not run until those are provided.

**Files:**
- Modify: `projects/algo-safe-x402-shop/.env` (set real `SELLER_ADDRESS`)
- Modify: `resources/x402-reference/.env` (set `BUYER_MNEMONIC`, `SELLER_URL`)

- [ ] **Step 1: Point the shop at the real receiving address**

Set `SELLER_ADDRESS` in `projects/algo-safe-x402-shop/.env` to the user's testnet address. Restart the shop (`npm run dev`).

- [ ] **Step 2: Configure and run the bundled buyer**

In `resources/x402-reference/`, create `.env` from `.env.example` with `BUYER_MNEMONIC=<user's 25-word testnet mnemonic>` and `SELLER_URL=http://localhost:4021`, then:
```bash
cd /Users/sid/Desktop/Projects/algo-safe/resources/x402-reference && npm install && npm run buyer:server
```
(Or drive a single buy with the buyer client per the reference README.)

- [ ] **Step 3: Trigger a paid request and confirm settlement**

Drive the buyer to `GET /weather`. Expected: the buyer logs `402 -> sign -> settle -> 200`, the shop returns weather JSON, and a new line appears in `projects/algo-safe-x402-shop/logs/payments.jsonl` with a `txid`.

- [ ] **Step 4: Confirm on-chain**

Look up the txid on `lora.algokit.io/testnet`. Expected: a confirmed USDC transfer to `SELLER_ADDRESS`.

- [ ] **Step 5: Record and clean up**

Append "Verified (full loop B): testnet txid <id> on <date>" to the README, commit, then run Task 5 Step 2's deletion to remove the clone.

```bash
cd /Users/sid/Desktop/Projects/algo-safe
git add projects/algo-safe-x402-shop/README.md
git commit -m "Verify x402 shop full on-chain payment loop"
```

---

## Notes

- **No push.** Per CLAUDE.md, nothing is pushed to any remote without explicit in-the-moment instruction. All commits above are local.
- **`docs/` is globally gitignored** on this machine; this plan file (like the spec) is intentional and may be force-added if it should be tracked.
- **No `.algokit.toml` changes.** The shop is a standalone Node server, deliberately not part of the AlgoKit workspace build.
