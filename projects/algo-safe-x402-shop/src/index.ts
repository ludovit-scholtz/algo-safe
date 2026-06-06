import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { appendFileSync, mkdirSync } from 'fs';
dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });
import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { paymentMiddleware, x402ResourceServer, type Network } from '@x402/hono';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { ExactAvmScheme } from '@x402/avm/exact/server';
import { ALGORAND_TESTNET_CAIP2, ALGORAND_MAINNET_CAIP2 } from '@x402/avm';

// =============================================================================
// SELLER — x402 Resource Server
//
// To build your own paid API, change three things:
//   1. PRICES      — set your price per request below (or via env vars)
//   2. ROUTES      — rename 'GET /weather' to your endpoint(s)
//   3. HANDLERS    — replace the weather/forecast logic with your own data
//
// Everything else (facilitator setup, middleware, CORS, rate-limiting, logging,
// webhook) is boilerplate you can keep or drop as needed.
// =============================================================================

// ── Environment ───────────────────────────────────────────────────────────────

const SELLER_ADDRESS  = process.env.SELLER_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL ?? 'https://facilitator.goplausible.xyz';
const PORT            = Number(process.env.PORT ?? 4021);
const WEBHOOK_URL     = process.env.WEBHOOK_URL ?? '';        // optional — called after each paid request
const LOG_DIR         = process.env.LOG_DIR ?? './logs';      // set to '' to disable file logging
const NETWORK         = process.env.NETWORK ?? 'testnet';     // 'testnet' | 'mainnet'
const NETWORK_CAIP2   = NETWORK === 'mainnet' ? ALGORAND_MAINNET_CAIP2 : ALGORAND_TESTNET_CAIP2;
const NETWORK_LABEL   = NETWORK === 'mainnet' ? 'Algorand Mainnet' : 'Algorand Testnet';

// CHANGE 1 — set your price per request
const WEATHER_PRICE  = `$${process.env.SELLER_WEATHER_PRICE  ?? '0.001'}`;
const FORECAST_PRICE = `$${process.env.SELLER_FORECAST_PRICE ?? '0.005'}`;

if (!SELLER_ADDRESS) {
  console.error('[seller] ERROR: SELLER_ADDRESS is required in .env');
  process.exit(1);
}

// ── Persistent JSON log ───────────────────────────────────────────────────────
// Appends one JSON line per paid request to logs/payments.jsonl.
// Set LOG_DIR='' in .env to disable. Safe to tail -f for real-time monitoring.

type LogEntry = {
  at: string;
  endpoint: string;
  method: string;
  status: number;
  txid?: string;
  latencyMs: number;
  ip?: string;
};

let logReady = false;
if (LOG_DIR) {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    logReady = true;
  } catch (e) {
    console.warn('[seller] Could not create log dir, file logging disabled:', e);
  }
}

function logPayment(entry: LogEntry) {
  if (!logReady) return;
  try {
    appendFileSync(`${LOG_DIR}/payments.jsonl`, JSON.stringify(entry) + '\n');
  } catch { /* disk full or permission error — non-fatal */ }
}

// ── Webhook ───────────────────────────────────────────────────────────────────
// After a paid request is successfully served, POSTs a JSON event to WEBHOOK_URL.
// Set WEBHOOK_URL in .env to enable. Fire-and-forget — never blocks the response.

type WebhookPayload = {
  event: 'payment.settled';
  at: string;
  endpoint: string;
  txid?: string;
  payTo: string;
  network: string;
};

function fireWebhook(payload: WebhookPayload) {
  if (!WEBHOOK_URL) return;
  fetch(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  }).catch(err => console.warn('[seller] Webhook delivery failed:', err));
}

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Simple in-memory sliding-window rate limiter (no external dependency).
// Default: 30 requests per minute per IP on paid endpoints.
// Adjust RATE_LIMIT_RPM and RATE_LIMIT_WINDOW_MS in .env to tune.

const RPM        = Number(process.env.RATE_LIMIT_RPM        ?? 30);
const WINDOW_MS  = Number(process.env.RATE_LIMIT_WINDOW_MS  ?? 60_000);

const rateBuckets = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (rateBuckets.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  hits.push(now);
  rateBuckets.set(ip, hits);
  return hits.length > RPM;
}

// Prune stale buckets every minute to prevent unbounded memory growth
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [ip, hits] of rateBuckets) {
    if (hits.every(t => t < cutoff)) rateBuckets.delete(ip);
  }
}, WINDOW_MS);

// ── Idempotency ───────────────────────────────────────────────────────────────
// The x402 facilitator already prevents double-settlement on-chain, but we also
// track recent txids in memory to return cached responses for retried requests.
// Entries expire after 5 minutes (the Algorand transaction validity window).

const recentTxids = new Map<string, { body: unknown; expiresAt: number }>();

function cacheResponse(txid: string, body: unknown) {
  recentTxids.set(txid, { body, expiresAt: Date.now() + 5 * 60_000 });
}
function getCachedResponse(txid: string | undefined): unknown | null {
  if (!txid) return null;
  const entry = recentTxids.get(txid);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.body;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of recentTxids) {
    if (now > v.expiresAt) recentTxids.delete(k);
  }
}, 60_000);

// ── Demo data — replace with your own data source ────────────────────────────

const CITIES = [
  { city: 'New York',      lat: 40.7128,  lon: -74.0060  },
  { city: 'San Francisco', lat: 37.7749,  lon: -122.4194 },
  { city: 'Miami',         lat: 25.7617,  lon: -80.1918  },
  { city: 'Chicago',       lat: 41.8781,  lon: -87.6298  },
  { city: 'Austin',        lat: 30.2672,  lon: -97.7431  },
];

const WMO: Record<number, string> = {
  0: 'Clear Sky', 1: 'Mainly Clear', 2: 'Partly Cloudy', 3: 'Overcast',
  45: 'Foggy', 48: 'Foggy',
  51: 'Drizzle', 53: 'Drizzle', 55: 'Heavy Drizzle',
  61: 'Light Rain', 63: 'Rain', 65: 'Heavy Rain',
  71: 'Light Snow', 73: 'Snow', 75: 'Heavy Snow',
  80: 'Showers', 81: 'Showers', 82: 'Heavy Showers',
  95: 'Thunderstorm', 96: 'Thunderstorm', 99: 'Thunderstorm',
};

function randomCity() {
  return CITIES[Math.floor(Math.random() * CITIES.length)];
}

async function fetchCurrentWeather(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&current=temperature_2m,weather_code,relative_humidity_2m&temperature_unit=fahrenheit`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json() as {
    current: { temperature_2m: number; weather_code: number; relative_humidity_2m: number };
  };
  return data.current;
}

async function fetchForecast(lat: number, lon: number) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
    + `&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit`
    + `&timezone=auto&forecast_days=7`;
  const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const data = await res.json() as {
    daily: {
      time: string[];
      temperature_2m_max: number[];
      temperature_2m_min: number[];
      weather_code: number[];
    };
  };
  return data.daily;
}

// ── Facilitator client with retry ─────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, attempts = 3, delayMs = 500): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (attempts <= 1) throw err;
    await new Promise(r => setTimeout(r, delayMs));
    return withRetry(fn, attempts - 1, delayMs * 2);
  }
}

const baseFacilitator = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const facilitatorClient = {
  url: baseFacilitator.url,
  getSupported: () => baseFacilitator.getSupported(),
  verify: (...args: Parameters<typeof baseFacilitator.verify>) =>
    withRetry(() => baseFacilitator.verify(...args)),
  settle: (...args: Parameters<typeof baseFacilitator.settle>) =>
    withRetry(() => baseFacilitator.settle(...args)),
};

// ── x402 setup ────────────────────────────────────────────────────────────────

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK_CAIP2, new ExactAvmScheme());

// CHANGE 2 — rename routes and set price for each endpoint
const routes = {
  'GET /weather': {
    accepts: {
      scheme:  'exact' as const,
      network: NETWORK_CAIP2 as Network,
      payTo:   SELLER_ADDRESS as string,
      price:   WEATHER_PRICE,
    },
    description: 'Current weather for a random city — pay-per-request via x402',
  },
  'GET /forecast': {
    accepts: {
      scheme:  'exact' as const,
      network: NETWORK_CAIP2 as Network,
      payTo:   SELLER_ADDRESS as string,
      price:   FORECAST_PRICE,
    },
    description: '7-day forecast for a random city — pay-per-request via x402',
  },
  // CHANGE 2b — POST endpoint example (body-accepting paid route)
  'POST /analyze': {
    accepts: {
      scheme:  'exact' as const,
      network: NETWORK_CAIP2 as Network,
      payTo:   SELLER_ADDRESS as string,
      price:   '$0.002',
    },
    description: 'Example POST endpoint — replace with your own processing logic',
  },
};

// ── Hono app ──────────────────────────────────────────────────────────────────

const app = new Hono();

app.use(cors({
  origin: (origin) => {
    const allowed = [
      'http://localhost:5173',
      'http://localhost:4173',
      process.env.UI_ORIGIN,
    ].filter(Boolean) as string[];
    if (!origin || allowed.includes(origin) || origin.endsWith('.vercel.app')) return origin ?? '*';
    return null as unknown as string;
  },
  exposeHeaders: ['PAYMENT-REQUIRED', 'payment-required', 'PAYMENT-RESPONSE', 'X-PAYMENT-RESPONSE'],
}));

// Rate limiting on paid endpoints
const rateLimitMiddleware = async (c: Context, next: () => Promise<void>) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown';
  if (isRateLimited(ip)) {
    return c.json({ error: 'Too many requests — try again in a minute.' }, 429);
  }
  return next();
};
app.use('/weather',  rateLimitMiddleware);
app.use('/forecast', rateLimitMiddleware);
app.use('/analyze',  rateLimitMiddleware);

// Request logger — marks paid requests with 💰
app.use(async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const paid = c.req.header('x-payment') ? '💰' : '  ';
  console.log(`[seller] ${paid} ${c.req.method} ${c.req.path} → ${c.res.status} (${ms}ms)`);
});

app.use(paymentMiddleware(routes, resourceServer));

// ── Free endpoints ────────────────────────────────────────────────────────────

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'x402-seller',
    timestamp: new Date().toISOString(),
    endpoints: {
      '/weather':  { price: WEATHER_PRICE,  description: 'Current conditions for a random city' },
      '/forecast': { price: FORECAST_PRICE, description: '7-day forecast for a random city' },
      '/analyze':  { price: '$0.002',        description: 'Example POST endpoint' },
    },
  }),
);

app.get('/', (c) =>
  c.json({
    service: 'x402 Demo Seller Agent',
    endpoints: [
      { path: '/weather',  method: 'GET',  price: `${WEATHER_PRICE} USDC`,  description: 'Current weather data' },
      { path: '/forecast', method: 'GET',  price: `${FORECAST_PRICE} USDC`, description: '7-day forecast' },
      { path: '/analyze',  method: 'POST', price: '$0.002 USDC',             description: 'Example POST endpoint' },
      { path: '/health',   method: 'GET',  price: 'free',                    description: 'Health check' },
    ],
    facilitator: FACILITATOR_URL,
    payTo: SELLER_ADDRESS,
    network: NETWORK_CAIP2,
  }),
);

// ── Helper: extract txid from payment-response header ─────────────────────────

function extractTxid(c: Context): string | undefined {
  try {
    const header = c.req.header('payment-response') ?? c.req.header('PAYMENT-RESPONSE');
    if (!header) return undefined;
    return (JSON.parse(Buffer.from(header, 'base64').toString('utf-8')) as { transaction?: string }).transaction;
  } catch {
    return undefined;
  }
}

// ── CHANGE 3 — paid handlers ──────────────────────────────────────────────────

app.get('/weather', async (c) => {
  const start = Date.now();
  const txid  = extractTxid(c);
  const cached = getCachedResponse(txid);
  if (cached) return c.json(cached);

  const { city, lat, lon } = randomCity();
  let body: unknown;
  try {
    const current = await fetchCurrentWeather(lat, lon);
    body = {
      city,
      temperature: Math.round(current.temperature_2m),
      condition:   WMO[current.weather_code] ?? 'Unknown',
      humidity:    current.relative_humidity_2m,
      timestamp:   new Date().toISOString(),
      paidVia:     `x402 / USDC ${NETWORK_LABEL}`,
    };
  } catch (err) {
    console.error('[seller] Open-Meteo error, using fallback:', err);
    body = {
      city,
      temperature: Math.round(60 + Math.random() * 40),
      condition:   'Partly Cloudy',
      humidity:    Math.round(50 + Math.random() * 30),
      timestamp:   new Date().toISOString(),
      paidVia:     `x402 / USDC ${NETWORK_LABEL} (cached)`,
    };
  }

  if (txid) cacheResponse(txid, body);
  logPayment({ at: new Date().toISOString(), endpoint: '/weather', method: 'GET', status: 200, txid, latencyMs: Date.now() - start, ip: c.req.header('x-forwarded-for') });
  fireWebhook({ event: 'payment.settled', at: new Date().toISOString(), endpoint: '/weather', txid, payTo: SELLER_ADDRESS as string, network: NETWORK_CAIP2 });
  return c.json(body);
});

app.get('/forecast', async (c) => {
  const start = Date.now();
  const txid  = extractTxid(c);
  const cached = getCachedResponse(txid);
  if (cached) return c.json(cached);

  const { city, lat, lon } = randomCity();
  let body: unknown;
  try {
    const daily = await fetchForecast(lat, lon);
    body = {
      city,
      days: daily.time.map((date, i) => ({
        date,
        tempMax:   Math.round(daily.temperature_2m_max[i]),
        tempMin:   Math.round(daily.temperature_2m_min[i]),
        condition: WMO[daily.weather_code[i]] ?? 'Unknown',
      })),
      timestamp: new Date().toISOString(),
      paidVia:   `x402 / USDC ${NETWORK_LABEL}`,
    };
  } catch (err) {
    console.error('[seller] Open-Meteo forecast error, using fallback:', err);
    const today = new Date();
    const conditions = ['Clear Sky', 'Partly Cloudy', 'Overcast', 'Light Rain', 'Showers'];
    body = {
      city,
      days: Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        return {
          date:      d.toISOString().slice(0, 10),
          tempMax:   Math.round(65 + Math.random() * 20),
          tempMin:   Math.round(45 + Math.random() * 15),
          condition: conditions[Math.floor(Math.random() * conditions.length)],
        };
      }),
      timestamp: new Date().toISOString(),
      paidVia:   `x402 / USDC ${NETWORK_LABEL} (cached)`,
    };
  }

  if (txid) cacheResponse(txid, body);
  logPayment({ at: new Date().toISOString(), endpoint: '/forecast', method: 'GET', status: 200, txid, latencyMs: Date.now() - start, ip: c.req.header('x-forwarded-for') });
  fireWebhook({ event: 'payment.settled', at: new Date().toISOString(), endpoint: '/forecast', txid, payTo: SELLER_ADDRESS as string, network: NETWORK_CAIP2 });
  return c.json(body);
});

// CHANGE 3b — POST endpoint example
// Replace this handler with your own processing logic.
// The request body is available at c.req.json() after payment is confirmed.
app.post('/analyze', async (c) => {
  const start = Date.now();
  const txid  = extractTxid(c);
  const cached = getCachedResponse(txid);
  if (cached) return c.json(cached);

  let input: unknown = {};
  try { input = await c.req.json(); } catch { /* no body or invalid JSON */ }

  const body = {
    received: input,
    result:   'Replace this handler with your own processing logic',
    timestamp: new Date().toISOString(),
    paidVia:  `x402 / USDC ${NETWORK_LABEL}`,
  };

  if (txid) cacheResponse(txid, body);
  logPayment({ at: new Date().toISOString(), endpoint: '/analyze', method: 'POST', status: 200, txid, latencyMs: Date.now() - start, ip: c.req.header('x-forwarded-for') });
  fireWebhook({ event: 'payment.settled', at: new Date().toISOString(), endpoint: '/analyze', txid, payTo: SELLER_ADDRESS as string, network: NETWORK_CAIP2 });
  return c.json(body);
});

// ── Start ─────────────────────────────────────────────────────────────────────

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`\n[seller] x402 Resource Server ready`);
  console.log(`[seller]   URL:         http://localhost:${PORT}`);
  console.log(`[seller]   Pay-to:      ${SELLER_ADDRESS}`);
  console.log(`[seller]   Network:     ${NETWORK_LABEL} (${NETWORK_CAIP2})`);
  console.log(`[seller]   Facilitator: ${FACILITATOR_URL}`);
  console.log(`[seller]   /weather     ${WEATHER_PRICE} USDC  (GET)`);
  console.log(`[seller]   /forecast    ${FORECAST_PRICE} USDC (GET)`);
  console.log(`[seller]   /analyze     $0.002 USDC (POST)`);
  console.log(`[seller]   Rate limit:  ${RPM} req/min per IP`);
  if (WEBHOOK_URL) console.log(`[seller]   Webhook:     ${WEBHOOK_URL}`);
  if (logReady)    console.log(`[seller]   Log:         ${LOG_DIR}/payments.jsonl\n`);
});
