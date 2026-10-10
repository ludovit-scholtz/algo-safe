import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useNetwork, useWallet } from '@txnlab/use-wallet-react'
import { AlgoSafeFactory, deployValidator, resolveValidatorAppId } from 'algo-safe'
import algosdk from 'algosdk'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { AddressDisplay } from '../components/AddressDisplay'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { Stepper } from '../components/ui/Stepper'
import i18n from '../i18n/instance'
import { normalizeNetworkId, upsertSafeRegistryEntry } from '../lib/safeRegistry'

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

function getCurrentStep(stage: FlowStage) {
  return stage === 'idle' || stage === 'deploying' || stage === 'error' ? 0 : 1
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return i18n.t('safes:init.errors.rejected')
}

function getCanonicalAppAddress(appId: bigint) {
  return algosdk.getApplicationAddress(appId).toString()
}

function getCanonicalSenderAddress(address: string): algosdk.Address {
  return algosdk.Address.fromString(String(address))
}

export function InitializeSafePage() {
  const { t } = useTranslation('safes')
  const navigate = useNavigate()
  const { activeNetwork } = useNetwork()
  const { activeAddress, algodClient, isReady, transactionSigner } = useWallet()
  const [name, setName] = useState('New Treasury')
  const [depositAlgo, setDepositAlgo] = useState(2)
  const [stage, setStage] = useState<FlowStage>('idle')
  const [deployment, setDeployment] = useState<DeploymentDetails | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const isBusy = stage === 'deploying' || stage === 'funding'
  const currentStep = getCurrentStep(stage)
  const networkLabel = formatNetworkLabel(activeNetwork ?? 'mainnet')
  const steps = useMemo(() => [t('init.steps.deploy'), t('init.steps.fund')], [t])
  const buttonLabel = useMemo(() => {
    switch (stage) {
      case 'deploying':
        return t('init.button.deploying')
      case 'funding':
        return t('init.button.funding')
      case 'success':
        return t('init.button.ready')
      default:
        return t('init.button.start')
    }
  }, [stage, t])

  async function handleStart() {
    const safeName = name.trim()

    if (!safeName) {
      setErrorMessage(t('init.errors.nameRequired'))
      return
    }

    if (!isReady || !activeAddress || !transactionSigner) {
      setErrorMessage(t('init.errors.walletRequired'))
      return
    }

    if (!Number.isFinite(depositAlgo) || depositAlgo <= 0) {
      setErrorMessage(t('init.errors.amountInvalid'))
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

      // The safe pins the AlgoSafeTxnValidator library by bytecode hash at
      // creation. Use the network's registered validator when one exists;
      // otherwise deploy a fresh one (the on-chain hash check makes any
      // matching deployment equivalent).
      let validatorAppId: bigint
      try {
        validatorAppId = await resolveValidatorAppId(algodClient)
      } catch {
        validatorAppId = await deployValidator({
          algodClient,
          sender: senderAddress.toString(),
          signer: transactionSigner,
        })
      }

      const { appClient, result } = await factory.send.create.createApplication({
        args: { name: safeName, validatorAppId },
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

      const registryEntry = upsertSafeRegistryEntry({
        appId: Number(result.appId),
        address: appAddress,
        creatorAddress: activeAddress,
        name: safeName,
        network: normalizeNetworkId(activeNetwork),
      })

      setStage('success')
      navigate(`/safe/${registryEntry.safeId}`, {
        replace: true,
        state: {
          initializationSuccess: {
            appId: result.appId.toString(),
            name: safeName,
          },
        },
      })
    } catch (error) {
      setStage('error')
      setErrorMessage(getErrorMessage(error))
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 font-mono text-xs uppercase tracking-widest text-on-surface-variant">
        <Icon name="shield" className="text-sm" />
        <span>{t('init.breadcrumbSecurity')}</span>
        <Icon name="chevron_right" className="text-sm" />
        <span className="text-primary">{t('init.breadcrumbInit')}</span>
      </div>

      {/* Page title */}
      <div className="text-center">
        <h1 className="mb-2 text-3xl font-bold tracking-tight text-on-surface">{t('init.title')}</h1>
        <p className="mx-auto max-w-lg text-base text-on-surface-variant">{t('init.intro')}</p>
      </div>

      {/* Stepper */}
      <Stepper steps={steps} current={currentStep} />

      <Card className="space-y-6">
        <div className="relative grid grid-cols-1 gap-4 md:grid-cols-2">
          <div
            className={`flex flex-col items-center rounded-md border p-4 text-center transition-colors ${currentStep === 0 ? 'border-primary/60 bg-primary/5' : 'border-outline-variant bg-surface-container-high'}`}
          >
            <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-surface-bright">
              <Icon name="deployed_code" className={`text-2xl ${currentStep === 0 ? 'text-primary' : 'text-on-surface-variant'}`} />
            </div>
            <span className="mb-1 font-mono text-xs text-primary">{t('init.step01')}</span>
            <h3 className="mb-1 text-base font-semibold text-on-surface">{t('init.deployTitle')}</h3>
            <p className="text-sm text-on-surface-variant">{t('init.deployText')}</p>
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
            <span className="mb-1 font-mono text-xs text-primary">{t('init.step02')}</span>
            <h3 className="mb-1 text-base font-semibold text-on-surface">{t('init.fundTitle')}</h3>
            <p className="text-sm text-on-surface-variant">{t('init.fundText')}</p>
          </div>
          <div className="absolute left-1/2 top-1/2 z-10 hidden -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/40 bg-primary/20 p-1.5 backdrop-blur-sm md:flex">
            <Icon name="link" className="text-xl text-primary" />
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs text-on-surface-variant">{t('init.connectedWallet')}</span>
              <span className="font-mono text-xs text-primary">{t('init.ready')}</span>
            </div>
            <AddressDisplay
              address={activeAddress}
              fallback={t('init.walletNotConnected')}
              textClassName="text-sm text-on-surface"
              buttonClassName="h-5 w-5"
            />
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-on-surface-variant">{t('init.network')}</span>
              <span className="font-semibold text-on-surface">{networkLabel}</span>
            </div>
          </div>
          <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
            <div className="mb-1 flex items-center justify-between">
              <span className="font-mono text-xs text-on-surface-variant">{t('init.deployFlow')}</span>
              <span className="font-mono text-xs text-primary">{t('init.live')}</span>
            </div>
            <div className="text-sm text-on-surface-variant">{t('init.flowText')}</div>
          </div>
        </div>

        <FormField label={t('init.nameLabel')} hint={t('init.nameHint')}>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('init.namePlaceholder')} />
        </FormField>

        <FormField label={t('init.mbrLabel')} hint={t('init.mbrHint')}>
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
                  <p className="font-semibold text-on-surface">{t('init.status.idle.title')}</p>
                  <p className="text-on-surface-variant">{t('init.status.idle.text')}</p>
                </>
              )}
              {stage === 'deploying' && (
                <>
                  <p className="font-semibold text-on-surface">{t('init.status.deploying.title')}</p>
                  <p className="text-on-surface-variant">{t('init.status.deploying.text')}</p>
                </>
              )}
              {stage === 'funding' && (
                <>
                  <p className="font-semibold text-on-surface">{t('init.status.funding.title')}</p>
                  <p className="text-on-surface-variant">{t('init.status.funding.text')}</p>
                </>
              )}
              {stage === 'success' && (
                <>
                  <p className="font-semibold text-on-surface">{t('init.status.success.title')}</p>
                  <p className="text-on-surface-variant">{t('init.status.success.text')}</p>
                </>
              )}
              {stage === 'error' && (
                <>
                  <p className="font-semibold text-on-surface">{t('init.status.error.title')}</p>
                  <p className="text-on-surface-variant">{t('init.status.error.text')}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {deployment && (
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-1 font-mono text-xs text-on-surface-variant">{t('init.appId')}</div>
              <div className="font-semibold text-on-surface">{deployment.appId}</div>
              {deployment.txId && (
                <div className="mt-3 text-xs text-on-surface-variant">{t('init.createTx', { txId: deployment.txId })}</div>
              )}
            </div>
            <div className="rounded-md border border-outline-variant bg-surface-container-low p-4">
              <div className="mb-1 font-mono text-xs text-on-surface-variant">{t('init.appAddress')}</div>
              <AddressDisplay address={deployment.address} textClassName="text-sm text-on-surface" />
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
            <span>{t('init.fees')}</span>
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
          {t('init.documentation')}
        </a>
        <a href="#" className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary">
          <Icon name="support_agent" className="text-base" />
          {t('init.support')}
        </a>
      </div>
    </div>
  )
}
