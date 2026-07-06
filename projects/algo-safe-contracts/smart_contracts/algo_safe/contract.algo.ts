import {
  Account,
  assert,
  BoxMap,
  Bytes,
  bytes,
  clone,
  Contract,
  emit,
  ensureBudget,
  Global,
  GlobalState,
  op,
  TransactionType,
  Txn,
  uint64,
  Uint64,
} from '@algorandfoundation/algorand-typescript'
import { abimethod, decodeArc4 } from '@algorandfoundation/algorand-typescript/arc4'

/**
 * Algo Safe — policy-driven smart account for Algorand.
 *
 * The application account is the safe: it holds ALGO and ASAs and only moves
 * value when an M-of-N signer group has approved a typed proposal. Every
 * privileged change (creating groups, adding/removing signers, changing
 * thresholds and policies) is itself a governed proposal approved under the
 * same threshold rules, so the contract never trusts a single caller for a
 * privileged change.
 *
 * Written in Algorand TypeScript (PuyaTs) and compiled to AVM bytecode. All
 * state-changing authorization comes from the signed approval app call: the
 * AVM has already verified the transaction signature before this program runs,
 * so the contract checks `Txn.sender` against signer-group membership.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Proposal status values.
const STATUS_ACTIVE: uint64 = Uint64(1) // waiting for approvals
const STATUS_READY: uint64 = Uint64(2) // threshold met, ready to execute
const STATUS_EXECUTED: uint64 = Uint64(3)
const STATUS_CANCELLED: uint64 = Uint64(4)

// Proposal payload type discriminators.
const PT_TRANSACTION_GROUP: uint64 = Uint64(1)
const PT_ADMIN: uint64 = Uint64(5)

// Transaction entry type discriminators for transaction-group proposals.
const TX_PAYMENT: uint64 = Uint64(1)
const TX_ASSET: uint64 = Uint64(2)
const TX_APP: uint64 = Uint64(3)
const TX_KEYREG: uint64 = Uint64(4)
const TX_ACFG: uint64 = Uint64(5) // asset configuration (create / reconfigure / destroy)

// Maximum executable transactions in one transaction-group proposal. Algorand
// protocol transaction groups currently allow up to 16 transactions; this cap
// tracks that limit and can be raised if the protocol limit changes.
const MAX_GROUP_TXNS: uint64 = Uint64(16)

// Application-call resource limits (Algorand consensus parameters). The contract
// rejects any app-call payload that exceeds these before staging the inner txn.
const MAX_APP_ARGS: uint64 = Uint64(16) // MaxAppArgs
const MAX_APP_TOTAL_ARG_LEN: uint64 = Uint64(2048) // MaxAppTotalArgLen
const MAX_APP_ACCOUNTS: uint64 = Uint64(4) // MaxAppTxnAccounts
const MAX_APP_FOREIGN_APPS: uint64 = Uint64(8) // MaxAppTxnForeignApps
const MAX_APP_FOREIGN_ASSETS: uint64 = Uint64(8) // MaxAppTxnForeignAssets
const MAX_APP_TOTAL_REFS: uint64 = Uint64(8) // MaxAppTotalTxnReferences (accounts + apps + assets)

// Allowed-action bitmask (SignerGroup.allowedActions).
const ACT_PAY: uint64 = Uint64(1)
const ACT_AXFER: uint64 = Uint64(2)
const ACT_APPL: uint64 = Uint64(4)
const ACT_KEYREG: uint64 = Uint64(8)
const ACT_ACFG: uint64 = Uint64(16)
const ACT_ALL: uint64 = Uint64(31)

// Admin-privilege bitmask (SignerGroup.adminPrivileges).
const PRIV_GROUP: uint64 = Uint64(1) // create/modify groups, members, thresholds, privileges, active
const PRIV_POLICY: uint64 = Uint64(2) // change spending/action policy
const PRIV_ALL: uint64 = Uint64(7)

// Admin change discriminators (AdminChange.changeType).
const ADM_CREATE_GROUP: uint64 = Uint64(1)
const ADM_ADD_MEMBER: uint64 = Uint64(2)
const ADM_REMOVE_MEMBER: uint64 = Uint64(3)
const ADM_CHANGE_THRESHOLD: uint64 = Uint64(4)
const ADM_SET_POLICY: uint64 = Uint64(5)
const ADM_SET_PRIVILEGES: uint64 = Uint64(6)
const ADM_SET_ACTIVE: uint64 = Uint64(7)

// Period lengths for spending limits, in seconds.
const DAY_SECONDS: uint64 = Uint64(86400)
const MONTH_SECONDS: uint64 = Uint64(2592000) // 30 days
const CONTRACT_VERSION = 'BIATEC-ALGO-SAFE-v1.3.0'

// ---------------------------------------------------------------------------
// Stored record types (plain TS types for box storage)
// ---------------------------------------------------------------------------

type SignerGroup = {
  name: string
  threshold: uint64
  memberCount: uint64
  adminPrivileges: uint64
  allowedActions: uint64
  limitAssetId: uint64 // 0 = ALGO, otherwise the ASA tracked by daily/monthly limits
  dailyLimit: uint64 // microALGO; 0 = no limit
  dailyUsage: uint64
  dailyPeriodStart: uint64
  monthlyLimit: uint64 // microALGO; 0 = no limit
  monthlyUsage: uint64
  monthlyPeriodStart: uint64
  cooldownRounds: uint64
  active: uint64 // 1 = active, 0 = disabled
}

type Member = {
  accountType: uint64 // 1 standard, 2 multisig, 3 rekeyed, 4 agent, 5 quantum
  label: string
  addr: Account
}

type Proposal = {
  groupId: uint64
  status: uint64
  payloadType: uint64
  approvalsCount: uint64
  threshold: uint64
  expiryRound: uint64
  proposer: Account
  numPayloads: uint64
}

// Per-transaction-type payload structs. Each type carries only the attributes
// it actually needs, so a stored transaction occupies far fewer bytes than a
// single union struct that reserves space for every field of every type.
type PaymentTxn = {
  receiver: Account
  amount: uint64
  hasClose: uint64
  closeRemainderTo: Account
  note: string
}

type AssetTxn = {
  xferAsset: uint64
  assetReceiver: Account
  assetAmount: uint64
  hasAssetClose: uint64
  assetCloseTo: Account
  note: string
}

type AppTxn = {
  appId: uint64
  onCompletion: uint64
  appArgs: bytes[]
  accounts: Account[]
  foreignApps: uint64[]
  foreignAssets: uint64[]
  note: string
}

type KeyRegTxn = {
  online: uint64 // 1 = register online (keys supplied), 0 = go offline
  voteKey: bytes
  selectionKey: bytes
  stateProofKey: bytes
  voteFirst: uint64
  voteLast: uint64
  voteKeyDilution: uint64
}

type AssetConfigTxn = {
  configAsset: uint64 // 0 = create a new asset, otherwise reconfigure/destroy this asset
  total: uint64
  decimals: uint64
  defaultFrozen: uint64
  unitName: string
  assetName: string
  url: string
  metadataHash: bytes
  manager: Account
  reserve: Account
  freeze: Account
  clawback: Account
  note: string
}

// Tagged envelope: `txType` selects how `data` is decoded (one of the structs
// above, ARC4-encoded). This keeps the payload array homogeneous on the wire
// while letting each entry hold only its own type's fields.
type SafeTxn = {
  txType: uint64
  data: bytes
}

// Flat ordered list of safe transactions stored per-payload in the box.
type SafeTxnGroup = SafeTxn[]

// Multiplier for the computed box key: proposalId * TXG_KEY_MULT + payloadIndex.
// A multiplier > 6 (the max payloadIndex) guarantees no key collisions.
const TXG_KEY_MULT: uint64 = Uint64(7)

type AdminChange = {
  changeType: uint64
  targetGroupId: uint64
  groupName: string
  memberAddr: Account
  memberType: uint64
  memberLabel: string
  threshold: uint64
  adminPrivileges: uint64
  allowedActions: uint64
  limitAssetId: uint64
  dailyLimit: uint64
  monthlyLimit: uint64
  cooldownRounds: uint64
  activeFlag: uint64
}

type Approval = {
  signer: Account
  round: uint64
}

// ---------------------------------------------------------------------------
// Event types (ARC-28)
// ---------------------------------------------------------------------------

type SafeCreated = { name: string; creator: Account }
type GroupCreated = { groupId: uint64; name: string; threshold: uint64 }
type MemberAdded = { groupId: uint64; member: Account; accountType: uint64 }
type MemberRemoved = { groupId: uint64; member: Account }
type GroupUpdated = { groupId: uint64 }
type ProposalCreated = { proposalId: uint64; groupId: uint64; payloadType: uint64; proposer: Account }
type ProposalApproved = { proposalId: uint64; signer: Account; approvalsCount: uint64 }
type ProposalExecuted = { proposalId: uint64 }
type ProposalCancelled = { proposalId: uint64 }

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export class AlgoSafe extends Contract {
  // Global configuration.
  name = GlobalState<string>({ key: 'name' })
  creator = GlobalState<Account>({ key: 'creator' })
  bootstrapped = GlobalState<uint64>({ key: 'boot' })
  nextGroupId = GlobalState<uint64>({ key: 'ngid' })
  nextProposalId = GlobalState<uint64>({ key: 'npid' })
  groupCount = GlobalState<uint64>({ key: 'gcnt' })
  paused = GlobalState<uint64>({ key: 'paused' })
  version = GlobalState<string>({ key: 'ver' })
  // Count of active groups currently holding PRIV_GROUP. Maintained
  // incrementally (see _applyAdminChange / bootstrap) so governance changes
  // that would drop it to 0 can be rejected without scanning every group.
  activePrivGroupCount = GlobalState<uint64>({ key: 'apgc' })

  // Box storage.
  groups = BoxMap<uint64, SignerGroup>({ keyPrefix: 'g' })
  members = BoxMap<{ groupId: uint64; account: Account }, Member>({ keyPrefix: 'm' })
  proposals = BoxMap<uint64, Proposal>({ keyPrefix: 'p' })
  approvals = BoxMap<{ proposalId: uint64; account: Account }, Approval>({ keyPrefix: 'a' })
  // Key = proposalId * TXG_KEY_MULT + payloadIndex (avoids composite-struct encoding overhead).
  transactionGroups = BoxMap<uint64, SafeTxnGroup>({ keyPrefix: 'txg' })
  adminPayloads = BoxMap<uint64, AdminChange>({ keyPrefix: 'dp' })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Initialise the safe. The creator becomes the bootstrap admin and must call
   * `bootstrap` once (after funding the app account) to create the first admin
   * signer group. The application is intentionally non-updatable and
   * non-deletable for custody safety.
   */
  public createApplication(name: string): void {
    this.name.value = name
    this.creator.value = Txn.sender
    this.bootstrapped.value = Uint64(0)
    this.nextGroupId.value = Uint64(1)
    this.nextProposalId.value = Uint64(1)
    this.groupCount.value = Uint64(0)
    this.paused.value = Uint64(0)
    this.version.value = CONTRACT_VERSION
    this.activePrivGroupCount.value = Uint64(0)
    emit<SafeCreated>({ name, creator: Txn.sender })
  }

  /**
   * Genesis bootstrap: create the first admin signer group as a 1-of-1 group
   * whose sole member is the creator, with full admin privileges and all
   * actions allowed. Callable exactly once, only by the creator. After this,
   * every privileged change must go through governance.
   *
   * Requires the app account to be funded for box MBR beforehand.
   */
  public bootstrap(groupName: string): void {
    assert(Txn.sender === this.creator.value, 'only creator can bootstrap')
    assert(this.bootstrapped.value === Uint64(0), 'already bootstrapped')

    const now = Global.latestTimestamp
    const gid: uint64 = this.nextGroupId.value

    const grp: SignerGroup = {
      name: groupName,
      threshold: Uint64(1),
      memberCount: Uint64(1),
      adminPrivileges: PRIV_ALL,
      allowedActions: ACT_ALL,
      limitAssetId: Uint64(0),
      dailyLimit: Uint64(0),
      dailyUsage: Uint64(0),
      dailyPeriodStart: now,
      monthlyLimit: Uint64(0),
      monthlyUsage: Uint64(0),
      monthlyPeriodStart: now,
      cooldownRounds: Uint64(0),
      active: Uint64(1),
    }
    this.groups(gid).value = clone(grp)

    const m: Member = { accountType: Uint64(1), label: 'creator', addr: Txn.sender }
    this.members({ groupId: gid, account: Txn.sender }).value = clone(m)

    this.nextGroupId.value = gid + Uint64(1)
    this.groupCount.value = this.groupCount.value + Uint64(1)
    this.bootstrapped.value = Uint64(1)
    // Genesis group holds PRIV_ALL (includes PRIV_GROUP) and is active.
    this.activePrivGroupCount.value = Uint64(1)

    emit<GroupCreated>({ groupId: gid, name: groupName, threshold: Uint64(1) })
    emit<MemberAdded>({ groupId: gid, member: Txn.sender, accountType: Uint64(1) })
  }

  // -------------------------------------------------------------------------
  // Proposal creation
  // -------------------------------------------------------------------------

  /**
   * Create a transaction-group proposal from the first payload chunk. When the
   * total number of transactions exceeds the ~2 KB per-ABI-argument limit, call
   * appendTransactionGroupPayload (once per extra chunk, slots 2–6) before the
   * proposal is approved and executed. Stores the payload at slot 1.
   *
   * When `execute` is true, attempts to execute the proposal immediately after
   * creating it — this only succeeds if the signer group's threshold is 1 (so
   * the proposer's auto-approval alone satisfies it) and the transactions fall
   * within the group's spending limits, letting a single app call both propose
   * and execute a transaction group.
   */
  public proposeTransactionGroup(
    groupId: uint64,
    payload: SafeTxnGroup,
    expiryRound: uint64,
    execute: boolean,
    ensureBudgetValue: uint64,
  ): uint64 {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    assert(payload.length >= Uint64(1), 'empty tx group')
    assert(payload.length <= MAX_GROUP_TXNS, 'too many txs')
    assert(this.paused.value === Uint64(0), 'safe paused')
    this._assertMember(groupId)
    assert(this.groups(groupId).value.active !== Uint64(0), 'group disabled')
    const pid = this._newProposal(groupId, PT_TRANSACTION_GROUP, expiryRound)
    this._storePayloadGroup(pid, Uint64(1), payload)
    const p = clone(this.proposals(pid).value)
    p.numPayloads = Uint64(1)
    this.proposals(pid).value = clone(p)
    if (execute) {
      this._executeProposalInternal(pid)
    }
    return pid
  }

  /**
   * Append an additional payload chunk (slots 2–6) to an existing transaction-group
   * proposal. Callable only by the original proposer, and only while
   * `approvalsCount === 1` (i.e. no one but the proposer's own auto-approval has
   * approved yet). This closes the window for a member to alter the executed
   * transaction set after an independent signer has approved the proposal as it
   * existed at that time — see the `approveProposal` / `_executeProposalInternal`
   * comments for how approvals are bound to a payload.
   */
  public appendTransactionGroupPayload(
    proposalId: uint64,
    payloadIndex: uint64,
    payload: SafeTxnGroup,
    ensureBudgetValue: uint64,
  ): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    assert(payloadIndex >= Uint64(2) && payloadIndex <= Uint64(6), 'invalid slot')
    assert(payload.length >= Uint64(1), 'empty payload')
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.payloadType === PT_TRANSACTION_GROUP, 'not a tx group')
    assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'proposal not pending')
    assert(Txn.sender === proposal.proposer, 'only proposer can append')
    assert(proposal.approvalsCount === Uint64(1), 'cannot modify payload after independent approval')
    this._storePayloadGroup(proposalId, payloadIndex, payload)
    if (payloadIndex > proposal.numPayloads) {
      const updated = clone(proposal)
      updated.numPayloads = payloadIndex
      this.proposals(proposalId).value = clone(updated)
    }
  }

  /** Create a governed signer-group administration proposal. */
  public proposeAdminChange(
    groupId: uint64,
    change: AdminChange,
    expiryRound: uint64,
    ensureBudgetValue: uint64,
  ): uint64 {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    // Proposer must be a member of an admin-capable group with the right privilege.
    this._assertMember(groupId)
    const group = clone(this.groups(groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')
    this._assertPrivilegeForChange(change.changeType, group)
    this._validateAdminChange(change)

    const pid = this._newProposal(groupId, PT_ADMIN, expiryRound)
    this.adminPayloads(pid).value = clone(change)
    return pid
  }

  // -------------------------------------------------------------------------
  // Approval / execution / cancellation
  // -------------------------------------------------------------------------

  /** Record the caller's approval of a proposal. */
  public approveProposal(proposalId: uint64, ensureBudgetValue: uint64): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'not approvable')
    assert(Global.round <= proposal.expiryRound, 'proposal expired')
    assert(this.members({ groupId: proposal.groupId, account: Txn.sender }).exists, 'not a group member')
    assert(!this.approvals({ proposalId, account: Txn.sender }).exists, 'already approved')

    this._recordApproval(proposalId, proposal)
  }

  /** Execute a proposal once its threshold has been met. */
  public executeProposal(proposalId: uint64, ensureBudgetValue: uint64): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    this._executeProposalInternal(proposalId)
  }

  /** Cancel a pending proposal. Allowed for the proposer or any member of the proposal's group. */
  public cancelProposal(proposalId: uint64, ensureBudgetValue: uint64): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'not cancellable')
    const isProposer = Txn.sender === proposal.proposer
    const isMember = this.members({ groupId: proposal.groupId, account: Txn.sender }).exists
    assert(isProposer || isMember, 'not authorised to cancel')

    proposal.status = STATUS_CANCELLED
    this.proposals(proposalId).value = clone(proposal)
    emit<ProposalCancelled>({ proposalId })
  }

  /**
   * Reclaim box MBR for a proposal that finished (EXECUTED/CANCELLED) and is
   * past its expiry round, by deleting its proposal record and any
   * transaction-group/admin payload boxes. Callable by any member of the
   * proposal's group. Approval boxes (keyed per-signer, with no on-chain list
   * of who approved) are not deleted here.
   */
  public pruneProposal(proposalId: uint64, ensureBudgetValue: uint64): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_EXECUTED || proposal.status === STATUS_CANCELLED, 'proposal not terminal')
    assert(Global.round > proposal.expiryRound, 'not yet expired')
    this._assertMember(proposal.groupId)

    if (proposal.payloadType === PT_TRANSACTION_GROUP) {
      for (let p = Uint64(1); p <= proposal.numPayloads; p = p + Uint64(1)) {
        const key: uint64 = proposalId * TXG_KEY_MULT + p
        if (this.transactionGroups(key).exists) {
          this.transactionGroups(key).delete()
        }
      }
    } else if (this.adminPayloads(proposalId).exists) {
      this.adminPayloads(proposalId).delete()
    }
    this.proposals(proposalId).delete()
  }

  // -------------------------------------------------------------------------
  // Read-only getters
  // -------------------------------------------------------------------------

  @abimethod({ readonly: true })
  public getConfig(ensureBudgetValue: uint64): [string, uint64, uint64, uint64, uint64, string] {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return [
      this.name.value,
      this.groupCount.value,
      this.nextGroupId.value,
      this.nextProposalId.value,
      this.paused.value,
      this.version.value,
    ]
  }

  @abimethod({ readonly: true })
  public getSignerGroup(groupId: uint64, ensureBudgetValue: uint64): SignerGroup {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return clone(this.groups(groupId).value)
  }

  @abimethod({ readonly: true })
  public getProposal(proposalId: uint64, ensureBudgetValue: uint64): Proposal {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return clone(this.proposals(proposalId).value)
  }

  @abimethod({ readonly: true })
  public getTransactionGroup(proposalId: uint64, payloadIndex: uint64, ensureBudgetValue: uint64): SafeTxnGroup {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return clone(this.transactionGroups(proposalId * TXG_KEY_MULT + payloadIndex).value)
  }

  @abimethod({ readonly: true })
  public getMember(groupId: uint64, account: Account, ensureBudgetValue: uint64): Member {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return clone(this.members({ groupId, account }).value)
  }

  @abimethod({ readonly: true })
  public isMember(groupId: uint64, account: Account, ensureBudgetValue: uint64): boolean {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return this.members({ groupId, account }).exists
  }

  @abimethod({ readonly: true })
  public hasApproved(proposalId: uint64, account: Account, ensureBudgetValue: uint64): boolean {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return this.approvals({ proposalId, account }).exists
  }

  /** Count of active signer groups currently holding PRIV_GROUP. Never reaches 0. */
  @abimethod({ readonly: true })
  public getActivePrivGroupCount(ensureBudgetValue: uint64): uint64 {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    return this.activePrivGroupCount.value
  }

  // -------------------------------------------------------------------------
  // Internal: proposal helpers
  // -------------------------------------------------------------------------

  private _assertMember(groupId: uint64): void {
    assert(this.groups(groupId).exists, 'group not found')
    assert(this.members({ groupId, account: Txn.sender }).exists, 'not a group member')
  }

  /**
   * Execute a proposal once its threshold has been met. Shared by the public
   * `executeProposal` entrypoint and `proposeTransactionGroup(..., execute: true)`,
   * which calls this immediately after auto-approving the proposer — it only
   * succeeds there if the group's threshold is 1 and the transactions are
   * within the group's spending limits, since every other check below still
   * applies.
   */
  private _executeProposalInternal(proposalId: uint64): void {
    assert(this.paused.value === Uint64(0), 'safe paused')
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_READY, 'not ready to execute')
    assert(Global.round <= proposal.expiryRound, 'proposal expired')

    const group = clone(this.groups(proposal.groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')
    // Defense in depth: `proposal.threshold` is a snapshot taken at proposal
    // creation. If the group's live threshold was later raised (e.g. in
    // response to a suspected compromised signer), require the higher of the
    // two rather than trusting the stale snapshot alone.
    const requiredThreshold: uint64 = proposal.threshold >= group.threshold ? proposal.threshold : group.threshold
    assert(proposal.approvalsCount >= requiredThreshold, 'threshold not met')

    if (proposal.payloadType === PT_TRANSACTION_GROUP) {
      this._executeTransactionGroup(proposalId, proposal.groupId, group, proposal.numPayloads)
    } else {
      // Admin change: re-check privilege against current group state.
      const change = clone(this.adminPayloads(proposalId).value)
      this._assertPrivilegeForChange(change.changeType, group)
      this._applyAdminChange(change)
    }

    proposal.status = STATUS_EXECUTED
    this.proposals(proposalId).value = clone(proposal)
    emit<ProposalExecuted>({ proposalId })
  }

  /** Create a proposal record, auto-approving the proposer. Returns the proposal id. */
  private _newProposal(groupId: uint64, payloadType: uint64, expiryRound: uint64): uint64 {
    assert(expiryRound > Global.round, 'expiry must be in the future')
    const group = clone(this.groups(groupId).value)
    const pid: uint64 = this.nextProposalId.value

    const proposal: Proposal = {
      groupId,
      status: STATUS_ACTIVE,
      payloadType,
      approvalsCount: Uint64(0),
      threshold: group.threshold,
      expiryRound,
      proposer: Txn.sender,
      numPayloads: Uint64(0),
    }
    this.proposals(pid).value = clone(proposal)
    this.nextProposalId.value = pid + Uint64(1)

    emit<ProposalCreated>({ proposalId: pid, groupId, payloadType, proposer: Txn.sender })

    // Auto-approve the proposer (a verified member).
    const stored = clone(this.proposals(pid).value)
    this._recordApproval(pid, stored)
    return pid
  }

  /** Record an approval for `proposal` (already loaded) and update status. */
  private _recordApproval(proposalId: uint64, proposal: Proposal): void {
    const record: Approval = { signer: Txn.sender, round: Global.round }
    this.approvals({ proposalId, account: Txn.sender }).value = clone(record)

    const updated = clone(proposal)
    updated.approvalsCount = updated.approvalsCount + Uint64(1)
    if (updated.approvalsCount >= updated.threshold) {
      updated.status = STATUS_READY
    }
    this.proposals(proposalId).value = clone(updated)

    emit<ProposalApproved>({
      proposalId,
      signer: Txn.sender,
      approvalsCount: updated.approvalsCount,
    })
  }

  // -------------------------------------------------------------------------
  // Internal: execution of typed payloads
  // -------------------------------------------------------------------------

  private _executeTransactionGroup(
    proposalId: uint64,
    groupId: uint64,
    groupIn: SignerGroup,
    numPayloads: uint64,
  ): void {
    // The staging pass below builds one inner transaction group with the raw
    // `op.ITxnCreate` opcodes, which holds an inner group open from the first
    // `begin` until the final `submit`. `ensureBudget` issues its own opup inner
    // transactions, so it cannot run while that group is open — the caller
    // (`executeProposal`/`proposeTransactionGroup`) must reserve enough budget
    // up front via `ensureBudgetValue` before either pass below runs. We still
    // make two passes:
    //   Pass 1 — decode, validate, and tally spend (no inner group open yet).
    //   Pass 2 — decode again and stage each inner transaction.
    let group = clone(groupIn)

    for (let p = Uint64(1); p <= numPayloads; p = p + Uint64(1)) {
      const key: uint64 = proposalId * TXG_KEY_MULT + p
      if (this.transactionGroups(key).exists) {
        const payload = clone(this.transactionGroups(key).value)
        for (let i = Uint64(0); i < payload.length; i = i + Uint64(1)) {
          const entry = clone(payload[i])
          if (entry.txType === TX_PAYMENT) {
            const tx = decodeArc4<PaymentTxn>(entry.data)
            this._validatePayment(tx, groupIn)
            const amount: uint64 = group.limitAssetId === Uint64(0) ? tx.amount : Uint64(0)
            group = this._accountSpend(group, amount)
          } else if (entry.txType === TX_ASSET) {
            const tx = decodeArc4<AssetTxn>(entry.data)
            this._validateAsset(tx, groupIn)
            const tracked = group.limitAssetId !== Uint64(0) && tx.xferAsset === group.limitAssetId
            const amount: uint64 = tracked ? tx.assetAmount : Uint64(0)
            group = this._accountSpend(group, amount)
          } else if (entry.txType === TX_APP) {
            const tx = decodeArc4<AppTxn>(entry.data)
            this._validateApp(tx, groupIn)
          } else if (entry.txType === TX_KEYREG) {
            decodeArc4<KeyRegTxn>(entry.data)
            assert((groupIn.allowedActions & ACT_KEYREG) !== Uint64(0), 'keyreg not allowed')
          } else if (entry.txType === TX_ACFG) {
            const tx = decodeArc4<AssetConfigTxn>(entry.data)
            this._validateAssetConfig(tx, groupIn)
          } else {
            assert(false, 'unknown tx type')
          }
        }
      }
    }

    this.groups(groupId).value = clone(group)

    let txIndex = Uint64(0)
    for (let p = Uint64(1); p <= numPayloads; p = p + Uint64(1)) {
      const key: uint64 = proposalId * TXG_KEY_MULT + p
      if (this.transactionGroups(key).exists) {
        const payload = clone(this.transactionGroups(key).value)
        for (let i = Uint64(0); i < payload.length; i = i + Uint64(1)) {
          const entry = clone(payload[i])
          const first = txIndex === Uint64(0)
          if (entry.txType === TX_PAYMENT) {
            this._stagePayment(decodeArc4<PaymentTxn>(entry.data), first)
          } else if (entry.txType === TX_ASSET) {
            this._stageAsset(decodeArc4<AssetTxn>(entry.data), first)
          } else if (entry.txType === TX_APP) {
            this._stageAppCall(decodeArc4<AppTxn>(entry.data), first)
          } else if (entry.txType === TX_KEYREG) {
            this._stageKeyReg(decodeArc4<KeyRegTxn>(entry.data), first)
          } else {
            this._stageAssetConfig(decodeArc4<AssetConfigTxn>(entry.data), first)
          }
          txIndex = txIndex + Uint64(1)
        }
      }
    }

    op.ITxnCreate.submit()
  }

  // All staging uses the low-level `op.ITxnCreate` builder (the `itxn_begin` /
  // `itxn_field` / `itxn_next` / `itxn_submit` opcodes). The reference-array
  // setters (`setApplicationArgs`, `setAccounts`, `setAssets`, `setApplications`)
  // append one element per call, so dynamic arrays are emitted with simple loops
  // — far smaller than enumerating every possible length, which the typed
  // `itxn`/`itxnCompose` APIs would require.
  private _beginOrNext(first: boolean): void {
    if (first) op.ITxnCreate.begin()
    else op.ITxnCreate.next()
  }

  private _stagePayment(tx: PaymentTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.Payment))
    op.ITxnCreate.setFee(Uint64(0))
    op.ITxnCreate.setReceiver(tx.receiver)
    op.ITxnCreate.setAmount(tx.amount)
    if (tx.hasClose !== Uint64(0)) op.ITxnCreate.setCloseRemainderTo(tx.closeRemainderTo)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
  }

  private _stageAsset(tx: AssetTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.AssetTransfer))
    op.ITxnCreate.setFee(Uint64(0))
    op.ITxnCreate.setXferAsset(tx.xferAsset)
    op.ITxnCreate.setAssetReceiver(tx.assetReceiver)
    op.ITxnCreate.setAssetAmount(tx.assetAmount)
    if (tx.hasAssetClose !== Uint64(0)) op.ITxnCreate.setAssetCloseTo(tx.assetCloseTo)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
  }

  private _stageAppCall(tx: AppTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.ApplicationCall))
    op.ITxnCreate.setFee(Uint64(0))
    op.ITxnCreate.setApplicationId(tx.appId)
    op.ITxnCreate.setOnCompletion(tx.onCompletion)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
    for (let i = Uint64(0); i < Uint64(tx.appArgs.length); i = i + Uint64(1)) {
      op.ITxnCreate.setApplicationArgs(tx.appArgs[i])
    }
    for (let i = Uint64(0); i < Uint64(tx.accounts.length); i = i + Uint64(1)) {
      op.ITxnCreate.setAccounts(tx.accounts[i])
    }
    for (let i = Uint64(0); i < Uint64(tx.foreignAssets.length); i = i + Uint64(1)) {
      op.ITxnCreate.setAssets(tx.foreignAssets[i])
    }
    for (let i = Uint64(0); i < Uint64(tx.foreignApps.length); i = i + Uint64(1)) {
      op.ITxnCreate.setApplications(tx.foreignApps[i])
    }
  }

  private _stageKeyReg(tx: KeyRegTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.KeyRegistration))
    op.ITxnCreate.setFee(Uint64(0))
    if (tx.online !== Uint64(0)) {
      // Setters accept plain `bytes`; the AVM enforces the 32/32/64-byte sizes
      // at submit time (off-chain builders supply correctly-sized keys).
      op.ITxnCreate.setVotePk(tx.voteKey)
      op.ITxnCreate.setSelectionPk(tx.selectionKey)
      op.ITxnCreate.setStateProofPk(tx.stateProofKey)
      op.ITxnCreate.setVoteFirst(tx.voteFirst)
      op.ITxnCreate.setVoteLast(tx.voteLast)
      op.ITxnCreate.setVoteKeyDilution(tx.voteKeyDilution)
    }
  }

  private _stageAssetConfig(tx: AssetConfigTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.AssetConfig))
    op.ITxnCreate.setFee(Uint64(0))
    if (tx.configAsset === Uint64(0)) {
      // Create: set the immutable asset parameters. ConfigAsset is left unset
      // (0); setting it to 0 would trigger a resource-availability check.
      op.ITxnCreate.setConfigAssetTotal(tx.total)
      op.ITxnCreate.setConfigAssetDecimals(tx.decimals)
      op.ITxnCreate.setConfigAssetDefaultFrozen(tx.defaultFrozen !== Uint64(0))
      if (tx.unitName !== '') op.ITxnCreate.setConfigAssetUnitName(Bytes(tx.unitName))
      if (tx.assetName !== '') op.ITxnCreate.setConfigAssetName(Bytes(tx.assetName))
      if (tx.url !== '') op.ITxnCreate.setConfigAssetUrl(Bytes(tx.url))
      if (tx.metadataHash.length === Uint64(32)) op.ITxnCreate.setConfigAssetMetadataHash(tx.metadataHash)
    } else {
      // Reconfigure (or destroy, when all addresses are zero): only the asset id
      // and the mutable address roles may be set; the immutable params must not.
      op.ITxnCreate.setConfigAsset(tx.configAsset)
    }
    op.ITxnCreate.setConfigAssetManager(tx.manager)
    op.ITxnCreate.setConfigAssetReserve(tx.reserve)
    op.ITxnCreate.setConfigAssetFreeze(tx.freeze)
    op.ITxnCreate.setConfigAssetClawback(tx.clawback)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
  }

  private _validatePayment(tx: PaymentTxn, group: SignerGroup): void {
    assert((group.allowedActions & ACT_PAY) !== Uint64(0), 'pay not allowed')
    assert(tx.receiver !== Global.zeroAddress, 'receiver required')
    if (tx.hasClose !== Uint64(0)) {
      assert(tx.closeRemainderTo !== Global.zeroAddress, 'close target required')
    }
  }

  private _validateAsset(tx: AssetTxn, group: SignerGroup): void {
    assert((group.allowedActions & ACT_AXFER) !== Uint64(0), 'axfer not allowed')
    assert(tx.assetReceiver !== Global.zeroAddress, 'asset receiver required')
    if (tx.hasAssetClose !== Uint64(0)) {
      assert(tx.assetCloseTo !== Global.zeroAddress, 'asset close target required')
    }
  }

  private _validateApp(tx: AppTxn, group: SignerGroup): void {
    assert((group.allowedActions & ACT_APPL) !== Uint64(0), 'appl not allowed')
    assert(tx.appId !== Uint64(0), 'appId required') // create/update need programs and are not supported here
    assert(tx.onCompletion <= Uint64(5), 'invalid onCompletion')
    assert(tx.onCompletion !== Uint64(4), 'app update not supported')
    const numArgs = Uint64(tx.appArgs.length)
    const numAccounts = Uint64(tx.accounts.length)
    const numApps = Uint64(tx.foreignApps.length)
    const numAssets = Uint64(tx.foreignAssets.length)
    assert(numArgs <= MAX_APP_ARGS, 'too many app args')
    assert(numAccounts <= MAX_APP_ACCOUNTS, 'too many accounts')
    assert(numApps <= MAX_APP_FOREIGN_APPS, 'too many foreign apps')
    assert(numAssets <= MAX_APP_FOREIGN_ASSETS, 'too many foreign assets')
    assert(numAccounts + numApps + numAssets <= MAX_APP_TOTAL_REFS, 'too many references')
    let totalArgLen = Uint64(0)
    for (let i = Uint64(0); i < numArgs; i = i + Uint64(1)) {
      totalArgLen = totalArgLen + tx.appArgs[i].length
    }
    assert(totalArgLen <= MAX_APP_TOTAL_ARG_LEN, 'app args total length exceeded')
  }

  private _validateAssetConfig(tx: AssetConfigTxn, group: SignerGroup): void {
    assert((group.allowedActions & ACT_ACFG) !== Uint64(0), 'acfg not allowed')
    assert(
      tx.metadataHash.length === Uint64(0) || tx.metadataHash.length === Uint64(32),
      'metadataHash must be 0 or 32 bytes',
    )
  }

  // Stores a payload chunk at the given slot. The clone loop for SafeTxnGroup
  // lives here so it is compiled once as a subroutine rather than being
  // duplicated at every call site.
  private _storePayloadGroup(proposalId: uint64, payloadIndex: uint64, payload: SafeTxnGroup): void {
    if (payload.length > Uint64(0)) {
      this.transactionGroups(proposalId * TXG_KEY_MULT + payloadIndex).value = clone(payload)
    }
  }

  /**
   * Advance the group's daily and monthly usage counters by `amount` (the value
   * already resolved by the caller against the group's tracked asset:
   * `limitAssetId` 0 tracks ALGO payments, any other value tracks that ASA's
   * transfers). Resets the relevant period window first when it has elapsed. An
   * `amount` of 0 (untracked transaction) or a limit of 0 means "no limit".
   */
  private _accountSpend(groupIn: SignerGroup, amount: uint64): SignerGroup {
    const group = clone(groupIn)

    if (amount === Uint64(0)) {
      return group
    }

    const now = Global.latestTimestamp

    if (group.dailyLimit !== Uint64(0)) {
      if (now - group.dailyPeriodStart >= DAY_SECONDS) {
        group.dailyUsage = Uint64(0)
        group.dailyPeriodStart = now
      }
      assert(group.dailyUsage + amount <= group.dailyLimit, 'daily limit exceeded')
      group.dailyUsage = group.dailyUsage + amount
    }

    if (group.monthlyLimit !== Uint64(0)) {
      if (now - group.monthlyPeriodStart >= MONTH_SECONDS) {
        group.monthlyUsage = Uint64(0)
        group.monthlyPeriodStart = now
      }
      assert(group.monthlyUsage + amount <= group.monthlyLimit, 'monthly limit exceeded')
      group.monthlyUsage = group.monthlyUsage + amount
    }

    return group
  }

  // -------------------------------------------------------------------------
  // Internal: admin change application
  // -------------------------------------------------------------------------

  private _assertPrivilegeForChange(changeType: uint64, group: SignerGroup): void {
    if (changeType === ADM_SET_POLICY) {
      assert((group.adminPrivileges & PRIV_POLICY) !== Uint64(0), 'policy admin required')
    } else {
      assert((group.adminPrivileges & PRIV_GROUP) !== Uint64(0), 'group admin required')
    }
  }

  /**
   * True if applying `change` would strip PRIV_GROUP (via ADM_SET_PRIVILEGES) or
   * deactivate (via ADM_SET_ACTIVE) the last remaining active PRIV_GROUP holder,
   * which would permanently lock governance out of the non-upgradable contract.
   * Reads `group` fresh so it reflects state at validation/apply time.
   */
  private _wouldRemoveLastGroupAdmin(change: AdminChange, group: SignerGroup): boolean {
    const hasGroupPriv = (group.adminPrivileges & PRIV_GROUP) !== Uint64(0)
    if (!hasGroupPriv || group.active === Uint64(0)) {
      return false
    }
    if (change.changeType === ADM_SET_PRIVILEGES) {
      const willHaveGroupPriv = (change.adminPrivileges & PRIV_GROUP) !== Uint64(0)
      return !willHaveGroupPriv && this.activePrivGroupCount.value <= Uint64(1)
    }
    if (change.changeType === ADM_SET_ACTIVE) {
      const willBeActive = change.activeFlag !== Uint64(0)
      return !willBeActive && this.activePrivGroupCount.value <= Uint64(1)
    }
    return false
  }

  private _validateAdminChange(change: AdminChange): void {
    if (change.changeType === ADM_CREATE_GROUP) {
      assert(change.threshold >= Uint64(1), 'threshold >= 1')
      assert(change.memberAddr !== Global.zeroAddress, 'first member required')
      assert(change.allowedActions <= ACT_ALL, 'invalid actions')
      assert(change.adminPrivileges <= PRIV_ALL, 'invalid privileges')
    } else if (change.changeType === ADM_ADD_MEMBER) {
      assert(this.groups(change.targetGroupId).exists, 'target group not found')
      assert(change.memberAddr !== Global.zeroAddress, 'member required')
    } else if (change.changeType === ADM_REMOVE_MEMBER) {
      assert(this.groups(change.targetGroupId).exists, 'target group not found')
    } else if (change.changeType === ADM_CHANGE_THRESHOLD) {
      assert(this.groups(change.targetGroupId).exists, 'target group not found')
      assert(change.threshold >= Uint64(1), 'threshold >= 1')
    } else if (change.changeType === ADM_SET_POLICY) {
      assert(this.groups(change.targetGroupId).exists, 'target group not found')
      assert(change.allowedActions <= ACT_ALL, 'invalid actions')
    } else if (change.changeType === ADM_SET_PRIVILEGES) {
      assert(this.groups(change.targetGroupId).exists, 'target group not found')
      assert(change.adminPrivileges <= PRIV_ALL, 'invalid privileges')
      assert(
        !this._wouldRemoveLastGroupAdmin(change, clone(this.groups(change.targetGroupId).value)),
        'must keep at least one active group admin',
      )
    } else if (change.changeType === ADM_SET_ACTIVE) {
      assert(this.groups(change.targetGroupId).exists, 'target group not found')
      assert(
        !this._wouldRemoveLastGroupAdmin(change, clone(this.groups(change.targetGroupId).value)),
        'must keep at least one active group admin',
      )
    } else {
      assert(false, 'unknown change type')
    }
  }

  private _applyAdminChange(change: AdminChange): void {
    if (change.changeType === ADM_CREATE_GROUP) {
      this._adminCreateGroup(change)
    } else if (change.changeType === ADM_ADD_MEMBER) {
      this._adminAddMember(change)
    } else if (change.changeType === ADM_REMOVE_MEMBER) {
      this._adminRemoveMember(change)
    } else if (change.changeType === ADM_CHANGE_THRESHOLD) {
      const group = clone(this.groups(change.targetGroupId).value)
      assert(change.threshold <= group.memberCount, 'threshold exceeds members')
      group.threshold = change.threshold
      this.groups(change.targetGroupId).value = clone(group)
      emit<GroupUpdated>({ groupId: change.targetGroupId })
    } else if (change.changeType === ADM_SET_POLICY) {
      const group = clone(this.groups(change.targetGroupId).value)
      const assetChanged = group.limitAssetId !== change.limitAssetId
      group.allowedActions = change.allowedActions
      group.limitAssetId = change.limitAssetId
      group.dailyLimit = change.dailyLimit
      group.monthlyLimit = change.monthlyLimit
      group.cooldownRounds = change.cooldownRounds
      if (assetChanged) {
        const now = Global.latestTimestamp
        group.dailyUsage = Uint64(0)
        group.dailyPeriodStart = now
        group.monthlyUsage = Uint64(0)
        group.monthlyPeriodStart = now
      }
      this.groups(change.targetGroupId).value = clone(group)
      emit<GroupUpdated>({ groupId: change.targetGroupId })
    } else if (change.changeType === ADM_SET_PRIVILEGES) {
      const group = clone(this.groups(change.targetGroupId).value)
      // Re-check against current state at apply time (state may have shifted
      // since proposal creation, e.g. another admin change executed first).
      assert(!this._wouldRemoveLastGroupAdmin(change, group), 'must keep at least one active group admin')
      const hadGroupPriv = (group.adminPrivileges & PRIV_GROUP) !== Uint64(0)
      const willHaveGroupPriv = (change.adminPrivileges & PRIV_GROUP) !== Uint64(0)
      if (group.active !== Uint64(0) && hadGroupPriv && !willHaveGroupPriv) {
        this.activePrivGroupCount.value = this.activePrivGroupCount.value - Uint64(1)
      } else if (group.active !== Uint64(0) && !hadGroupPriv && willHaveGroupPriv) {
        this.activePrivGroupCount.value = this.activePrivGroupCount.value + Uint64(1)
      }
      group.adminPrivileges = change.adminPrivileges
      this.groups(change.targetGroupId).value = clone(group)
      emit<GroupUpdated>({ groupId: change.targetGroupId })
    } else {
      // ADM_SET_ACTIVE
      const group = clone(this.groups(change.targetGroupId).value)
      assert(!this._wouldRemoveLastGroupAdmin(change, group), 'must keep at least one active group admin')
      const hasGroupPriv = (group.adminPrivileges & PRIV_GROUP) !== Uint64(0)
      const wasActive = group.active !== Uint64(0)
      const willBeActive = change.activeFlag !== Uint64(0)
      if (hasGroupPriv && wasActive && !willBeActive) {
        this.activePrivGroupCount.value = this.activePrivGroupCount.value - Uint64(1)
      } else if (hasGroupPriv && !wasActive && willBeActive) {
        this.activePrivGroupCount.value = this.activePrivGroupCount.value + Uint64(1)
      }
      group.active = willBeActive ? Uint64(1) : Uint64(0)
      this.groups(change.targetGroupId).value = clone(group)
      emit<GroupUpdated>({ groupId: change.targetGroupId })
    }
  }

  private _adminCreateGroup(change: AdminChange): void {
    const now = Global.latestTimestamp
    const gid: uint64 = this.nextGroupId.value
    assert(change.threshold <= Uint64(1), 'new group starts with one member')

    const grp: SignerGroup = {
      name: change.groupName,
      threshold: change.threshold,
      memberCount: Uint64(1),
      adminPrivileges: change.adminPrivileges,
      allowedActions: change.allowedActions,
      limitAssetId: change.limitAssetId,
      dailyLimit: change.dailyLimit,
      dailyUsage: Uint64(0),
      dailyPeriodStart: now,
      monthlyLimit: change.monthlyLimit,
      monthlyUsage: Uint64(0),
      monthlyPeriodStart: now,
      cooldownRounds: change.cooldownRounds,
      active: Uint64(1),
    }
    this.groups(gid).value = clone(grp)

    const m: Member = { accountType: change.memberType, label: change.memberLabel, addr: change.memberAddr }
    this.members({ groupId: gid, account: change.memberAddr }).value = clone(m)

    this.nextGroupId.value = gid + Uint64(1)
    this.groupCount.value = this.groupCount.value + Uint64(1)
    if ((change.adminPrivileges & PRIV_GROUP) !== Uint64(0)) {
      this.activePrivGroupCount.value = this.activePrivGroupCount.value + Uint64(1)
    }

    emit<GroupCreated>({ groupId: gid, name: change.groupName, threshold: change.threshold })
    emit<MemberAdded>({ groupId: gid, member: change.memberAddr, accountType: change.memberType })
  }

  private _adminAddMember(change: AdminChange): void {
    const gid = change.targetGroupId
    assert(!this.members({ groupId: gid, account: change.memberAddr }).exists, 'already a member')

    const m: Member = { accountType: change.memberType, label: change.memberLabel, addr: change.memberAddr }
    this.members({ groupId: gid, account: change.memberAddr }).value = clone(m)

    const group = clone(this.groups(gid).value)
    group.memberCount = group.memberCount + Uint64(1)
    this.groups(gid).value = clone(group)

    emit<MemberAdded>({ groupId: gid, member: change.memberAddr, accountType: change.memberType })
  }

  private _adminRemoveMember(change: AdminChange): void {
    const gid = change.targetGroupId
    assert(this.members({ groupId: gid, account: change.memberAddr }).exists, 'not a member')

    const group = clone(this.groups(gid).value)
    assert(group.memberCount - Uint64(1) >= group.threshold, 'would drop below threshold')

    this.members({ groupId: gid, account: change.memberAddr }).delete()
    group.memberCount = group.memberCount - Uint64(1)
    this.groups(gid).value = clone(group)

    emit<MemberRemoved>({ groupId: gid, member: change.memberAddr })
  }
}
