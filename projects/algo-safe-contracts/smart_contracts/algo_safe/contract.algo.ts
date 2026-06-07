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
  itxn,
  itxnCompose,
  TransactionType,
  Txn,
  uint64,
  Uint64,
} from '@algorandfoundation/algorand-typescript'
import { abimethod } from '@algorandfoundation/algorand-typescript/arc4'

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

// Maximum executable transactions in one transaction-group proposal. Algorand
// protocol transaction groups currently allow up to 16 transactions; this cap
// tracks that limit and can be raised if the protocol limit changes.
const MAX_GROUP_TXNS: uint64 = Uint64(16)

// Allowed-action bitmask (SignerGroup.allowedActions).
const ACT_PAY: uint64 = Uint64(1)
const ACT_AXFER: uint64 = Uint64(2)
const ACT_APPL: uint64 = Uint64(4)
const ACT_KEYREG: uint64 = Uint64(8)
const ACT_ALL: uint64 = Uint64(15)

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
const CONTRACT_VERSION = '58cb47a5ee27'

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
}

type PaymentPayload = {
  receiver: Account
  amount: uint64
  hasClose: uint64
  closeRemainderTo: Account
  note: string
}

type AssetPayload = {
  xferAsset: uint64
  assetReceiver: Account
  assetAmount: uint64
  hasClose: uint64
  assetCloseTo: Account
  note: string
}

// App-call payloads are NoOp calls with up to 4 application arguments.
type AppCallPayload = {
  appId: uint64
  numArgs: uint64
  arg0: bytes
  arg1: bytes
  arg2: bytes
  arg3: bytes
}

type KeyRegPayload = {
  online: uint64 // 1 = online registration, 0 = go offline
  voteKey: bytes<32>
  selectionKey: bytes<32>
  stateProofKey: bytes<64>
  voteFirst: uint64
  voteLast: uint64
  voteKeyDilution: uint64
}

type SafeTxn = {
  txType: uint64
  receiver: Account
  amount: uint64
  hasClose: uint64
  closeRemainderTo: Account
  xferAsset: uint64
  assetReceiver: Account
  assetAmount: uint64
  hasAssetClose: uint64
  assetCloseTo: Account
  appId: uint64
  numArgs: uint64
  arg0: bytes
  arg1: bytes
  arg2: bytes
  arg3: bytes
  online: uint64
  voteKey: bytes
  selectionKey: bytes
  stateProofKey: bytes
  voteFirst: uint64
  voteLast: uint64
  voteKeyDilution: uint64
  note: string
}

// An ordered, dynamically sized list of transactions. A single-action proposal
// is just a one-element list. This mirrors Algorand atomic transaction groups,
// where order matters and the group is all-or-nothing.
type TransactionGroupPayload = SafeTxn[]

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

  // Box storage.
  groups = BoxMap<uint64, SignerGroup>({ keyPrefix: 'g' })
  members = BoxMap<{ groupId: uint64; account: Account }, Member>({ keyPrefix: 'm' })
  proposals = BoxMap<uint64, Proposal>({ keyPrefix: 'p' })
  approvals = BoxMap<{ proposalId: uint64; account: Account }, Approval>({ keyPrefix: 'a' })
  transactionGroups = BoxMap<uint64, TransactionGroupPayload>({ keyPrefix: 'txg' })
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

    emit<GroupCreated>({ groupId: gid, name: groupName, threshold: Uint64(1) })
    emit<MemberAdded>({ groupId: gid, member: Txn.sender, accountType: Uint64(1) })
  }

  // -------------------------------------------------------------------------
  // Proposal creation
  // -------------------------------------------------------------------------

  /** Create a payment (ALGO) proposal. */
  public proposePayment(groupId: uint64, payload: PaymentPayload, expiryRound: uint64): uint64 {
    this._assertActionAllowed(groupId, ACT_PAY)
    assert(payload.receiver !== Global.zeroAddress, 'receiver required')
    if (payload.hasClose !== Uint64(0)) {
      assert(payload.closeRemainderTo !== Global.zeroAddress, 'close target required')
    }
    const tx = this._txnFromPayment(payload)
    const group = this._singleTxnGroup(tx)
    return this.proposeTransactionGroup(groupId, group, expiryRound)
  }

  /** Create an asset-transfer (ASA) proposal. Also used for opt-in (amount 0, receiver = safe). */
  public proposeAssetTransfer(groupId: uint64, payload: AssetPayload, expiryRound: uint64): uint64 {
    this._assertActionAllowed(groupId, ACT_AXFER)
    assert(payload.assetReceiver !== Global.zeroAddress, 'receiver required')
    if (payload.hasClose !== Uint64(0)) {
      assert(payload.assetCloseTo !== Global.zeroAddress, 'close target required')
    }
    const tx = this._txnFromAsset(payload)
    const group = this._singleTxnGroup(tx)
    return this.proposeTransactionGroup(groupId, group, expiryRound)
  }

  /** Create a NoOp application-call proposal with up to 4 application args. */
  public proposeAppCall(groupId: uint64, payload: AppCallPayload, expiryRound: uint64): uint64 {
    this._assertActionAllowed(groupId, ACT_APPL)
    assert(payload.appId !== Uint64(0), 'appId required')
    assert(payload.numArgs <= Uint64(4), 'max 4 app args')
    const tx = this._txnFromAppCall(payload)
    const group = this._singleTxnGroup(tx)
    return this.proposeTransactionGroup(groupId, group, expiryRound)
  }

  /** Create a key-registration proposal (online or offline). */
  public proposeKeyRegistration(groupId: uint64, payload: KeyRegPayload, expiryRound: uint64): uint64 {
    this._assertActionAllowed(groupId, ACT_KEYREG)
    const tx = this._txnFromKeyReg(payload)
    const group = this._singleTxnGroup(tx)
    return this.proposeTransactionGroup(groupId, group, expiryRound)
  }

  /**
   * Create an ordered transaction-group proposal. This is the canonical
   * executable proposal form: signer approvals cover the complete ordered list
   * of transactions and execution emits that list as one atomic inner group.
   */
  public proposeTransactionGroup(groupId: uint64, payload: TransactionGroupPayload, expiryRound: uint64): uint64 {
    ensureBudget(Uint64(700)) // rough estimate; each inner transaction adds to execution cost

    assert(this.paused.value === Uint64(0), 'safe paused')
    this._assertMember(groupId)
    assert(this.groups(groupId).value.active !== Uint64(0), 'group disabled')
    assert(payload.length >= Uint64(1), 'empty tx group')
    assert(payload.length <= MAX_GROUP_TXNS, 'too many txs')

    const pid = this._newProposal(groupId, PT_TRANSACTION_GROUP, expiryRound)
    this.transactionGroups(pid).value = clone(payload)
    return pid
  }

  /** Create a governed signer-group administration proposal. */
  public proposeAdminChange(groupId: uint64, change: AdminChange, expiryRound: uint64): uint64 {
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
  public approveProposal(proposalId: uint64): void {
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'not approvable')
    assert(Global.round <= proposal.expiryRound, 'proposal expired')
    assert(this.members({ groupId: proposal.groupId, account: Txn.sender }).exists, 'not a group member')
    assert(!this.approvals({ proposalId, account: Txn.sender }).exists, 'already approved')

    this._recordApproval(proposalId, proposal)
  }

  /** Execute a proposal once its threshold has been met. */
  public executeProposal(proposalId: uint64): void {
    assert(this.paused.value === Uint64(0), 'safe paused')
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_READY, 'not ready to execute')
    assert(proposal.approvalsCount >= proposal.threshold, 'threshold not met')
    assert(Global.round <= proposal.expiryRound, 'proposal expired')

    const group = clone(this.groups(proposal.groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')

    if (proposal.payloadType === PT_TRANSACTION_GROUP) {
      this._executeTransactionGroup(proposalId, proposal.groupId, group)
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

  /** Cancel a pending proposal. Allowed for the proposer or any member of the proposal's group. */
  public cancelProposal(proposalId: uint64): void {
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'not cancellable')
    const isProposer = Txn.sender === proposal.proposer
    const isMember = this.members({ groupId: proposal.groupId, account: Txn.sender }).exists
    assert(isProposer || isMember, 'not authorised to cancel')

    proposal.status = STATUS_CANCELLED
    this.proposals(proposalId).value = clone(proposal)
    emit<ProposalCancelled>({ proposalId })
  }

  // -------------------------------------------------------------------------
  // Read-only getters
  // -------------------------------------------------------------------------

  @abimethod({ readonly: true })
  public getConfig(): [string, uint64, uint64, uint64, uint64, string] {
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
  public getSignerGroup(groupId: uint64): SignerGroup {
    return clone(this.groups(groupId).value)
  }

  @abimethod({ readonly: true })
  public getProposal(proposalId: uint64): Proposal {
    return clone(this.proposals(proposalId).value)
  }

  @abimethod({ readonly: true })
  public getTransactionGroup(proposalId: uint64): TransactionGroupPayload {
    return clone(this.transactionGroups(proposalId).value)
  }

  @abimethod({ readonly: true })
  public getMember(groupId: uint64, account: Account): Member {
    return clone(this.members({ groupId, account }).value)
  }

  @abimethod({ readonly: true })
  public isMember(groupId: uint64, account: Account): boolean {
    return this.members({ groupId, account }).exists
  }

  @abimethod({ readonly: true })
  public hasApproved(proposalId: uint64, account: Account): boolean {
    return this.approvals({ proposalId, account }).exists
  }

  // -------------------------------------------------------------------------
  // Internal: proposal helpers
  // -------------------------------------------------------------------------

  private _assertMember(groupId: uint64): void {
    assert(this.groups(groupId).exists, 'group not found')
    assert(this.members({ groupId, account: Txn.sender }).exists, 'not a group member')
  }

  private _assertActionAllowed(groupId: uint64, action: uint64): void {
    assert(this.paused.value === Uint64(0), 'safe paused')
    this._assertMember(groupId)
    const group = clone(this.groups(groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')
    assert((group.allowedActions & action) !== Uint64(0), 'action not allowed for group')
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

  private _executeTransactionGroup(proposalId: uint64, groupId: uint64, groupIn: SignerGroup): void {
    // Read just the group length first (cheap header read) and raise the opcode
    // budget before fully decoding the box. Decoding and staging scale with the
    // group length, so each entry gets roughly one app-call worth of budget.
    const count: uint64 = this.transactionGroups(proposalId).value.length
    assert(count >= Uint64(1), 'empty tx group')
    assert(count <= MAX_GROUP_TXNS, 'too many txs')
    ensureBudget((count + Uint64(1)) * Uint64(700))

    const payload = clone(this.transactionGroups(proposalId).value)

    // Key registration cannot be composed into a mixed inner group; it must be
    // proposed and executed on its own.
    const firstTx = clone(payload[0])
    if (count === Uint64(1) && firstTx.txType === TX_KEYREG) {
      assert((groupIn.allowedActions & ACT_KEYREG) !== Uint64(0), 'keyreg not allowed')
      this._executeKeyRegTx(firstTx)
      return
    }

    // Single pass over the group: decode each entry once, validate it, tally the
    // ALGO spend, and stage it into the inner-transaction group.
    let group = clone(groupIn)
    for (let i: uint64 = Uint64(0); i < count; i = i + Uint64(1)) {
      const tx = clone(payload[i])
      this._validateSafeTxn(tx, groupIn)
      assert(tx.txType !== TX_KEYREG, 'keyreg must be single tx')
      group = this._accountSpend(group, tx)
      this._stageSafeTxn(tx, i === Uint64(0))
    }

    this.groups(groupId).value = clone(group)
    itxnCompose.submit()
  }

  private _stageSafeTxn(tx: SafeTxn, first: boolean): void {
    if (tx.txType === TX_PAYMENT) {
      if (tx.hasClose !== Uint64(0)) {
        if (first) {
          itxnCompose.begin({
            type: TransactionType.Payment,
            receiver: tx.receiver,
            amount: tx.amount,
            closeRemainderTo: tx.closeRemainderTo,
            note: tx.note,
            fee: Uint64(0),
          })
        } else {
          itxnCompose.next({
            type: TransactionType.Payment,
            receiver: tx.receiver,
            amount: tx.amount,
            closeRemainderTo: tx.closeRemainderTo,
            note: tx.note,
            fee: Uint64(0),
          })
        }
      } else if (first) {
        itxnCompose.begin({
          type: TransactionType.Payment,
          receiver: tx.receiver,
          amount: tx.amount,
          note: tx.note,
          fee: Uint64(0),
        })
      } else {
        itxnCompose.next({
          type: TransactionType.Payment,
          receiver: tx.receiver,
          amount: tx.amount,
          note: tx.note,
          fee: Uint64(0),
        })
      }
    } else if (tx.txType === TX_ASSET) {
      if (tx.hasAssetClose !== Uint64(0)) {
        if (first) {
          itxnCompose.begin({
            type: TransactionType.AssetTransfer,
            xferAsset: tx.xferAsset,
            assetReceiver: tx.assetReceiver,
            assetAmount: tx.assetAmount,
            assetCloseTo: tx.assetCloseTo,
            note: tx.note,
            fee: Uint64(0),
          })
        } else {
          itxnCompose.next({
            type: TransactionType.AssetTransfer,
            xferAsset: tx.xferAsset,
            assetReceiver: tx.assetReceiver,
            assetAmount: tx.assetAmount,
            assetCloseTo: tx.assetCloseTo,
            note: tx.note,
            fee: Uint64(0),
          })
        }
      } else if (first) {
        itxnCompose.begin({
          type: TransactionType.AssetTransfer,
          xferAsset: tx.xferAsset,
          assetReceiver: tx.assetReceiver,
          assetAmount: tx.assetAmount,
          note: tx.note,
          fee: Uint64(0),
        })
      } else {
        itxnCompose.next({
          type: TransactionType.AssetTransfer,
          xferAsset: tx.xferAsset,
          assetReceiver: tx.assetReceiver,
          assetAmount: tx.assetAmount,
          note: tx.note,
          fee: Uint64(0),
        })
      }
    } else if (tx.txType === TX_APP) {
      this._stageAppCall(tx, first)
    } else {
      assert(false, 'keyreg must be single tx')
    }
  }

  private _stageAppCall(tx: SafeTxn, first: boolean): void {
    if (tx.numArgs === Uint64(0)) {
      if (first) itxnCompose.begin({ type: TransactionType.ApplicationCall, appId: tx.appId, fee: Uint64(0) })
      else itxnCompose.next({ type: TransactionType.ApplicationCall, appId: tx.appId, fee: Uint64(0) })
    } else if (tx.numArgs === Uint64(1)) {
      if (first)
        itxnCompose.begin({
          type: TransactionType.ApplicationCall,
          appId: tx.appId,
          appArgs: [tx.arg0],
          fee: Uint64(0),
        })
      else
        itxnCompose.next({ type: TransactionType.ApplicationCall, appId: tx.appId, appArgs: [tx.arg0], fee: Uint64(0) })
    } else if (tx.numArgs === Uint64(2)) {
      if (first)
        itxnCompose.begin({
          type: TransactionType.ApplicationCall,
          appId: tx.appId,
          appArgs: [tx.arg0, tx.arg1],
          fee: Uint64(0),
        })
      else
        itxnCompose.next({
          type: TransactionType.ApplicationCall,
          appId: tx.appId,
          appArgs: [tx.arg0, tx.arg1],
          fee: Uint64(0),
        })
    } else if (tx.numArgs === Uint64(3)) {
      if (first)
        itxnCompose.begin({
          type: TransactionType.ApplicationCall,
          appId: tx.appId,
          appArgs: [tx.arg0, tx.arg1, tx.arg2],
          fee: Uint64(0),
        })
      else
        itxnCompose.next({
          type: TransactionType.ApplicationCall,
          appId: tx.appId,
          appArgs: [tx.arg0, tx.arg1, tx.arg2],
          fee: Uint64(0),
        })
    } else if (first) {
      itxnCompose.begin({
        type: TransactionType.ApplicationCall,
        appId: tx.appId,
        appArgs: [tx.arg0, tx.arg1, tx.arg2, tx.arg3],
        fee: Uint64(0),
      })
    } else {
      itxnCompose.next({
        type: TransactionType.ApplicationCall,
        appId: tx.appId,
        appArgs: [tx.arg0, tx.arg1, tx.arg2, tx.arg3],
        fee: Uint64(0),
      })
    }
  }

  private _executeKeyRegTx(tx: SafeTxn): void {
    if (tx.online !== Uint64(0)) {
      itxn
        .keyRegistration({
          voteKey: Bytes(tx.voteKey, { length: 32 }),
          selectionKey: Bytes(tx.selectionKey, { length: 32 }),
          stateProofKey: Bytes(tx.stateProofKey, { length: 64 }),
          voteFirst: tx.voteFirst,
          voteLast: tx.voteLast,
          voteKeyDilution: tx.voteKeyDilution,
          fee: Uint64(0),
        })
        .submit()
    } else {
      itxn.keyRegistration({ fee: Uint64(0) }).submit()
    }
  }

  private _validateSafeTxn(tx: SafeTxn, group: SignerGroup): void {
    if (tx.txType === TX_PAYMENT) {
      assert((group.allowedActions & ACT_PAY) !== Uint64(0), 'pay not allowed')
      assert(tx.receiver !== Global.zeroAddress, 'receiver required')
      if (tx.hasClose !== Uint64(0)) {
        assert(tx.closeRemainderTo !== Global.zeroAddress, 'close target required')
      }
    } else if (tx.txType === TX_ASSET) {
      assert((group.allowedActions & ACT_AXFER) !== Uint64(0), 'axfer not allowed')
      assert(tx.assetReceiver !== Global.zeroAddress, 'asset receiver required')
      if (tx.hasAssetClose !== Uint64(0)) {
        assert(tx.assetCloseTo !== Global.zeroAddress, 'asset close target required')
      }
    } else if (tx.txType === TX_APP) {
      assert((group.allowedActions & ACT_APPL) !== Uint64(0), 'appl not allowed')
      assert(tx.appId !== Uint64(0), 'appId required')
      assert(tx.numArgs <= Uint64(4), 'max 4 app args')
    } else if (tx.txType === TX_KEYREG) {
      assert((group.allowedActions & ACT_KEYREG) !== Uint64(0), 'keyreg not allowed')
    } else {
      assert(false, 'unknown tx type')
    }
  }

  private _singleTxnGroup(tx: SafeTxn): TransactionGroupPayload {
    const txns: TransactionGroupPayload = [clone(tx)]
    return txns
  }

  private _emptyTxn(): SafeTxn {
    return {
      txType: TX_PAYMENT,
      receiver: Global.zeroAddress,
      amount: Uint64(0),
      hasClose: Uint64(0),
      closeRemainderTo: Global.zeroAddress,
      xferAsset: Uint64(0),
      assetReceiver: Global.zeroAddress,
      assetAmount: Uint64(0),
      hasAssetClose: Uint64(0),
      assetCloseTo: Global.zeroAddress,
      appId: Uint64(0),
      numArgs: Uint64(0),
      arg0: Bytes(''),
      arg1: Bytes(''),
      arg2: Bytes(''),
      arg3: Bytes(''),
      online: Uint64(0),
      voteKey: Bytes(''),
      selectionKey: Bytes(''),
      stateProofKey: Bytes(''),
      voteFirst: Uint64(0),
      voteLast: Uint64(0),
      voteKeyDilution: Uint64(0),
      note: '',
    }
  }

  private _txnFromPayment(payload: PaymentPayload): SafeTxn {
    const tx = this._emptyTxn()
    tx.txType = TX_PAYMENT
    tx.receiver = payload.receiver
    tx.amount = payload.amount
    tx.hasClose = payload.hasClose
    tx.closeRemainderTo = payload.closeRemainderTo
    tx.note = payload.note
    return tx
  }

  private _txnFromAsset(payload: AssetPayload): SafeTxn {
    const tx = this._emptyTxn()
    tx.txType = TX_ASSET
    tx.xferAsset = payload.xferAsset
    tx.assetReceiver = payload.assetReceiver
    tx.assetAmount = payload.assetAmount
    tx.hasAssetClose = payload.hasClose
    tx.assetCloseTo = payload.assetCloseTo
    tx.note = payload.note
    return tx
  }

  private _txnFromAppCall(payload: AppCallPayload): SafeTxn {
    const tx = this._emptyTxn()
    tx.txType = TX_APP
    tx.appId = payload.appId
    tx.numArgs = payload.numArgs
    tx.arg0 = payload.arg0
    tx.arg1 = payload.arg1
    tx.arg2 = payload.arg2
    tx.arg3 = payload.arg3
    return tx
  }

  private _txnFromKeyReg(payload: KeyRegPayload): SafeTxn {
    const tx = this._emptyTxn()
    tx.txType = TX_KEYREG
    tx.online = payload.online
    tx.voteKey = payload.voteKey
    tx.selectionKey = payload.selectionKey
    tx.stateProofKey = payload.stateProofKey
    tx.voteFirst = payload.voteFirst
    tx.voteLast = payload.voteLast
    tx.voteKeyDilution = payload.voteKeyDilution
    return tx
  }

  /**
   * Apply daily and monthly spend limits for the group's configured tracked
   * asset and return the updated group with usage counters advanced. A
   * `limitAssetId` of 0 tracks ALGO payments; any other value tracks ASA
   * transfers for that specific asset id. Resets the relevant period window
   * first when it has elapsed. A limit of 0 means "no limit".
   */
  private _accountSpend(groupIn: SignerGroup, tx: SafeTxn): SignerGroup {
    const group = clone(groupIn)
    let amount = Uint64(0)

    if (group.limitAssetId === Uint64(0)) {
      if (tx.txType === TX_PAYMENT) {
        amount = tx.amount
      }
    } else if (tx.txType === TX_ASSET && tx.xferAsset === group.limitAssetId) {
      amount = tx.assetAmount
    }

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
    } else if (change.changeType === ADM_SET_ACTIVE) {
      assert(this.groups(change.targetGroupId).exists, 'target group not found')
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
      group.adminPrivileges = change.adminPrivileges
      this.groups(change.targetGroupId).value = clone(group)
      emit<GroupUpdated>({ groupId: change.targetGroupId })
    } else {
      // ADM_SET_ACTIVE
      const group = clone(this.groups(change.targetGroupId).value)
      group.active = change.activeFlag === Uint64(0) ? Uint64(0) : Uint64(1)
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
