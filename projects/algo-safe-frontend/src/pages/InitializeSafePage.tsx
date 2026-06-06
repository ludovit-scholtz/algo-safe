import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useNetwork, useWallet } from '@txnlab/use-wallet-react'
import { AlgoSafeFactory } from 'algo-safe'
import algosdk from 'algosdk'
import { useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { Stepper } from '../components/ui/Stepper'
import { normalizeNetworkId, upsertSafeRegistryEntry } from '../lib/safeRegistry'

const STEPS = ['Contract Deployment', 'MBR Funding']
const TX_VALIDITY_WINDOW = 200

type FlowStage = 'idle' | 'deploying' | 'funding' | 'success' | 'error'

type DeploymentDetails = {
  appId: string
  address: string
  txId: string
}

function formatNetworkLabel(network: string) {
  switch (network.toLowerCase()) {
    case 'localnet':
      return 'AlgoKit LocalNet'
    case 'testnet':
      return 'Algorand TestNet'
    default:
      return 'Algorand MainNet'
  }
}

function formatAddress(address?: string | null) {
  if (!address) return 'Wallet not connected'
  if (address.length <= 12) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function getCurrentStep(stage: FlowStage) {
  return stage === 'idle' || stage === 'deploying' || stage === 'error' ? 0 : 1
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return 'The transaction was rejected or could not be submitted.'
}

function getCanonicalAppAddress(appId: bigint) {
  return algosdk.getApplicationAddress(appId).toString()
}

function getCanonicalSenderAddress(address: string): algosdk.Address {
  return algosdk.Address.fromString(String(address))
}

export function InitializeSafePage() {
  const { activeNetwork } = useNetwork()
  const { activeAddress, algodClient, isReady, transactionSigner } = useWallet()
  const [name, setName] = useState('New Treasury')
  const [depositAlgo, setDepositAlgo] = useState(2)
  const [stage, setStage] = useState<FlowStage>('idle')
  const [deployment, setDeployment] = useState<DeploymentDetails | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusy = stage === 'deploying' || stage === 'funding'
  const currentStep = getCurrentStep(stage)
  const networkLabel = formatNetworkLabel(activeNetwork ?? import.meta.env.VITE_ALGOD_NETWORK ?? 'mainnet')
  const buttonLabel = useMemo(() => {
    switch (stage) {
      case 'deploying':
        return 'Deploying contract...'
      case 'funding':
        return 'Funding and bootstrapping...'
      case 'success':
        return 'Safe Ready'
      default:
        return 'Start'
    }
  }, [stage])

  async function handleStart() {
    const safeName = name.trim()
    let failedStage: FlowStage = 'deploying'

    if (!safeName) {
      setErrorMessage('Enter a safe name before starting the deployment.')
      return
    }

    if (!isReady || !activeAddress || !transactionSigner) {
      setErrorMessage('A connected wallet is required to deploy and fund the safe.')
      return
    }

    if (!Number.isFinite(depositAlgo) || depositAlgo <= 0) {
      setErrorMessage('Enter a positive ALGO amount for the app account MBR funding.')
      return
    }

    try {
      setErrorMessage(null)
      setDeployment(null)
      setStage('deploying')

      const senderAddress = getCanonicalSenderAddress(activeAddress)
      const algorand = AlgorandClient.fromClients({ algod: algodClient }).setDefaultValidityWindow(TX_VALIDITY_WINDOW)
      algorand.setSigner(senderAddress, transactionSigner)

      const factory = algorand.client.getTypedAppFactory(AlgoSafeFactory, {
        defaultSender: senderAddress,
      })

      const { appClient, result } = await factory.send.create.createApplication({
        args: { name: safeName },
        suppressLog: true,
      })

      const appAddress = getCanonicalAppAddress(result.appId)

      const nextDeployment = {
        appId: result.appId.toString(),
        address: appAddress,
        txId: result.txIds[0] ?? '',
      }

      setDeployment(nextDeployment)
      setStage('funding')
      failedStage = 'funding'

      const bootstrapCall = await appClient.params.bootstrap({
        args: { groupName: 'Admins' },
      })

      await algorand
        .newGroup()
        .addPayment({
          amount: algo(depositAlgo),
          sender: senderAddress,
          receiver: nextDeployment.address,
        })
        .addAppCallMethodCall(bootstrapCall)
        .send({ suppressLog: true })

      upsertSafeRegistryEntry({
        appId: Number(result.appId),
        address: appAddress,
        name: safeName,
        network: normalizeNetworkId(activeNetwork ?? import.meta.env.VITE_ALGOD_NETWORK),
      })

      setStage('success')
    } catch (error) {
      console.error('Initialize safe failed', {
        error,
        failedStage,
        activeAddress,
        activeAddressType: typeof activeAddress,
        activeAddressConstructor: activeAddress?.constructor?.name,
        activeNetwork,
        deployment,
        safeName,
      })
      setStage('error')
      setErrorMessage(getErrorMessage(error))
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-on-surface-variant">
        <Icon name="shield" className="text-sm" />
        <span>Security Setup</span>
        <Icon name="chevron_right" className="text-sm" />
        <span className="text-primary">Initialization</span>
      </div>

      {/* Page title */}
      <div className="text-center">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-on-surface">Initialize Smart Account</h1>
        <p className="mx-auto max-w-lg text-base text-on-surface-variant">
          Deploy the Algo Safe contract from your connected wallet, then fund the new app account with native ALGO for minimum balance
          requirements.
        </p>
      </div>

      {/* Stepper */}
      <Stepper steps={STEPS} current={currentStep} />

      <Card className="space-y-6">
        <div className="relative grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            className={`flex flex-col items-center rounded-md border p-4 text-center transition-colors ${currentStep === 0 ? 'border-primary/60 bg-primary/5' : 'border-outline-variant bg-surface-container-high'}`}
          >
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-bright">
              <Icon name="deployed_code" className={`text-2xl ${currentStep === 0 ? 'text-primary' : 'text-on-surface-variant'}`} />
            </div>
            <span className="mb-1 font-mono text-xs text-primary">Step 01</span>
            <h3 className="mb-1 text-base font-semibold text-on-surface">Deploy smart contract</h3>
            <p className="text-sm text-on-surface-variant">Create the Algo Safe application on-chain from the already connected wallet.</p>
          </div>
          <div
            className={`flex flex-col items-center rounded-md border p-4 text-center transition-colors ${currentStep === 1 ? 'border-primary/60 bg-primary/5' : 'border-outline-variant bg-surface-container-high'}`}
          >
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-bright">
              <Icon
                name="account_balance_wallet"
                className={`text-2xl ${currentStep === 1 ? 'text-primary' : 'text-on-surface-variant'}`}
              />
            </div>
            <span className="mb-1 font-mono text-xs text-primary">Step 02</span>
            <h3 className="mb-1 text-base font-semibold text-on-surface">Fund ALGO MBR</h3>
            <p className="text-sm text-on-surface-variant">Send native ALGO to the new app account for box MBR and bootstrap setup.</p>
          </div>
          <div className="absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/40 bg-primary/20 p-1.5 backdrop-blur-sm md:flex">
            <Icon name="link" className="text-xl text-primary" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs text-on-surface-variant">Connected wallet</span>
              <span className="font-mono text-xs text-primary">Ready</span>
            </div>
            <div className="truncate font-mono text-sm text-on-surface">{formatAddress(activeAddress)}</div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">Network</span>
              <span className="font-semibold text-on-surface">{networkLabel}</span>
            </div>
          </div>
          <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs text-on-surface-variant">Deploy flow</span>
              <span className="font-mono text-xs text-primary">Live</span>
            </div>
            <div className="text-sm text-on-surface-variant">
              The wallet will first sign the app deployment, then approve one grouped request that funds the app account and bootstraps it.
            </div>
          </div>
        </div>

        <FormField label="Safe Name" hint="This name is stored on-chain during application creation.">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Governance Treasury" />
        </FormField>

        <FormField label="MBR Deposit (ALGO)" hint="Recommended 2 ALGO so the app can cover box minimum balance and bootstrap operations.">
          <input
            type="number"
            min={0.1}
            step={0.1}
            className={inputCls}
            value={depositAlgo}
            onChange={(e) => setDepositAlgo(Number(e.target.value) || 0)}
          />
        </FormField>

        <div className="rounded-md border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <Icon
              name={isBusy ? 'sync' : stage === 'success' ? 'check_circle' : 'info'}
              className={`mt-0.5 text-lg ${isBusy ? 'animate-spin text-primary' : stage === 'success' ? 'text-primary' : 'text-on-surface-variant'}`}
            />
            <div className="space-y-1 text-sm">
              {stage === 'idle' && (
                <>
                  <p className="font-semibold text-on-surface">
                    Start will deploy first, then request one grouped ALGO funding plus bootstrap transaction.
                  </p>
                  <p className="text-on-surface-variant">
                    The genesis admin group is created during bootstrap after the app account is funded.
                  </p>
                </>
              )}
              {stage === 'deploying' && (
                <>
                  <p className="font-semibold text-on-surface">Deployment in progress.</p>
                  <p className="text-on-surface-variant">
                    Approve the smart contract deployment in your wallet. The button stays locked until the chain confirms creation.
                  </p>
                </>
              )}
              {stage === 'funding' && (
                <>
                  <p className="font-semibold text-on-surface">Contract deployed. Step 02 is now in progress.</p>
                  <p className="text-on-surface-variant">
                    Check your wallet for the grouped signature request that funds the new app account with ALGO and bootstraps the safe.
                  </p>
                </>
              )}
              {stage === 'success' && (
                <>
                  <p className="font-semibold text-on-surface">Safe initialization completed.</p>
                  <p className="text-on-surface-variant">
                    The contract is deployed, funded with ALGO, bootstrapped for governance, and stored in your local safe registry.
                  </p>
                </>
              )}
              {stage === 'error' && (
                <>
                  <p className="font-semibold text-on-surface">Initialization stopped.</p>
                  <p className="text-on-surface-variant">Review the error below, then restart the flow when the wallet is ready.</p>
                </>
              )}
            </div>
          </div>
        </div>

        {deployment && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-1 font-mono text-xs text-on-surface-variant">App ID</div>
              <div className="font-semibold text-on-surface">{deployment.appId}</div>
              {deployment.txId && <div className="mt-3 text-xs text-on-surface-variant">Create tx: {deployment.txId}</div>}
            </div>
            <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-1 font-mono text-xs text-on-surface-variant">App address</div>
              <div className="break-all font-mono text-sm text-on-surface">{deployment.address}</div>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="rounded-sm border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-error-container">
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1 font-mono text-xs text-on-surface-variant">
            <Icon name="history_edu" className="text-sm" />
            <span>Network fees are paid in ALGO and depend on wallet-confirmed transactions.</span>
          </div>
          <Button className="min-w-40" onClick={handleStart} disabled={isBusy || !activeAddress || !transactionSigner}>
            {isBusy ? <Icon name="sync" className="animate-spin text-lg" /> : <Icon name="play_arrow" className="text-lg" />}
            {buttonLabel}
          </Button>
        </div>
      </Card>

      {/* Footer help links */}
      <div className="flex gap-5 pt-1">
        <a href="#" className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary">
          <Icon name="description" className="text-base" />
          Documentation
        </a>
        <a href="#" className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary">
          <Icon name="support_agent" className="text-base" />
          Institutional Support
        </a>
      </div>
    </div>
  )
}
