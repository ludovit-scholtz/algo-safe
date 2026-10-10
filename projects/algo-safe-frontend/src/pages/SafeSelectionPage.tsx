import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { useQueryClient } from '@tanstack/react-query'
import { useNetwork, useWallet, type Wallet } from '@txnlab/use-wallet-react'
import { getAlgoSafeContractVersion, getClient, hasModernAbi, readSafeConfig } from 'algo-safe'
import algosdk from 'algosdk'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { SafeCard } from '../components/SafeCard'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafes } from '../hooks'
import { chainOptions, getWalletSectionTitle } from '../lib/networks'
import { WALLET_ID, getWalletKeysForChain } from '../lib/walletIds'
import { normalizeNetworkId, upsertSafeRegistryEntry } from '../lib/safeRegistry'

export function SafeSelectionPage() {
  const { t } = useTranslation('safes')
  const { activeAddress, isReady } = useWallet()

  if (!isReady) {
    return (
      <Card className="flex min-h-[320px] items-center justify-center gap-3 text-on-surface-variant">
        <Icon name="sync" className="animate-spin text-xl" />
        <span>{t('selection.checkingWallet')}</span>
      </Card>
    )
  }

  if (!activeAddress) {
    return <UnauthenticatedSafeSelection />
  }

  return <AuthenticatedSafeSelection />
}

function AuthenticatedSafeSelection() {
  const { t } = useTranslation('safes')
  const nav = useNavigate()
  const queryClient = useQueryClient()
  const { activeAddress, algodClient } = useWallet()
  const { activeNetwork } = useNetwork()
  const { data: safes, isLoading } = useSafes()
  const [recoverAppId, setRecoverAppId] = useState('')
  const [recoverError, setRecoverError] = useState<string | null>(null)
  const [recoverSuccess, setRecoverSuccess] = useState<string | null>(null)
  const [isRecovering, setIsRecovering] = useState(false)

  async function handleRecoverSafe(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setRecoverError(null)
    setRecoverSuccess(null)

    if (!activeAddress) {
      setRecoverError(t('recover.noWallet'))
      return
    }

    const parsedAppId = Number(recoverAppId.trim())
    if (!Number.isSafeInteger(parsedAppId) || parsedAppId <= 0) {
      setRecoverError(t('recover.invalidAppId'))
      return
    }

    try {
      setIsRecovering(true)

      const senderAddress = algosdk.Address.fromString(activeAddress)
      const algorand = AlgorandClient.fromClients({ algod: algodClient })
      const clientVersion = await getAlgoSafeContractVersion(algodClient, BigInt(parsedAppId))
      const isLatest = hasModernAbi(clientVersion)
      const appClient = algorand.client.getTypedAppClientById(getClient(clientVersion ?? 'latest'), {
        appId: BigInt(parsedAppId),
        defaultSender: senderAddress,
      })

      // v3.0.0 removed the getConfig ABI getter — read global state directly on
      // the latest contract; older deployed versions still expose the getter.
      const configReturn = isLatest
        ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await readSafeConfig(appClient as any)
        : // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (await (appClient.send as any).getConfig({ args: {}, suppressLog: true })).return
      const safeName = extractRecoveredSafeName(configReturn)
      if (!safeName) {
        throw new Error(t('recover.invalidName'))
      }

      upsertSafeRegistryEntry({
        appId: parsedAppId,
        address: algosdk.getApplicationAddress(parsedAppId).toString(),
        creatorAddress: activeAddress,
        name: safeName,
        network: normalizeNetworkId(activeNetwork),
      })

      setRecoverAppId('')
      setRecoverSuccess(t('recover.success', { name: safeName }))
      await queryClient.invalidateQueries({ queryKey: ['safes'] })
    } catch (error) {
      const message = error instanceof Error && error.message.trim() ? error.message : t('recover.loadFailed')
      setRecoverError(message)
    } finally {
      setIsRecovering(false)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      {/* ── Hero / Action Column ── */}
      <div className="flex flex-col justify-center lg:col-span-7">
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-on-surface">
          {t('home.titleLine1')}
          <br />
          <span className="text-primary">{t('home.titleLine2')}</span>
        </h1>
        <p className="mb-8 max-w-xl text-base text-on-surface-variant">{t('home.intro')}</p>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary">
          <Icon name="verified_user" className="text-base" />
          <span>{t('home.walletReady')}</span>
        </div>

        <div className="flex max-w-lg flex-col gap-4">
          {/* Create New Safe card */}
          <button
            onClick={() => nav('/initialize')}
            className="group flex cursor-pointer items-start gap-4 rounded-md border border-outline-variant bg-surface-container p-5 text-left transition-all hover:-translate-y-0.5 hover:border-primary"
          >
            <div className="rounded-lg bg-primary-container/20 p-2">
              <Icon name="add_moderator" className="text-3xl text-primary" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1 text-lg font-bold text-on-surface">{t('home.createTitle')}</h3>
              <p className="text-sm text-on-surface-variant">{t('home.createText')}</p>
            </div>
            <Icon name="chevron_right" className="self-center text-xl text-on-surface-variant transition-colors group-hover:text-primary" />
          </button>

          {/* Import Existing Account card */}
          <div className="flex items-start gap-4 rounded-md border border-dashed border-outline-variant bg-surface-container p-5 transition-all hover:-translate-y-0.5">
            <div className="rounded-lg bg-surface-container-high p-2">
              <Icon name="account_balance" className="text-3xl text-on-surface-variant" />
            </div>
            <div className="flex-1">
              <h3 className="mb-1 text-lg font-bold text-on-surface">{t('home.importTitle')}</h3>
              <p className="mb-3 text-sm text-on-surface-variant">{t('home.importText')}</p>
              <form className="space-y-3" onSubmit={(event) => void handleRecoverSafe(event)}>
                <FormField label={t('home.appIdLabel')} hint={t('home.appIdHint')}>
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={t('home.appIdPlaceholder')}
                    value={recoverAppId}
                    onChange={(event) => setRecoverAppId(event.target.value)}
                    disabled={isRecovering}
                  />
                </FormField>
                <div className="flex items-center gap-3">
                  <Button type="submit" variant="ghost" disabled={isRecovering || !recoverAppId.trim()}>
                    {isRecovering ? <Icon name="sync" className="animate-spin text-lg" /> : <Icon name="download" className="text-lg" />}
                    {isRecovering ? t('home.reading') : t('home.recoverButton')}
                  </Button>
                  <span className="text-xs text-on-surface-variant">{t('home.network', { network: activeNetwork ?? 'mainnet' })}</span>
                </div>
              </form>
              {recoverSuccess && (
                <div className="mt-3 rounded-sm border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-on-surface">
                  {recoverSuccess}
                </div>
              )}
              {recoverError && (
                <div className="mt-3 rounded-sm border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-error-container">
                  {recoverError}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Safe List Column ── */}
      <div className="flex flex-col gap-5 lg:col-span-5">
        {/* Section header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-on-surface">{t('home.existingSafes')}</h2>
          {safes && <span className="font-mono text-xs font-medium text-primary">{t('home.accounts', { count: safes.length })}</span>}
        </div>

        {/* Safe cards */}
        <div className="space-y-3">
          {isLoading ? (
            <>
              <div className="h-24 animate-pulse rounded-md bg-surface-container" />
              <div className="h-24 animate-pulse rounded-md bg-surface-container" />
            </>
          ) : (
            safes?.map((s) => <SafeCard key={s.safeId} safe={s} />)
          )}
          {!isLoading && (!safes || safes.length === 0) && (
            <Card className="py-8 text-center text-sm text-on-surface-variant">{t('home.empty')}</Card>
          )}
        </div>

        <div className="relative overflow-hidden rounded-md border border-outline-variant bg-surface-container-high p-5">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />
          <h4 className="mb-3 font-mono text-xs font-medium uppercase tracking-widest text-primary">{t('home.registryTitle')}</h4>
          <div className="space-y-2 text-sm text-on-surface-variant">
            <p>{t('home.registryLine1')}</p>
            <p>{t('home.registryLine2')}</p>
          </div>
        </div>

        {/* Footer links */}
        <div className="flex gap-5 pt-1">
          <a href="#" className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary">
            <Icon name="description" className="text-base" />
            {t('home.documentation')}
          </a>
          <a href="#" className="flex items-center gap-1 font-mono text-xs text-on-surface-variant transition-colors hover:text-primary">
            <Icon name="security" className="text-base" />
            {t('home.audit')}
          </a>
        </div>
      </div>
    </div>
  )
}

function extractRecoveredSafeName(value: unknown) {
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const name = (value as { name?: unknown }).name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }

  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) {
    return value[0].trim()
  }

  return ''
}

function UnauthenticatedSafeSelection() {
  const { t } = useTranslation('safes')
  const { wallets } = useWallet()
  const { activeNetwork, setActiveNetwork } = useNetwork()
  const [connectingWalletKey, setConnectingWalletKey] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)
  const hasKmdWallet = wallets.some((wallet) => wallet.id === WALLET_ID.KMD)
  const availableChainOptions = chainOptions.filter((option) => option.id !== 'localnet' || hasKmdWallet || activeNetwork === 'localnet')
  const selectedChain = availableChainOptions.some((option) => option.id === activeNetwork)
    ? activeNetwork
    : (availableChainOptions[0]?.id ?? 'testnet')
  const featuredWallets = wallets
    .filter((wallet) => getWalletKeysForChain(selectedChain).has(wallet.walletKey))
    .sort((left, right) => left.metadata.name.localeCompare(right.metadata.name))

  async function handleChainChange(chainId: string) {
    setConnectError(null)
    await setActiveNetwork(chainId)
  }

  async function connectWallet(wallet: Wallet) {
    setConnectingWalletKey(wallet.walletKey)
    setConnectError(null)

    try {
      await wallet.connect()
      wallet.setActive()
    } catch (error) {
      const message = error instanceof Error ? error.message : t('login.connectDefault')
      setConnectError(t('login.connectFailed', { name: wallet.metadata.name, message }))
    } finally {
      setConnectingWalletKey(null)
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-12">
      <div className="flex flex-col justify-center lg:col-span-7">
        <div className="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-warn/25 bg-warn/10 px-4 py-2 text-sm text-warn">
          <Icon name="lock_person" className="text-base" />
          <span>{t('login.authRequired')}</span>
        </div>

        <h1 className="mb-4 text-4xl font-extrabold tracking-tight text-on-surface">
          {t('login.titleLine1')}
          <br />
          <span className="text-primary">{t('login.titleLine2')}</span>
        </h1>
        <p className="mb-8 max-w-xl text-base text-on-surface-variant">{t('login.intro')}</p>

        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div className="rounded-md border border-outline-variant bg-surface-container p-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Icon name="shield_lock" className="text-2xl" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-on-surface">{t('login.secureTitle')}</h3>
            <p className="text-sm text-on-surface-variant">{t('login.secureText')}</p>
          </div>
          <div className="rounded-md border border-outline-variant bg-surface-container p-5">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Icon name="hub" className="text-2xl" />
            </div>
            <h3 className="mb-2 text-lg font-semibold text-on-surface">{t('login.walletsTitle')}</h3>
            <p className="text-sm text-on-surface-variant">{t('login.walletsText')}</p>
          </div>
        </div>
        <div className="relative overflow-hidden rounded-md border border-outline-variant bg-surface-container p-5 mt-6 mr-10">
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary/5 blur-3xl" />
          <h4 className="mb-4 font-mono text-xs font-medium uppercase tracking-widest text-primary">{t('login.whyTitle')}</h4>
          <div className="space-y-2 text-sm text-on-surface-variant">
            <p>{t('login.why1')}</p>
            <p>{t('login.why2')}</p>
            <p>{t('login.why3')}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:col-span-5">
        <div className="rounded-md border border-outline-variant bg-surface-container-high p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="rounded-full bg-primary/15 p-2 text-primary">
              <Icon name="account_balance_wallet" className="text-2xl" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-on-surface">{t('login.chooseTitle')}</h2>
              <p className="text-sm text-on-surface-variant">{t('login.chooseText')}</p>
            </div>
          </div>

          <div className="mb-5 space-y-3">
            <FormField label={t('login.chain')} hint={t('login.chainHint')}>
              <select
                className={inputCls}
                value={selectedChain}
                onChange={(event) => void handleChainChange(event.target.value)}
                disabled={!!connectingWalletKey}
              >
                {availableChainOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="rounded-md border border-outline-variant bg-surface-container px-4 py-3 text-sm text-on-surface-variant">
              {availableChainOptions.find((option) => option.id === selectedChain)?.hint}
            </div>
          </div>

          <div className="mb-4">
            <h3 className="text-base font-semibold text-on-surface">{getWalletSectionTitle(selectedChain)}</h3>
            <p className="text-sm text-on-surface-variant">
              {selectedChain === 'localnet' ? t('login.localnetHint') : t('login.walletsHint')}
            </p>
          </div>

          <div className="space-y-3">
            {featuredWallets.map((wallet) => {
              const isConnecting = connectingWalletKey === wallet.walletKey
              const isPera = wallet.id === WALLET_ID.PERA
              const isDefly = wallet.id === WALLET_ID.DEFLY
              const isKmd = wallet.id === WALLET_ID.KMD
              const isBiatec = wallet.id === WALLET_ID.BIATEC
              const isWalletConnect = wallet.id === WALLET_ID.WALLETCONNECT
              const description = isKmd
                ? t('login.kmd')
                : isPera
                  ? t('login.pera')
                  : isDefly
                    ? t('login.defly')
                    : isBiatec
                      ? t('login.biatec')
                      : t('login.walletConnect')
              const actionIcon = isKmd ? 'developer_mode' : isWalletConnect || isBiatec ? 'qr_code_2' : 'login'

              return (
                <button
                  key={wallet.walletKey}
                  onClick={() => connectWallet(wallet)}
                  disabled={isConnecting}
                  className="flex w-full items-center gap-4 rounded-md border border-outline-variant bg-surface-container px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-bright">
                    <img
                      src={wallet.metadata.icon}
                      alt={t('login.logoAlt', { name: wallet.metadata.name })}
                      className="h-8 w-8 object-contain"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-base font-semibold text-on-surface">{wallet.metadata.name}</div>
                    <div className="text-sm text-on-surface-variant">{description}</div>
                  </div>
                  <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-wide text-primary">
                    {isConnecting ? (
                      <Icon name="sync" className="animate-spin text-base" />
                    ) : (
                      <Icon name={actionIcon} className="text-base" />
                    )}
                    <span>{isConnecting ? t('login.connecting') : t('login.connect')}</span>
                  </div>
                </button>
              )
            })}

            {featuredWallets.length === 0 && (
              <Card className="py-8 text-center text-sm text-on-surface-variant">{t('login.noWallets')}</Card>
            )}
          </div>

          {connectError && (
            <div className="mt-4 rounded-sm border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-error-container">
              {connectError}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
