// src/lib/env.ts
// Fallback used before this var existed; also served as the sole hardcoded
// value in App.tsx. Kept as the default so unset deployments keep working.
const DEFAULT_WALLETCONNECT_PROJECT_ID = 'f9c05e3d8e653a4781700744c3537424'

export const env = {
  quantozApiKey: import.meta.env.VITE_QUANTOZ_API_KEY as string | undefined,
  quantozMcpUrl: (import.meta.env.VITE_QUANTOZ_MCP_URL as string) ?? 'https://mcp.ai.quantozpay.com',
  quantozAccountCode: import.meta.env.VITE_QUANTOZ_ACCOUNT as string | undefined,
  walletConnectProjectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string) || DEFAULT_WALLETCONNECT_PROJECT_ID,
}
export const quantozEnabled = () => Boolean(env.quantozApiKey)
