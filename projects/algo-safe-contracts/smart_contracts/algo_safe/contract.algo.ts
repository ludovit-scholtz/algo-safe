import {
  Account,
  assert,
  BoxMap,
  bytes,
  clone,
  Contract,
  emit,
  Global,
  GlobalState,
  itxn,
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
const PT_PAYMENT: uint64 = Uint64(1)
const PT_ASSET: uint64 = Uint64(2)
const PT_APP: uint64 = Uint64(3)
const PT_KEYREG: uint64 = Uint64(4)
const PT_ADMIN: uint64 = Uint64(5)

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

// ---------------------------------------------------------------------------
// Stored record types (plain TS types for box storage)
// ---------------------------------------------------------------------------

type SignerGroup = {
  name: string
  threshold: uint64
  memberCount: uint64
  adminPrivileges: uint64
  allowedActions: uint64
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
  version = GlobalState<uint64>({ key: 'ver' })

  // Box storage.
  groups = BoxMap<uint64, SignerGroup>({ keyPrefix: 'g' })
  members = BoxMap<{ groupId: uint64; account: Account }, Member>({ keyPrefix: 'm' })
  proposals = BoxMap<uint64, Proposal>({ keyPrefix: 'p' })
  approvals = BoxMap<{ proposalId: uint64; account: Account }, Approval>({ keyPrefix: 'a' })
  paymentPayloads = BoxMap<uint64, PaymentPayload>({ keyPrefix: 'pp' })
  assetPayloads = BoxMap<uint64, AssetPayload>({ keyPrefix: 'ap' })
  appPayloads = BoxMap<uint64, AppCallPayload>({ keyPrefix: 'cp' })
  keyRegPayloads = BoxMap<uint64, KeyRegPayload>({ keyPrefix: 'kp' })
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
    this.version.value = Uint64(1)
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
    this._assertProposer(groupId, ACT_PAY)
    assert(payload.receiver !== Global.zeroAddress, 'receiver required')
    if (payload.hasClose !== Uint64(0)) {
      assert(payload.closeRemainderTo !== Global.zeroAddress, 'close target required')
    }
    const pid = this._newProposal(groupId, PT_PAYMENT, expiryRound)
    this.paymentPayloads(pid).value = clone(payload)
    return pid
  }

  /** Create an asset-transfer (ASA) proposal. Also used for opt-in (amount 0, receiver = safe). */
  public proposeAssetTransfer(groupId: uint64, payload: AssetPayload, expiryRound: uint64): uint64 {
    this._assertProposer(groupId, ACT_AXFER)
    assert(payload.assetReceiver !== Global.zeroAddress, 'receiver required')
    if (payload.hasClose !== Uint64(0)) {
      assert(payload.assetCloseTo !== Global.zeroAddress, 'close target required')
    }
    const pid = this._newProposal(groupId, PT_ASSET, expiryRound)
    this.assetPayloads(pid).value = clone(payload)
    return pid
  }

  /** Create a NoOp application-call proposal with up to 4 application args. */
  public proposeAppCall(groupId: uint64, payload: AppCallPayload, expiryRound: uint64): uint64 {
    this._assertProposer(groupId, ACT_APPL)
    assert(payload.appId !== Uint64(0), 'appId required')
    assert(payload.numArgs <= Uint64(4), 'max 4 app args')
    const pid = this._newProposal(groupId, PT_APP, expiryRound)
    this.appPayloads(pid).value = clone(payload)
    return pid
  }

  /** Create a key-registration proposal (online or offline). */
  public proposeKeyRegistration(groupId: uint64, payload: KeyRegPayload, expiryRound: uint64): uint64 {
    this._assertProposer(groupId, ACT_KEYREG)
    const pid = this._newProposal(groupId, PT_KEYREG, expiryRound)
    this.keyRegPayloads(pid).value = clone(payload)
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

    if (proposal.payloadType === PT_PAYMENT) {
      this._executePayment(proposalId, proposal.groupId, group)
    } else if (proposal.payloadType === PT_ASSET) {
      assert((group.allowedActions & ACT_AXFER) !== Uint64(0), 'axfer not allowed')
      this._executeAsset(proposalId)
    } else if (proposal.payloadType === PT_APP) {
      assert((group.allowedActions & ACT_APPL) !== Uint64(0), 'appl not allowed')
      this._executeAppCall(proposalId)
    } else if (proposal.payloadType === PT_KEYREG) {
      assert((group.allowedActions & ACT_KEYREG) !== Uint64(0), 'keyreg not allowed')
      this._executeKeyReg(proposalId)
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
  public getConfig(): [string, uint64, uint64, uint64, uint64, uint64] {
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

  /** Assert sender is a member of an active group that permits `action`. */
  private _assertProposer(groupId: uint64, action: uint64): void {
    assert(this.paused.value === Uint64(0), 'safe paused')
    this._assertMember(groupId)
    const group = clone(this.groups(groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')
    assert((group.allowedActions & action) !== Uint64(0), 'action not allowed for group')
  }

  private _assertMember(groupId: uint64): void {
    assert(this.groups(groupId).exists, 'group not found')
    assert(this.members({ groupId, account: Txn.sender }).exists, 'not a group member')
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

  private _executePayment(proposalId: uint64, groupId: uint64, groupIn: SignerGroup): void {
    assert((groupIn.allowedActions & ACT_PAY) !== Uint64(0), 'pay not allowed')
    const payload = clone(this.paymentPayloads(proposalId).value)

    // Enforce and account ALGO spending limits on the approving group.
    const group = this._accountSpend(groupIn, payload.amount)
    this.groups(groupId).value = clone(group)

    if (payload.hasClose !== Uint64(0)) {
      itxn
        .payment({
          receiver: payload.receiver,
          amount: payload.amount,
          closeRemainderTo: payload.closeRemainderTo,
          note: payload.note,
          fee: Uint64(0),
        })
        .submit()
    } else {
      itxn
        .payment({
          receiver: payload.receiver,
          amount: payload.amount,
          note: payload.note,
          fee: Uint64(0),
        })
        .submit()
    }
  }

  private _executeAsset(proposalId: uint64): void {
    const payload = clone(this.assetPayloads(proposalId).value)
    if (payload.hasClose !== Uint64(0)) {
      itxn
        .assetTransfer({
          xferAsset: payload.xferAsset,
          assetReceiver: payload.assetReceiver,
          assetAmount: payload.assetAmount,
          assetCloseTo: payload.assetCloseTo,
          note: payload.note,
          fee: Uint64(0),
        })
        .submit()
    } else {
      itxn
        .assetTransfer({
          xferAsset: payload.xferAsset,
          assetReceiver: payload.assetReceiver,
          assetAmount: payload.assetAmount,
          note: payload.note,
          fee: Uint64(0),
        })
        .submit()
    }
  }

  private _executeAppCall(proposalId: uint64): void {
    const p = clone(this.appPayloads(proposalId).value)
    if (p.numArgs === Uint64(0)) {
      itxn.applicationCall({ appId: p.appId, fee: Uint64(0) }).submit()
    } else if (p.numArgs === Uint64(1)) {
      itxn.applicationCall({ appId: p.appId, appArgs: [p.arg0], fee: Uint64(0) }).submit()
    } else if (p.numArgs === Uint64(2)) {
      itxn.applicationCall({ appId: p.appId, appArgs: [p.arg0, p.arg1], fee: Uint64(0) }).submit()
    } else if (p.numArgs === Uint64(3)) {
      itxn.applicationCall({ appId: p.appId, appArgs: [p.arg0, p.arg1, p.arg2], fee: Uint64(0) }).submit()
    } else {
      itxn.applicationCall({ appId: p.appId, appArgs: [p.arg0, p.arg1, p.arg2, p.arg3], fee: Uint64(0) }).submit()
    }
  }

  private _executeKeyReg(proposalId: uint64): void {
    const p = clone(this.keyRegPayloads(proposalId).value)
    if (p.online !== Uint64(0)) {
      itxn
        .keyRegistration({
          voteKey: p.voteKey,
          selectionKey: p.selectionKey,
          stateProofKey: p.stateProofKey,
          voteFirst: p.voteFirst,
          voteLast: p.voteLast,
          voteKeyDilution: p.voteKeyDilution,
          fee: Uint64(0),
        })
        .submit()
    } else {
      // Empty registration goes offline.
      itxn.keyRegistration({ fee: Uint64(0) }).submit()
    }
  }

  /**
   * Apply daily and monthly spend limits for an ALGO payment and return the
   * updated group with usage counters advanced. Resets the relevant period
   * window first when it has elapsed. A limit of 0 means "no limit".
   */
  private _accountSpend(groupIn: SignerGroup, amount: uint64): SignerGroup {
    const group = clone(groupIn)
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
      group.allowedActions = change.allowedActions
      group.dailyLimit = change.dailyLimit
      group.monthlyLimit = change.monthlyLimit
      group.cooldownRounds = change.cooldownRounds
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
