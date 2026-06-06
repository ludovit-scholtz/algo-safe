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

Verified (gating check A): /health 200, /weather 402 with payment requirements on 2026-06-06.

## Verify (full on-chain loop — needs testnet funds)

Use the reference template's bundled buyer with an account funded with testnet
ALGO (fees) + testnet USDC (ASA `10458941`). Faucets: ALGO
`bank.testnet.algorand.network`, USDC `faucet.circle.com` (select Algorand
Testnet). Expect `402 -> sign -> settle -> 200 + weather`, with the txid in
`logs/payments.jsonl`.
