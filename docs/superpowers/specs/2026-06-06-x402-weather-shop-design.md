# x402 Weather Shop — Design

**Date:** 2026-06-06
**Status:** Approved (design); verification approach A-then-B
**Context:** Algorand x402 hackathon. Builds the "shop" (resource server) an AI agent pays via the x402 HTTP-native payment protocol — the counterparty to Algo Safe's agentic-payments story.

## Goal

A working, payment-gated weather API: an HTTP server that returns `402 Payment Required` with Algorand payment requirements, and delivers weather data only after an on-chain USDC payment is verified and settled. Scope is **shop only** — no buyer and no UI of our own (payment is tested with the reference template's bundled client).

This is an adaptation of the official hackathon template `camohe90/x402` (`seller/`), brought into this repo as its own project. The template already implements a working weather shop; the work is integration, configuration, and verification — not a from-scratch build.

## Non-goals

- Building a buyer/agent or a paywall UI (out of scope — "shop only").
- Building our own facilitator (we use the public goplausible facilitator).
- Wiring the shop into the AlgoKit workspace build (`.algokit.toml`). It is a standalone Node/tsx server.
- Mainnet. Testnet only.
- Recreating the slide's EURD currency. The template settles in **USDC** on Algorand testnet (ASA `10458941`); we keep USDC.

## Architecture

Standalone Hono server (Node + tsx), single source file, no database. Communicates over HTTP with any x402-capable client and with the facilitator.

```
projects/algo-safe-x402-shop/
  src/index.ts        Hono server (copied from reference seller, kept ~as-is)
  package.json        copied from reference seller (pins working @x402/* versions)
  tsconfig.json       copied
  .env.example        documents required/optional vars
  .env                real config (gitignored) — holds SELLER_ADDRESS
  .gitignore          ignores .env, logs/, node_modules
  README.md           run + verify instructions
  logs/               payments.jsonl (gitignored, created at runtime)
```

Lives alongside `algo-safe-contracts` and `algo-safe-frontend` but is independent of them. Run with its own `npm run dev` (tsx), default port `4021`.

### Components / endpoints

Free:
- `GET /health` — status + endpoint catalog.
- `GET /` — service metadata (payTo, network, facilitator).

Paid (behind x402 middleware):
- `GET /weather` — current conditions for a random city. Default `$0.001`.
- `GET /forecast` — 7-day forecast. Default `$0.005`.
- `POST /analyze` — example body-accepting endpoint. `$0.002`.

Weather data comes from the free **Open-Meteo** API (no key); on failure the handlers fall back to synthetic data so the demo never hard-fails.

### Payment data flow

1. Client requests a paid endpoint with no payment header.
2. Server responds `402` with a `PAYMENT-REQUIRED` header (base64 JSON): `accepts[]` = scheme `exact`, network (Algorand testnet CAIP-2), `payTo` = `SELLER_ADDRESS`, price.
3. Client signs an Algorand USDC transfer and retries with the `X-PAYMENT` header.
4. Server's `x402ResourceServer` calls the facilitator's `verify` then `settle` (wrapped with retry/backoff). Facilitator submits on-chain and returns the txid.
5. Server delivers `200` + data only after settlement is confirmed.

### Reliability features (kept from template, already working)

- Per-IP sliding-window rate limiter (default 30 rpm) on paid routes.
- Idempotency cache keyed by txid (5-min expiry) — retried requests return the cached body.
- Persistent JSONL payment log at `logs/payments.jsonl`.
- Fire-and-forget webhook POST after settlement (optional, off unless `WEBHOOK_URL` set).
- CORS allowing localhost dev origins + `*.vercel.app`, exposing the payment headers.

## Key dependencies

| Package | Purpose |
| --- | --- |
| `@x402/hono` | `paymentMiddleware`, `x402ResourceServer` |
| `@x402/core` | `HTTPFacilitatorClient` |
| `@x402/avm` | `ExactAvmScheme`, Algorand testnet/mainnet CAIP-2 constants |
| `hono`, `@hono/node-server` | HTTP server |
| `tsx`, `typescript`, `dotenv` | runtime/tooling |

**Risk — package naming.** The reference uses `@x402/*` (e.g. `@x402/hono@^2.12.0`); this repo's `skills/algorand-x402-typescript` documents `@x402-avm/*`. The reference is real working hackathon code, so we use `@x402/*` and copy the reference's exact versions. We verify install succeeds before declaring done; if a published version is broken, pin to the version proven by the reference's `package-lock.json`.

## Configuration

Required:
- `SELLER_ADDRESS` — Algorand **testnet** address that receives payments.

Optional (sensible defaults): `FACILITATOR_URL` (`https://facilitator.goplausible.xyz`), `PORT` (`4021`), `NETWORK` (`testnet`), `SELLER_WEATHER_PRICE` (`0.001`), `SELLER_FORECAST_PRICE` (`0.005`), `WEBHOOK_URL`, `LOG_DIR` (`./logs`), `RATE_LIMIT_RPM` (`30`), `RATE_LIMIT_WINDOW_MS` (`60000`).

## Error handling

- Missing `SELLER_ADDRESS` → process exits at startup with a clear message.
- Open-Meteo failure → synthetic fallback data (marked `(cached)`), request still succeeds.
- Facilitator transient failure → automatic retry with exponential backoff (3 attempts).
- Disk/permission error on logging → non-fatal, logging silently disabled.

## Verification

**A — Gating check (no funds; done immediately):**
- Server starts; `GET /health` → `200`.
- `GET /weather` with no payment → `402` carrying valid payment requirements (correct `payTo`, testnet network, price).
- Confirms the shop is correctly built and gated. Does not exercise on-chain settlement.

**B — Full payment loop (needs a funded testnet wallet; done when the user provides credentials):**
- Run the reference template's bundled buyer against this shop with an account funded with testnet ALGO (fees) + testnet USDC.
- Expect: `402` → signed payment → facilitator settles → `200` + weather, with a real testnet txid in `logs/payments.jsonl` and on the explorer.
- This is the slide's "live proof."

Prerequisites for B (user provides): a funded Algorand testnet account mnemonic and a receiving `SELLER_ADDRESS`. Testnet faucets: ALGO `bank.testnet.algorand.network`, USDC `faucet.circle.com` (select Algorand Testnet).

## Cleanup

- Add `resources/` to repo `.gitignore` so the reference clone is never committed.
- After the shop runs, delete `resources/x402-reference` (it carries its own git remote and should not nest inside this repo).

## Out-of-the-loop note

Git push policy (CLAUDE.md): nothing is pushed to any remote without explicit, in-the-moment instruction. Commits are local only unless asked.
