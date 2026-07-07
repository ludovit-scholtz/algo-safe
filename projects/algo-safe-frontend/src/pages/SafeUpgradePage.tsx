import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNetwork, useWallet } from '@txnlab/use-wallet-react'
import algosdk from 'algosdk'
import { useState } from 'react'
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
      setErrorMessage('Connect a wallet with admin access before managing rekeyed addresses.')
      return
    }
    if (!algosdk.isValidAddress(address.trim())) {
      setErrorMessage('Enter a valid Algorand address.')
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
      reportError(error, 'Failed to create the registry proposal.')
    } finally {
      setBusy(null)
    }
  }

  async function handleDeployUpgrade() {
    setErrorMessage(null)
    if (!safe || !walletReady) {
      setErrorMessage('Connect a wallet before deploying the upgraded safe.')
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
      reportError(error, 'Failed to deploy and clone the upgraded safe.')
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
      reportError(error, 'Failed to create the migration rekey proposal.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-on-surface">Upgrade & Rekeyed Addresses</h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Manage the addresses rekeyed to this safe and migrate the safe to the latest contract version.
          </p>
        </div>
        <Link to={`/safe/${safeId}`}>
          <Button variant="secondary">
            <Icon name="arrow_back" className="text-base" />
            Back to Dashboard
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
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Contract Version</h2>
          <div className="space-y-2 text-sm text-on-surface-variant">
            <p>
              Deployed version hash:{' '}
              <span className="font-mono text-on-surface" data-test-id="version-hash">
                {versionStatus?.versionHash ? `${versionStatus.versionHash.slice(0, 16)}…` : 'detecting…'}
              </span>
            </p>
            {versionStatus?.isLatest ? (
              <p className="flex items-center gap-2 text-primary">
                <Icon name="check_circle" className="text-base" /> This safe runs the latest contract version.
              </p>
            ) : (
              <p className="flex items-center gap-2 text-warn">
                <Icon name="warning" className="text-base" /> A newer contract version is available — consider upgrading below.
              </p>
            )}
          </div>
          <h2 className="mb-3 mt-6 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Admin Group</h2>
          <FormField
            label="Signer group for proposals"
            hint="Registry changes and the migration rekey are proposed through this admin group."
          >
            <select
              className={inputCls}
              value={adminGroupId}
              onChange={(event) => setAdminGroupId(event.target.value)}
              data-test-id="admin-group-select"
            >
              {adminGroups.length === 0 && <option value="1">Group 1</option>}
              {adminGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} · {group.threshold}-of-{group.memberCount}
                </option>
              ))}
            </select>
          </FormField>
        </Card>

        <Card>
          <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Upgrade Safe</h2>
          <div className="space-y-3 text-sm text-on-surface-variant">
            <p>
              Upgrading deploys a <strong>new safe on the latest contract</strong>, clones this safe's signer groups, policies, and
              rekeyed-address registry onto it, and then — via a governed rekey proposal — hands every controlled address (including this
              safe's own account) over to the new deployment. Funds never leave the addresses.
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Deploy & clone the configuration (signed by your wallet, no custody change).</li>
              <li>Propose the migration rekey; admins approve it at the group threshold.</li>
              <li>Execute — the new safe takes over, and this safe becomes read-only history.</li>
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
                {busy === 'deploy' ? 'Deploying…' : '1 · Deploy & Clone'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy !== null || !walletReady || !upgradeResult}
                onClick={() => void handleProposeMigration()}
                data-test-id="propose-migration"
              >
                {busy === 'migrate' ? <Icon name="sync" className="animate-spin text-base" /> : <Icon name="key" className="text-base" />}
                {busy === 'migrate' ? 'Proposing…' : '2 · Propose Migration Rekey'}
              </Button>
            </div>
            {upgradeResult && (
              <div
                className="rounded-sm border border-primary/30 bg-primary/10 px-3 py-2 text-sm text-on-surface"
                data-test-id="upgrade-result"
              >
                <p>
                  New safe deployed — App ID <span className="font-mono">{upgradeResult.appId.toString()}</span>
                </p>
                <AddressDisplay address={upgradeResult.appAddress} textClassName="text-xs text-on-surface-variant" />
                <p className="mt-1 text-xs text-on-surface-variant">
                  Saved to this browser's safe list. Now create the migration rekey proposal and collect admin approvals.
                </p>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wide text-on-surface-variant">Rekeyed Addresses</h2>
        <p className="mb-4 text-sm text-on-surface-variant">
          External addresses whose spending authority has been rekeyed to this safe. The list is governed by admin proposals and is used
          during migration to re-rekey every controlled address to the new safe. Registering an address here does not rekey it — submit the
          actual rekey transaction from that account separately.
        </p>

        <form
          className="mb-4 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            void handleRegistryChange('add', newAddress, newLabel)
          }}
        >
          <FormField label="Address" hint="The account rekeyed (or about to be rekeyed) to this safe.">
            <input
              className={inputCls}
              value={newAddress}
              onChange={(event) => setNewAddress(event.target.value)}
              placeholder="Algorand address"
              data-test-id="rekeyed-address-input"
            />
          </FormField>
          <FormField label="Label" hint="Optional human-readable name.">
            <input
              className={inputCls}
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="e.g. ops hot wallet"
            />
          </FormField>
          <div className="flex items-end pb-1">
            <Button type="submit" disabled={busy !== null || !walletReady} data-test-id="rekeyed-address-add">
              {busy === 'registry-add' ? (
                <Icon name="sync" className="animate-spin text-base" />
              ) : (
                <Icon name="add" className="text-base" />
              )}
              Propose Add
            </Button>
          </div>
        </form>

        <div className="space-y-2" data-test-id="rekeyed-address-list">
          {(rekeyedAddresses ?? []).length === 0 && <p className="text-sm text-on-surface-variant">No rekeyed addresses registered.</p>}
          {(rekeyedAddresses ?? []).map((record) => (
            <div
              key={record.address}
              className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-outline-variant bg-surface-container-low px-3 py-2"
            >
              <div className="min-w-0">
                <AddressDisplay address={record.address} textClassName="text-sm text-on-surface" />
                <p className="text-xs text-on-surface-variant">
                  {record.label || 'unlabelled'} · registered at round {record.addedRound.toString()}
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
                Propose Remove
              </Button>
            </div>
          ))}
        </div>
        <div className="mt-3">
          <Button type="button" variant="ghost" onClick={() => void refetchRekeyed()}>
            <Icon name="refresh" className="text-base" /> Refresh
          </Button>
        </div>
      </Card>
    </div>
  )
}
