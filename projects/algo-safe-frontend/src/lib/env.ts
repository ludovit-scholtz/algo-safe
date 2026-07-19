// src/lib/env.ts
// Fallback used before this var existed; also served as the sole hardcoded
// value in App.tsx. Kept as the default so unset deployments keep working.
const DEFAULT_WALLETCONNECT_PROJECT_ID = 'f9c05e3d8e653a4781700744c3537424'

export const env = {
  quantozApiKey: import.meta.env.VITE_QUANTOZ_API_KEY as string | undefined,
  quantozMcpUrl: (import.meta.env.VITE_QUANTOZ_MCP_URL as string) ?? 'https://mcp.ai.quantozpay.com',
  quantozAccountCode: import.meta.env.VITE_QUANTOZ_ACCOUNT as string | undefined,
  walletConnectProjectId: (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as string) || DEFAULT_WALLETCONNECT_PROJECT_ID,
  // Same-origin path served by the in-cluster arc56-registry deployment (see
  // deploy/k8s/arc56-registry-*.yaml). Used to verify app-call ABI methods
  // against their published ARC-56 spec before asking the user to sign.
  arc56RegistryUrl: (import.meta.env.VITE_ARC56_REGISTRY_URL as string) || '/arc56-registry',
}
export const quantozEnabled = () => Boolean(env.quantozApiKey)
