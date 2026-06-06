// src/lib/env.ts
export const env = {
  quantozApiKey: import.meta.env.VITE_QUANTOZ_API_KEY as string | undefined,
  quantozMcpUrl: (import.meta.env.VITE_QUANTOZ_MCP_URL as string) ?? 'https://mcp.ai.quantozpay.com',
  quantozAccountCode: import.meta.env.VITE_QUANTOZ_ACCOUNT as string | undefined,
}
export const quantozEnabled = () => Boolean(env.quantozApiKey)
