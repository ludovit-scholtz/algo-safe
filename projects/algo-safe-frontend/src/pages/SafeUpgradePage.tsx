import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNetwork, useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { AddressDisplay } from '../components/AddressDisplay'
import { Button } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { FormField, inputCls } from '../components/ui/FormField'
import { Icon } from '../components/ui/Icon'
import { useSafe, useSignerGroups } from '../hooks'
import { upsertSafeRegistryEntry, normalizeNetworkId } from '../lib/safeRegistry'
import { useSafeId } from '../lib/SafeContext'
import {
  fetchSafeRekeyedAddresses,
  getSafeUpgradeStatus,
  proposeMigrationRekey,
  proposeRekeyedAddressChange,
  upgradeSafeToLatest,
  type UpgradeSafeResult,
} from '../services/algoSafeMigration'

export function SafeUpgradePage() {
  const { t } = useTranslation('upgrade')
  const safeId = useSafeId()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: safe } = useSafe(safeId)
  const { data: signerGroups } = useSignerGroups()
  const { activeAddress, algodClient, transactionSigner, isReady } = useWallet()
  const { activeNetwork } = useNetwork()

  const [adminGroupId, setAdminGroupId] = useState('1')
  const [newAddress, setNewAddress] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [upgradeResult, setUpgradeResult] = useState<UpgradeSafeResult | null>(null)

  const context = { algodClient, safe: safe!, activeAddress, transactionSigner }
  const walletReady = Boolean(isReady && activeAddress && transactionSigner)
  const adminGroups = (signerGroups ?? []).filter((group) => group.isAdminGroup && group.active)

  const { data: versionStatus } = useQuery({
    queryKey: ['safe-version', safeId, safe?.appId],
    enabled: Boolean(safe),
    queryFn: () => getSafeUpgradeStatus(context),
  })
  const { data: rekeyedAddresses, refetch: refetchRekeyed } = useQuery({
    queryKey: ['rekeyed-addresses', safeId, safe?.appId],
    enabled: Boolean(safe),
    queryFn: () => fetchSafeRekeyedAddresses(context),
  })

  function reportError(error: unknown, fallback: string) {
    setErrorMessage(error instanceof Error && error.message.trim() ? error.message : fallback)
  }

  async function handleRegistryChange(action: 'add' | 'remove', address: string, label?: string) {
    setErrorMessage(null)
    if (!safe || !walletReady) {
      setErrorMessage(t('errors.connectAdmin'))
      return
    }
    if (!algosdk.isValidAddress(address.trim())) {
      setErrorMessage(t('errors.invalidAddress'))
      return
    }

    try {
      setBusy(action === 'add' ? 'registry-add' : `registry-remove-${address}`)
      const { proposalId, txId } = await proposeRekeyedAddressChange(context, {
        adminGroupId: BigInt(adminGroupId || '1'),
        action,
        address,
        label,
      })
      setNewAddress('')
      setNewLabel('')
      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (error) {
      reportError(error, t('errors.registryProposalFailed'))
    } finally {
      setBusy(null)
    }
  }

  async function handleDeployUpgrade() {
    setErrorMessage(null)
    if (!safe || !walletReady) {
      setErrorMessage(t('errors.connectDeploy'))
      return
    }

    try {
      setBusy('deploy')
      const result = await upgradeSafeToLatest(context)
      setUpgradeResult(result)
      // Save the clone in the browser's safe registry so it opens like any other safe.
      upsertSafeRegistryEntry({
        appId: Number(result.appId),
        address: result.appAddress,
        creatorAddress: activeAddress!,
        name: result.config.name,
        network: normalizeNetworkId(activeNetwork),
      })
      await queryClient.invalidateQueries({ queryKey: ['safes'] })
    } catch (error) {
      reportError(error, t('errors.deployFailed'))
    } finally {
      setBusy(null)
    }
  }

  async function handleProposeMigration() {
    setErrorMessage(null)
    if (!safe || !walletReady || !upgradeResult) return

    try {
      setBusy('migrate')
      const { proposalId, txId } = await proposeMigrationRekey(context, {
        groupId: BigInt(adminGroupId || '1'),
        newSafeAddress: upgradeResult.appAddress,
      })
      await queryClient.invalidateQueries({ queryKey: ['proposals', safeId] })
      navigate(`/safe/${safeId}/proposals/${proposalId}`, { state: { txId } })
    } catch (error) {
      reportError(error, t('errors.migrationProposalFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">{t('title')}</h1>
          <p className="mt-1 text-sm text-on-surface-variant">{t('subtitle')}</p>
        </div>
        <Link to={`/safe/${safeId}`}>
          <Button variant="secondary">
            <Icon name="arrow_back" className="text-base" />
            {t('backToDashboard')}
          </Button>
        </Link>
      </div>

      {errorMessage && (
        <div className="rounded-sm border border-error/40 bg-error-container/40 px-3 py-2 text-sm text-on-error-container">
          {errorMessage}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('version.title')}</h2>
          <div className="space-y-2 text-sm text-on-surface-variant">
            <p>
              {t('version.deployedHash')}{' '}
              <span className="font-mono text-on-surface" data-test-id="version-hash">
                {versionStatus?.versionHash ? `${versionStatus.versionHash.slice(0, 16)}…` : t('version.detecting')}
              </span>
            </p>
            {versionStatus?.isLatest ? (
              <p className="flex items-center gap-2 text-primary">
                <Icon name="check_circle" className="text-base" /> {t('version.isLatest')}
              </p>
            ) : (
              <p className="flex items-center gap-2 text-warn">
                <Icon name="warning" className="text-base" /> {t('version.newerAvailable')}
              </p>
            )}
          </div>
          <h2 className="mb-3 mt-6 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('adminGroup.title')}</h2>
          <FormField label={t('adminGroup.label')} hint={t('adminGroup.hint')}>
            <select
              className={inputCls}
              value={adminGroupId}
              onChange={(event) => setAdminGroupId(event.target.value)}
              data-test-id="admin-group-select"
            >
              {adminGroups.length === 0 && <option value="1">{t('adminGroup.fallbackOption')}</option>}
              {adminGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {t('adminGroup.option', { name: group.name, threshold: group.threshold, memberCount: group.memberCount })}
                </option>
              ))}
            </select>
          </FormField>
        </Card>

        <Card>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('upgrade.title')}</h2>
          <div className="space-y-3 text-sm text-on-surface-variant">
            <p>
              <Trans t={t} i18nKey="upgrade.intro" components={{ strong: <strong /> }} />
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>{t('upgrade.step1')}</li>
              <li>{t('upgrade.step2')}</li>
              <li>{t('upgrade.step3')}</li>
            </ol>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button
                type="button"
                disabled={busy !== null || !walletReady}
                onClick={() => void handleDeployUpgrade()}
                data-test-id="deploy-upgrade"
              >
                {busy === 'deploy' ? (
                  <Icon name="sync" className="animate-spin text-base" />
                ) : (
                  <Icon name="rocket_launch" className="text-base" />
                )}
                {busy === 'deploy' ? t('upgrade.deploying') : t('upgrade.deployButton')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null || !walletReady || !upgradeResult}
                onClick={() => void handleProposeMigration()}
                data-test-id="propose-migration"
              >
                {busy === 'migrate' ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="key" className="text-base" />}
                {busy === 'migrate' ? t('upgrade.proposing') : t('upgrade.proposeButton')}
              </Button>
            </div>
            {upgradeResult && (
              <div
                className="rounded-sm border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-on-surface"
                data-test-id="upgrade-result"
              >
                <p>
                  <Trans
                    t={t}
                    i18nKey="upgrade.deployed"
                    values={{ appId: upgradeResult.appId.toString() }}
                    components={{ mono: <span className="font-mono" /> }}
                  />
                </p>
                <AddressDisplay address={upgradeResult.appAddress} textClassName="text-xs text-on-surface-variant" />
                <p className="mt-1 text-xs text-on-surface-variant">{t('upgrade.savedHint')}</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">{t('registry.title')}</h2>
        <p className="mb-4 text-sm text-on-surface-variant">{t('registry.description')}</p>

        <form
          className="mb-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            void handleRegistryChange('add', newAddress, newLabel)
          }}
        >
          <FormField label={t('registry.addressLabel')} hint={t('registry.addressHint')}>
            <input
              className={inputCls}
              value={newAddress}
              onChange={(event) => setNewAddress(event.target.value)}
              placeholder={t('registry.addressPlaceholder')}
              data-test-id="rekeyed-address-input"
            />
          </FormField>
          <FormField label={t('registry.labelLabel')} hint={t('registry.labelHint')}>
            <input
              className={inputCls}
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder={t('registry.labelPlaceholder')}
            />
          </FormField>
          <div className="flex items-end pb-1">
            <Button type="submit" disabled={busy !== null || !walletReady} data-test-id="rekeyed-address-add">
              {busy === 'registry-add' ? (
                <Icon name="sync" className="animate-spin text-base" />
              ) : (
                <Icon name="add" className="text-base" />
              )}
              {t('registry.proposeAdd')}
            </Button>
          </div>
        </form>

        <div className="space-y-2" data-test-id="rekeyed-address-list">
          {(rekeyedAddresses ?? []).length === 0 && <p className="text-sm text-on-surface-variant">{t('registry.empty')}</p>}
          {(rekeyedAddresses ?? []).map((record) => (
            <div
              key={record.address}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-outline-variant bg-surface-container-low px-3 py-2"
            >
              <div className="min-w-0">
                <AddressDisplay address={record.address} textClassName="text-sm text-on-surface" />
                <p className="text-xs text-on-surface-variant">
                  {t('registry.recordMeta', { label: record.label || t('registry.unlabelled'), round: record.addedRound.toString() })}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null || !walletReady}
                onClick={() => void handleRegistryChange('remove', record.address)}
              >
                {busy === `registry-remove-${record.address}` ? (
                  <Icon name="sync" className="animate-spin text-base" />
                ) : (
                  <Icon name="delete" className="text-base" />
                )}
                {t('registry.proposeRemove')}
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Button type="button" variant="ghost" onClick={() => void refetchRekeyed()}>
            <Icon name="refresh" className="text-base" /> {t('registry.refresh')}
          </Button>
        </div>
      </Card>
    </div>
  )
}
