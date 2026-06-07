import { useQuery } from '@tanstack/react-query'
import { useWallet } from '@txnlab/use-wallet-react'
import { fetchSafeHoldings } from '../lib/onChainSafe'
import { useSafe } from './index'

export function useOnChainSafeHoldings(safeId?: string) {
  const { algodClient } = useWallet()
  const { data: safe } = useSafe(safeId)

  return useQuery({
    queryKey: ['safe-holdings', safeId, safe?.address, safe?.appId, safe?.network],
    enabled: !!safe?.address,
    staleTime: 30_000,
    queryFn: () => fetchSafeHoldings(algodClient, safe!.address, safe?.network),
  })
}
