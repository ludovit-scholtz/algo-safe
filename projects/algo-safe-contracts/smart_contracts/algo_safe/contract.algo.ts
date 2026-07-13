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
import { abiCall, decodeArc4 } from '@algorandfoundation/algorand-typescript/arc4'
import { AlgoSafeTxnValidator } from '../algo_safe_validator/contract.algo'
import {
  ACT_ALL,
  ACT_APPL,
  ACT_AXFER,
  ACT_PAY,
  AppTxn,
  AssetConfigTxn,
  AssetTxn,
  GT_CUSTODIAN,
  GT_STANDARD,
  KeyRegTxn,
  PaymentTxn,
  PRIV_ALL,
  PRIV_GROUP,
  PRIV_POLICY,
  RekeyTxn,
  TX_ACFG,
  TX_APP,
  TX_ASSET,
  TX_KEYREG,
  TX_PAYMENT,
  TX_REKEY,
} from '../shared/types'
import { VALIDATOR_APPROVAL_SHA256_HEX } from './validator-hash.generated'

/**
 * Algo Safe — policy-driven multi-signer smart account for Algorand.
 *
 * Architecture overview
 * ─────────────────────
 * A Safe is a single AVM application whose app address holds treasury funds.
 * Governance is delegated to one or more SignerGroups, each with M-of-N
 * threshold signing. Two proposal types exist:
 *
 *   PT_TRANSACTION_GROUP — atomic inner-transaction bundles (pay, axfer, appl,
 *     keyreg, acfg, rekey). Supports multi-chunk payloads up to MAX_GROUP_TXNS
 *     total transactions spread across up to 6 payload slots.
 *
 *   PT_ADMIN — governance changes (create/modify groups, members, policy, etc.).
 *
 * Proposal lifecycle: ACTIVE → READY (threshold met) → EXECUTED or CANCELLED.
 *
 * Custodian Groups (groupType = GT_CUSTODIAN)
 * ─────────────────────────────────────────────
 * Smart-contract addresses (e.g. lending/streaming protocols) can be signers in
 * a custodian group. Custodians have no admin privileges and cannot exceed
 * their per-asset guard allocation even if the underlying protocol is
 * compromised. Asset guards are set and removed exclusively by admin groups.
 * A custodian group dissolves itself — admins cannot force dissolution.
 *
 * Program size constraint
 * ────────────────────────
 * The AVM approval-program ceiling is 8 192 bytes
 * (MaxExtraAppProgramPages=3 → 4 pages × 2 048). Changes to this file must
 * be compiled and the output measured before committing. Prefer small, shared
 * subroutines over inlined per-branch duplicates to stay within the limit.
 */

// ---------------------------------------------------------------------------
// Constants — proposal / transaction types
// ---------------------------------------------------------------------------

// Proposal status — stored in Proposal.status.
const STATUS_ACTIVE: uint64 = Uint64(1)   // open, accepting approvals
const STATUS_READY: uint64 = Uint64(2)    // threshold met, ready to execute
const STATUS_EXECUTED: uint64 = Uint64(3) // inner transactions sent / admin change applied
const STATUS_CANCELLED: uint64 = Uint64(4)

// Payload type discriminators stored in Proposal.payloadType.
const PT_TRANSACTION_GROUP: uint64 = Uint64(1) // pay/axfer/appl/keyreg/acfg/rekey bundle
const PT_ADMIN: uint64 = Uint64(5)             // governance change

// TX_*, ACT_*, PRIV_*, GT_* constants and the SafeTxn payload structs are
// shared with the AlgoSafeTxnValidator contract — see ../shared/types.ts.

// ---------------------------------------------------------------------------
// Constants — AVM / contract limits
// ---------------------------------------------------------------------------

const MAX_GROUP_TXNS: uint64 = Uint64(16)   // Algorand atomic group cap
// MAX_COOLDOWN_ROUNDS caps cooldownRounds at ~1 year of blocks. Without the cap,
// a unit-mix mistake (seconds instead of rounds) overflows the uint64 addition
// in _executeProposalInternal and permanently bricks the group.
const MAX_COOLDOWN_ROUNDS: uint64 = Uint64(10_000_000)

// App-call resource limits enforced by _validateApp (AVM consensus params).
const MAX_APP_ARGS: uint64 = Uint64(16)
const MAX_APP_TOTAL_ARG_LEN: uint64 = Uint64(2048)
const MAX_APP_ACCOUNTS: uint64 = Uint64(4)
const MAX_APP_FOREIGN_APPS: uint64 = Uint64(8)
const MAX_APP_FOREIGN_ASSETS: uint64 = Uint64(8)
const MAX_APP_TOTAL_REFS: uint64 = Uint64(8)

// ---------------------------------------------------------------------------
// Constants — admin change types (ADM_*)
// ---------------------------------------------------------------------------

// Standard admin changes (require PRIV_GROUP or PRIV_POLICY depending on type).
const ADM_CREATE_GROUP: uint64 = Uint64(1)
const ADM_ADD_MEMBER: uint64 = Uint64(2)
const ADM_REMOVE_MEMBER: uint64 = Uint64(3)
const ADM_CHANGE_THRESHOLD: uint64 = Uint64(4)
const ADM_SET_POLICY: uint64 = Uint64(5)      // requires PRIV_POLICY
const ADM_SET_PRIVILEGES: uint64 = Uint64(6)
const ADM_SET_ACTIVE: uint64 = Uint64(7)

// Rekeyed-address registry — bookkeeping of external accounts rekeyed to the safe.
// Reuses AdminChange.memberAddr as the external address and memberLabel as the label.
const ADM_ADD_REKEYED_ADDR: uint64 = Uint64(8)
const ADM_REMOVE_REKEYED_ADDR: uint64 = Uint64(9)

// 10 = ADM_SET_PAUSED — handled as the else-branch in _applyAdminChange.
// Kept in src/constants.ts for external callers but not declared here to save space.

// Custodian group lifecycle (all require PRIV_GROUP except ADM_DISSOLVE_CUSTODIAN).
const ADM_CREATE_CUSTODIAN: uint64 = Uint64(11)   // admin creates a new custodian group
const ADM_DISSOLVE_CUSTODIAN: uint64 = Uint64(12) // custodian self-dissolves (guards must all be removed first)

// Asset guard management — admin-only; governs custodian spending bounds.
// AdminChange.limitAssetId is the guard asset (0 = ALGO), .guardAmount is the ceiling.
const ADM_SET_GUARD: uint64 = Uint64(13)    // create or update guard (lockedAmount ← guardAmount)
const ADM_REMOVE_GUARD: uint64 = Uint64(14) // delete guard; decrements group.guardCount

// ---------------------------------------------------------------------------
// Constants — time
// ---------------------------------------------------------------------------

const DAY_SECONDS: uint64 = Uint64(86400)
const MONTH_SECONDS: uint64 = Uint64(2592000)
const CONTRACT_VERSION = 'BIATEC-ALGO-SAFE-v3.1.0'

// ---------------------------------------------------------------------------
// Stored record types
// ---------------------------------------------------------------------------

/**
 * SignerGroup — on-chain state for one M-of-N signer group.
 *
 * Spending limits (dailyLimit / monthlyLimit) apply only to GT_STANDARD groups
 * and only when limitAssetId matches the transferred asset. GT_CUSTODIAN groups
 * ignore limits and use asset guards instead.
 *
 * cooldownRounds: minimum rounds between successive executions. The first-ever
 * execution is exempt (lastExecutionRound === 0 is the "never executed" sentinel).
 *
 * membershipEpoch: increments on every _adminRemoveMember call. Proposals snapshot
 * this value at creation; approveProposal and executeProposal both assert it hasn't
 * changed — removing a member invalidates all pending approvals.
 */
type SignerGroup = {
  name: string
  threshold: uint64
  memberCount: uint64
  adminPrivileges: uint64  // PRIV_* bitmask; safe-wide, not scoped to this group
  allowedActions: uint64   // ACT_* bitmask
  limitAssetId: uint64     // 0 = ALGO; asset used for spending-limit accounting
  dailyLimit: uint64       // 0 = unlimited
  dailyUsage: uint64
  dailyPeriodStart: uint64 // unix timestamp of current daily window start
  monthlyLimit: uint64     // 0 = unlimited
  monthlyUsage: uint64
  monthlyPeriodStart: uint64
  cooldownRounds: uint64   // 0 = no cooldown; capped at MAX_COOLDOWN_ROUNDS
  lastExecutionRound: uint64 // 0 = never executed (sentinel; exempt from cooldown)
  membershipEpoch: uint64
  active: uint64           // 0 = disabled; group cannot approve or execute
  groupType: uint64        // GT_STANDARD=0 | GT_CUSTODIAN=1
  guardCount: uint64       // number of active AssetGuard entries for this group
}

type Member = {
  accountType: uint64  // 1=standard, 2=multisig, 3=rekeyed, 4=agent, 5=quantum
  label: string
  addr: Account
}

type RekeyedAddress = {
  label: string
  addedRound: uint64
}

/**
 * AssetGuard — per-asset spending ceiling for a custodian group.
 * assetId=0 means ALGO; stored as BoxMap key alongside custodianGroupId.
 * lockedAmount decrements atomically in pass-1 of _executeTransactionGroup
 * and reverts if the inner-txn group (pass-2) fails, keeping accounting consistent.
 */
type AssetGuard = {
  createdRound: uint64
  lockedAmount: uint64
}

/**
 * GroupSeed — argument to bootstrapGroup for the clone-friendly bootstrap path.
 * Allows a successor safe to be seeded with the same governance structure as its
 * predecessor before finalizeBootstrap() locks it for normal operation.
 */
type GroupSeed = {
  name: string
  threshold: uint64
  adminPrivileges: uint64
  allowedActions: uint64
  limitAssetId: uint64
  dailyLimit: uint64
  monthlyLimit: uint64
  cooldownRounds: uint64
  groupType: uint64
}

type MemberSeed = {
  addr: Account
  accountType: uint64
  label: string
}

/**
 * Proposal — the on-chain record for one governance action.
 *
 * payloadVersion starts at 1 and increments on every appendTransactionGroupPayload
 * write. approveProposal requires the caller to supply the live payloadVersion so
 * the approval is cryptographically bound to the exact payload reviewed — prevents
 * a proposer from swapping payload chunks after signers have started approving.
 *
 * totalTxns tracks the running transaction count across all chunks, capped at
 * MAX_GROUP_TXNS at append time.
 */
type Proposal = {
  groupId: uint64
  status: uint64           // STATUS_* constant
  payloadType: uint64      // PT_TRANSACTION_GROUP | PT_ADMIN
  approvalsCount: uint64
  threshold: uint64        // snapshot of group.threshold at creation time
  expiryRound: uint64
  proposer: Account
  numPayloads: uint64      // highest payload-slot index written (1–6)
  epochAtCreation: uint64  // snapshot of group.membershipEpoch at creation time
  payloadVersion: uint64   // bumped on each appendTransactionGroupPayload call
  totalTxns: uint64        // sum of transaction counts across all payload slots
}

// SafeTxn — the tagged envelope stored in payload boxes. Each entry is
// (txType: uint64, data: bytes) where data is the ARC4-encoded struct for that
// type — see ../shared/types.ts for the per-type structs.
type SafeTxn = {
  txType: uint64
  data: bytes
}

type SafeTxnGroup = SafeTxn[]

// Multiplier separates per-chunk storage keys: key = proposalId * TXG_KEY_MULT + chunkIndex.
// Chosen to be large enough that chunk keys for sequential proposals never collide.
const TXG_KEY_MULT: uint64 = Uint64(7)

/**
 * AdminChange — the payload stored for a PT_ADMIN proposal.
 *
 * Fields are reused across change types to avoid per-type structs (saves binary
 * space at the cost of some semantic overloading):
 *   • memberAddr / memberLabel → used for member ops and rekeyed-address registry
 *   • limitAssetId             → spending policy *and* guard asset id (assetId=0 = ALGO)
 *   • guardAmount              → lockedAmount for ADM_SET_GUARD
 *   • activeFlag               → desired active/paused state for ADM_SET_ACTIVE / ADM_SET_PAUSED
 */
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
  limitAssetId: uint64   // doubles as assetId for ADM_SET_GUARD / ADM_REMOVE_GUARD
  dailyLimit: uint64
  monthlyLimit: uint64
  cooldownRounds: uint64
  activeFlag: uint64     // desired state for ADM_SET_ACTIVE (1=active) and ADM_SET_PAUSED (1=paused)
  guardAmount: uint64    // new lockedAmount for ADM_SET_GUARD
}

type Approval = {
  signer: Account
  round: uint64
}

// ---------------------------------------------------------------------------
// Events (ARC-28)
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
type RekeyedAddressAdded = { addr: Account; label: string }
type RekeyedAddressRemoved = { addr: Account }
type SafePaused = { paused: uint64 }
type CustodianGroupCreated = { groupId: uint64; name: string; threshold: uint64 }
type CustodianGroupDissolved = { groupId: uint64 }
type AssetGuardSet = { custodianGroupId: uint64; assetId: uint64; lockedAmount: uint64 }
type AssetGuardRemoved = { custodianGroupId: uint64; assetId: uint64 }

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export class AlgoSafe extends Contract {
  // Safe-wide identity
  name = GlobalState<string>({ key: 'name' })
  creator = GlobalState<Account>({ key: 'creator' })

  // bootstrapped: 0 during clone seeding (bootstrapGroup / bootstrapRekeyedAddress
  // calls), 1 after bootstrap() or finalizeBootstrap(). _newProposal asserts 1,
  // so seeded members cannot create proposals mid-clone.
  bootstrapped = GlobalState<uint64>({ key: 'boot' })

  // Monotonically increasing IDs — never reused, so box keys never collide.
  nextGroupId = GlobalState<uint64>({ key: 'ngid' })
  nextProposalId = GlobalState<uint64>({ key: 'npid' })
  groupCount = GlobalState<uint64>({ key: 'gcnt' })

  // paused: 1 = transaction proposals cannot be proposed, appended, or executed.
  // Admin proposals (including the unpause proposal itself) are always permitted.
  paused = GlobalState<uint64>({ key: 'paused' })

  version = GlobalState<string>({ key: 'ver' })

  // activePrivGroupCount: how many active GT_STANDARD groups currently hold PRIV_GROUP.
  // Enforces the M-01 lockout guard: blocks any admin change that would leave 0.
  activePrivGroupCount = GlobalState<uint64>({ key: 'apgc' })

  // validatorApp: app ID of the AlgoSafeTxnValidator library contract used to
  // validate transaction payloads via C2C call. Verified by bytecode hash at
  // createApplication — the pinned bytecode rejects update AND delete, so a
  // hash-verified ID can never change behavior; one check at create is sound.
  validatorApp = GlobalState<uint64>({ key: 'vapp' })

  // ---------------------------------------------------------------------------
  // Storage — box maps
  // ---------------------------------------------------------------------------

  groups = BoxMap<uint64, SignerGroup>({ keyPrefix: 'g' })
  members = BoxMap<{ groupId: uint64; account: Account }, Member>({ keyPrefix: 'm' })
  proposals = BoxMap<uint64, Proposal>({ keyPrefix: 'p' })
  approvals = BoxMap<{ proposalId: uint64; account: Account }, Approval>({ keyPrefix: 'a' })

  // Multi-chunk transaction payload boxes. Key = proposalId * TXG_KEY_MULT + chunkIndex (1–6).
  transactionGroups = BoxMap<uint64, SafeTxnGroup>({ keyPrefix: 'txg' })

  // Admin-change payload box for PT_ADMIN proposals.
  adminPayloads = BoxMap<uint64, AdminChange>({ keyPrefix: 'dp' })

  // Bookkeeping of external accounts rekeyed to the safe (admin-governed registry).
  // The AVM enforces actual spendability regardless of this registry.
  rekeyedAddresses = BoxMap<Account, RekeyedAddress>({ keyPrefix: 'r' })

  // Asset guards for custodian groups. assetId=0 means ALGO.
  assetGuards = BoxMap<{ custodianGroupId: uint64; assetId: uint64 }, AssetGuard>({ keyPrefix: 'ag' })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * createApplication — called once on deployment. Initialises global state.
   * The creator is the only account that can bootstrap the safe.
   *
   * validatorAppId is pinned by BYTECODE HASH, not by trust in the deployer:
   * the approval program of the given app must hash to the compiled
   * AlgoSafeTxnValidator (see validator-hash.generated.ts). Because that
   * bytecode rejects UpdateApplication and DeleteApplication, the program
   * behind the ID is immutable, so this single check holds for the safe's
   * whole lifetime.
   */
  public createApplication(name: string, validatorAppId: uint64): void {
    const [validatorProgram, validatorExists] = op.AppParams.appApprovalProgram(validatorAppId)
    assert(validatorExists, 'validator app not found')
    assert(op.sha256(validatorProgram) === Bytes.fromHex(VALIDATOR_APPROVAL_SHA256_HEX), 'validator bytecode mismatch')
    this.validatorApp.value = validatorAppId
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
   * bootstrap — simple one-call bootstrap for a fresh safe.
   * Creates group 1 with full admin+action privileges and adds the creator as
   * the sole member. Incompatible with bootstrapGroup (the two paths cannot mix).
   */
  public bootstrap(groupName: string): void {
    assert(Txn.sender === this.creator.value, 'only creator can bootstrap')
    assert(this.bootstrapped.value === Uint64(0), 'already bootstrapped')
    assert(this.groupCount.value === Uint64(0), 'bootstrapGroup already used; cannot mix bootstrap paths')

    const seed: GroupSeed = {
      name: groupName,
      threshold: Uint64(1),
      adminPrivileges: PRIV_ALL,
      allowedActions: ACT_ALL,
      limitAssetId: Uint64(0),
      dailyLimit: Uint64(0),
      monthlyLimit: Uint64(0),
      cooldownRounds: Uint64(0),
      groupType: GT_STANDARD,
    }
    const seedMembers: MemberSeed[] = [{ addr: Txn.sender, accountType: Uint64(1), label: 'creator' }]
    this._seedGroup(seed, seedMembers)
    this.bootstrapped.value = Uint64(1)
  }

  /**
   * bootstrapGroup — clone-friendly bootstrap; may be called multiple times before
   * finalizeBootstrap(). Each call creates one group with its full member set.
   * Used by deployClonedSafe() to mirror the predecessor safe's governance structure
   * into a newly deployed contract before activating it.
   */
  public bootstrapGroup(seed: GroupSeed, members: MemberSeed[], ensureBudgetValue: uint64): uint64 {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    assert(Txn.sender === this.creator.value, 'only creator can bootstrap')
    assert(this.bootstrapped.value === Uint64(0), 'already bootstrapped')
    return this._seedGroup(seed, members)
  }

  /**
   * _seedGroup — shared group-creation path for bootstrap() and bootstrapGroup().
   * Validates the seed, writes the SignerGroup box, adds all members, and
   * maintains the group counters and the M-01 lockout counter.
   */
  private _seedGroup(seed: GroupSeed, members: MemberSeed[]): uint64 {
    const memberCount = Uint64(members.length)
    assert(memberCount >= Uint64(1), 'members required')
    assert(seed.threshold >= Uint64(1) && seed.threshold <= memberCount, 'invalid threshold')
    assert(seed.allowedActions <= ACT_ALL, 'invalid actions')
    assert(seed.adminPrivileges <= PRIV_ALL, 'invalid privileges')
    assert(seed.cooldownRounds <= MAX_COOLDOWN_ROUNDS, 'cooldown too large')
    if (seed.groupType === GT_CUSTODIAN) {
      // Custodian groups never hold admin privileges regardless of what the caller passes.
      assert(seed.adminPrivileges === Uint64(0), 'custodian groups cannot have admin privileges')
    }
    // M-01 (Fable-5): custodian actions are limited to the guard-metered bits.
    this._assertCustodianActions(seed.groupType, seed.allowedActions)

    const now = Global.latestTimestamp
    const gid: uint64 = this.nextGroupId.value

    const grp: SignerGroup = {
      name: seed.name,
      threshold: seed.threshold,
      memberCount,
      adminPrivileges: seed.adminPrivileges,
      allowedActions: seed.allowedActions,
      limitAssetId: seed.limitAssetId,
      dailyLimit: seed.dailyLimit,
      dailyUsage: Uint64(0),
      dailyPeriodStart: now,
      monthlyLimit: seed.monthlyLimit,
      monthlyUsage: Uint64(0),
      monthlyPeriodStart: now,
      cooldownRounds: seed.cooldownRounds,
      lastExecutionRound: Uint64(0),
      membershipEpoch: Uint64(0),
      active: Uint64(1),
      groupType: seed.groupType,
      guardCount: Uint64(0),
    }
    this.groups(gid).value = clone(grp)

    for (let i = Uint64(0); i < memberCount; i = i + Uint64(1)) {
      const seedMember = clone(members[i])
      assert(seedMember.addr !== Global.zeroAddress, 'member required')
      assert(!this.members({ groupId: gid, account: seedMember.addr }).exists, 'duplicate member')
      const m: Member = { accountType: seedMember.accountType, label: seedMember.label, addr: seedMember.addr }
      this.members({ groupId: gid, account: seedMember.addr }).value = clone(m)
      emit<MemberAdded>({ groupId: gid, member: seedMember.addr, accountType: seedMember.accountType })
    }

    this.nextGroupId.value = gid + Uint64(1)
    this.groupCount.value = this.groupCount.value + Uint64(1)
    if (seed.groupType !== GT_CUSTODIAN && (seed.adminPrivileges & PRIV_GROUP) !== Uint64(0)) {
      this.activePrivGroupCount.value = this.activePrivGroupCount.value + Uint64(1)
    }

    emit<GroupCreated>({ groupId: gid, name: seed.name, threshold: seed.threshold })
    return gid
  }

  /**
   * bootstrapRekeyedAddress — seed the rekeyed-address registry during cloning.
   * Only callable before finalizeBootstrap(); mirrors entries from the predecessor.
   */
  public bootstrapRekeyedAddress(addr: Account, label: string): void {
    assert(Txn.sender === this.creator.value, 'only creator can bootstrap')
    assert(this.bootstrapped.value === Uint64(0), 'already bootstrapped')
    assert(addr !== Global.zeroAddress, 'address required')
    assert(!this.rekeyedAddresses(addr).exists, 'already registered')
    const entry: RekeyedAddress = { label, addedRound: Global.round }
    this.rekeyedAddresses(addr).value = clone(entry)
    emit<RekeyedAddressAdded>({ addr, label })
  }

  /**
   * finalizeBootstrap — activates a cloned safe seeded via bootstrapGroup.
   * Requires at least one active group with PRIV_GROUP to prevent lockout.
   * After this call _newProposal succeeds and normal governance begins.
   */
  public finalizeBootstrap(): void {
    assert(Txn.sender === this.creator.value, 'only creator can bootstrap')
    assert(this.bootstrapped.value === Uint64(0), 'already bootstrapped')
    assert(this.activePrivGroupCount.value >= Uint64(1), 'need an active group admin')
    this.bootstrapped.value = Uint64(1)
  }

  // -------------------------------------------------------------------------
  // Proposal creation
  // -------------------------------------------------------------------------

  /**
   * proposeTransactionGroup — create and optionally immediately execute a transaction
   * proposal. The caller must be a member of groupId.
   *
   * execute=true skips the approval phase (valid only when threshold=1 and the
   * proposer is the sole member, i.e. the proposal is instantly READY).
   *
   * The payload is stored in chunk slot 1; further chunks can be appended via
   * appendTransactionGroupPayload before the first independent approval.
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
    const group = clone(this.groups(groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')
    const pid = this._newProposal(groupId, PT_TRANSACTION_GROUP, expiryRound)
    this._storePayloadGroup(pid, Uint64(1), payload)
    const p = clone(this.proposals(pid).value)
    p.numPayloads = Uint64(1)
    p.totalTxns = payload.length
    this.proposals(pid).value = clone(p)
    if (execute) {
      this._executeProposalInternal(pid)
    }
    return pid
  }

  /**
   * appendTransactionGroupPayload — add an additional payload chunk to an existing
   * transaction proposal. Only the original proposer may append, and only while
   * no independent approver has signed yet (approvalsCount === 1 means only the
   * auto-approval from _newProposal). Each append bumps payloadVersion so any
   * signer that has already approved sees "payload changed since review" on their
   * next call and must re-approve the new version.
   *
   * Prevents appending to expired proposals (blocks extending validity window).
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
    assert(this.paused.value === Uint64(0), 'safe paused')
    assert(payloadIndex >= Uint64(2) && payloadIndex <= Uint64(6), 'invalid slot')
    assert(payload.length >= Uint64(1), 'empty payload')
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.payloadType === PT_TRANSACTION_GROUP, 'not a tx group')
    assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'proposal not pending')
    assert(Global.round <= proposal.expiryRound, 'proposal expired')
    this._assertMember(proposal.groupId)
    assert(Txn.sender === proposal.proposer, 'only proposer can append')
    assert(proposal.approvalsCount === Uint64(1), 'cannot modify payload after independent approval')

    // Adjust totalTxns: subtract the old slot count (if replacing) then add the new.
    const key: uint64 = proposalId * TXG_KEY_MULT + payloadIndex
    let newTotal: uint64 = proposal.totalTxns
    if (this.transactionGroups(key).exists) {
      const existing = clone(this.transactionGroups(key).value)
      newTotal = newTotal - existing.length
    }
    newTotal = newTotal + payload.length
    assert(newTotal <= MAX_GROUP_TXNS, 'too many txs across chunks')

    this._storePayloadGroup(proposalId, payloadIndex, payload)

    const updated = clone(proposal)
    updated.totalTxns = newTotal
    updated.payloadVersion = updated.payloadVersion + Uint64(1)
    if (payloadIndex > proposal.numPayloads) {
      updated.numPayloads = payloadIndex
    }
    this.proposals(proposalId).value = clone(updated)
  }

  /**
   * proposeAdminChange — create a governance change proposal.
   *
   * Routing:
   *   ADM_DISSOLVE_CUSTODIAN — the proposing group must be the custodian group
   *     itself. Admins cannot force-dissolve a custodian.
   *   All other change types — the proposing group must hold the relevant admin
   *     privilege (PRIV_GROUP or PRIV_POLICY via _assertPrivilegeForChange).
   *
   * Payload-level correctness (e.g. guard existence, target group type) is
   * intentionally deferred to execution time in _applyAdminChange. This saves
   * ~700 bytes of compiled binary by not duplicating the check logic at proposal
   * time, at the cost of wasted box storage if an invalid proposal passes approval.
   *
   * The cooldown cap is asserted here (before the box is written) so that a
   * bad cooldown value cannot be stored and later cause an arithmetic overflow
   * in _executeProposalInternal even if the group approves the proposal.
   */
  public proposeAdminChange(
    groupId: uint64,
    change: AdminChange,
    expiryRound: uint64,
    ensureBudgetValue: uint64,
  ): uint64 {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    this._assertMember(groupId)
    const group = clone(this.groups(groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')

    // Validate cooldown at proposal time for both ADM_CREATE_GROUP and ADM_SET_POLICY.
    // Harmless for other change types but avoids the if-branch cost in binary size.
    assert(change.cooldownRounds <= MAX_COOLDOWN_ROUNDS, 'cooldown cap')
    if (change.changeType === ADM_DISSOLVE_CUSTODIAN) {
      assert(group.groupType === GT_CUSTODIAN, 'only custodian groups can propose self-dissolution')
      assert(change.targetGroupId === groupId, 'can only dissolve own custodian group')
    } else {
      this._assertPrivilegeForChange(change.changeType, group)
    }

    const pid = this._newProposal(groupId, PT_ADMIN, expiryRound)
    this.adminPayloads(pid).value = clone(change)
    return pid
  }

  // -------------------------------------------------------------------------
  // Approval / execution / cancellation
  // -------------------------------------------------------------------------

  /**
   * approveProposal — add the caller's approval to an open proposal.
   *
   * expectedPayloadVersion must match the proposal's live payloadVersion; this
   * binds the approval to the exact payload content the signer reviewed and
   * prevents a bait-and-switch attack where the proposer appends a different
   * chunk after other signers have already approved.
   *
   * Also asserts that the group's membershipEpoch hasn't changed since proposal
   * creation — removing a compromised member invalidates all pending approvals.
   */
  public approveProposal(proposalId: uint64, expectedPayloadVersion: uint64, ensureBudgetValue: uint64): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_ACTIVE || proposal.status === STATUS_READY, 'not approvable')
    assert(Global.round <= proposal.expiryRound, 'proposal expired')
    assert(proposal.payloadVersion === expectedPayloadVersion, 'payload changed since review')
    assert(this.members({ groupId: proposal.groupId, account: Txn.sender }).exists, 'not a group member')
    assert(!this.approvals({ proposalId, account: Txn.sender }).exists, 'already approved')
    assert(
      this.groups(proposal.groupId).value.membershipEpoch === proposal.epochAtCreation,
      'group membership changed since proposal creation',
    )
    this._recordApproval(proposalId, proposal)
  }

  /** executeProposal — execute a READY proposal (threshold met, not expired). */
  public executeProposal(proposalId: uint64, ensureBudgetValue: uint64): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    this._executeProposalInternal(proposalId)
  }

  /**
   * cancelProposal — cancel an open proposal. Either the original proposer
   * or any current group member may cancel.
   */
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
   * pruneProposal — delete terminal proposal boxes to reclaim MBR.
   * Only callable on EXECUTED or CANCELLED proposals after their expiryRound.
   * Removes the proposal box, all payload chunk boxes, and the admin-change box.
   */
  public pruneProposal(proposalId: uint64, ensureBudgetValue: uint64): void {
    if (ensureBudgetValue > Uint64(1)) {
      ensureBudget(ensureBudgetValue)
    }
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_EXECUTED || proposal.status === STATUS_CANCELLED, 'proposal not terminal')
    assert(Global.round > proposal.expiryRound, 'not yet expired')
    // M-02: proposals of a dissolved group must remain prunable. While the
    // group exists only its members may prune; once it is gone the check has
    // nothing left to protect (pruning a terminal, expired proposal only
    // reclaims MBR to the app account), so anyone may reclaim.
    if (this.groups(proposal.groupId).exists) {
      assert(this.members({ groupId: proposal.groupId, account: Txn.sender }).exists, 'not a group member')
    }

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

  // NOTE: the former read-only ABI getters (getConfig, getSignerGroup,
  // getProposal, getTransactionGroup, getMember, isMember, hasApproved,
  // getActivePrivGroupCount, isRekeyedAddress, getRekeyedAddress,
  // hasAssetGuard, getAssetGuard) were removed in v3.0.0 to reclaim ~700 bytes
  // of approval-program space. All of that data is plain box / global state —
  // read it off-chain via the typed client's `state.box.*` / `state.global.*`
  // accessors (see `src/on-chain.ts` readers in the npm package).

  // -------------------------------------------------------------------------
  // Internal — proposal machinery
  // -------------------------------------------------------------------------

  /** _assertMember — verify that Txn.sender is an active member of groupId. */
  private _assertMember(groupId: uint64): void {
    assert(this.groups(groupId).exists, 'group not found')
    assert(this.members({ groupId, account: Txn.sender }).exists, 'not a group member')
  }

  /**
   * _executeProposalInternal — shared execution path for both executeProposal
   * and the auto-execute path in proposeTransactionGroup.
   *
   * Re-reads the live threshold after snapshot to enforce any threshold changes
   * that occurred between proposal creation and execution. Uses the higher of
   * the snapshot threshold and the live threshold (defense in depth).
   *
   * Cooldown guard: skipped when lastExecutionRound === 0 (first-ever execution
   * sentinel). A nonzero cooldownRounds set at group creation would otherwise
   * block the group's very first execution until the chain's round count
   * surpassed cooldownRounds — always reproducible on a freshly reset localnet.
   */
  private _executeProposalInternal(proposalId: uint64): void {
    const proposal = clone(this.proposals(proposalId).value)
    assert(proposal.status === STATUS_READY, 'not ready to execute')
    assert(Global.round <= proposal.expiryRound, 'proposal expired')

    const group = clone(this.groups(proposal.groupId).value)
    assert(group.active !== Uint64(0), 'group disabled')
    const requiredThreshold: uint64 = proposal.threshold >= group.threshold ? proposal.threshold : group.threshold
    assert(proposal.approvalsCount >= requiredThreshold, 'threshold not met')
    assert(group.membershipEpoch === proposal.epochAtCreation, 'group membership changed since proposal creation')

    if (proposal.payloadType === PT_TRANSACTION_GROUP) {
      assert(this.paused.value === Uint64(0), 'safe paused')
      // lastExecutionRound === 0 is the "never executed" sentinel — exempt from cooldown.
      if (group.cooldownRounds !== Uint64(0) && group.lastExecutionRound !== Uint64(0)) {
        assert(Global.round >= group.lastExecutionRound + group.cooldownRounds, 'group cooldown not elapsed')
      }
      this._executeTransactionGroup(proposalId, proposal.groupId, group, proposal.numPayloads)
    } else {
      const change = clone(this.adminPayloads(proposalId).value)
      // Re-validate routing at execution time (proposal time only checks proposer's
      // privilege, not the target group's type or guard state).
      if (change.changeType === ADM_DISSOLVE_CUSTODIAN) {
        assert(group.groupType === GT_CUSTODIAN, 'proposing group must be custodian')
        assert(change.targetGroupId === proposal.groupId, 'can only dissolve own group')
      } else {
        this._assertPrivilegeForChange(change.changeType, group)
      }
      this._applyAdminChange(change)
    }

    proposal.status = STATUS_EXECUTED
    this.proposals(proposalId).value = clone(proposal)
    emit<ProposalExecuted>({ proposalId })
  }

  /**
   * _newProposal — allocate a new proposal box and auto-approve it for the proposer.
   * The auto-approval means single-signer groups can call proposeTransactionGroup
   * with execute=true without a separate approve call.
   */
  private _newProposal(groupId: uint64, payloadType: uint64, expiryRound: uint64): uint64 {
    assert(this.bootstrapped.value === Uint64(1), 'not bootstrapped')
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
      epochAtCreation: group.membershipEpoch,
      payloadVersion: Uint64(1),
      totalTxns: Uint64(0),
    }
    this.proposals(pid).value = clone(proposal)
    this.nextProposalId.value = pid + Uint64(1)

    emit<ProposalCreated>({ proposalId: pid, groupId, payloadType, proposer: Txn.sender })

    // Auto-approve on behalf of the proposer (counts as their approval).
    const stored = clone(this.proposals(pid).value)
    this._recordApproval(pid, stored)
    return pid
  }

  private _recordApproval(proposalId: uint64, proposal: Proposal): void {
    const record: Approval = { signer: Txn.sender, round: Global.round }
    this.approvals({ proposalId, account: Txn.sender }).value = clone(record)

    const updated = clone(proposal)
    updated.approvalsCount = updated.approvalsCount + Uint64(1)
    if (updated.approvalsCount >= updated.threshold) {
      updated.status = STATUS_READY
    }
    this.proposals(proposalId).value = clone(updated)

    emit<ProposalApproved>({ proposalId, signer: Txn.sender, approvalsCount: updated.approvalsCount })
  }

  // -------------------------------------------------------------------------
  // Transaction group execution — two-pass inner-txn pattern
  // -------------------------------------------------------------------------

  /**
   * _executeTransactionGroup — execute all payload chunks for a READY transaction proposal.
   *
   * Two-pass design is required because op.ITxnCreate (low-level inner-txn builder)
   * emits AVM opcodes immediately upon each setter call, and ensureBudget() cannot
   * be called while an itxn group is open. Therefore:
   *
   *   Pass 1 — validate each transaction, account for spending-limit / guard
   *             deductions, and call ensureBudget if needed (no group open).
   *   Pass 2 — stage all inner transactions via op.ITxnCreate and submit.
   *
   * The low-level op.ITxnCreate API is used instead of the typed itxnCompose API
   * because itxnCompose requires statically-sized tuples for appArgs/accounts/
   * foreignApps/foreignAssets, whereas op.ITxnCreate.setApplicationArgs() (and
   * equivalent setters) appends one element per call, enabling runtime-length loops.
   *
   * Custodian groups skip daily/monthly limit checks and call _deductFromGuard
   * for every payment and asset-transfer entry instead.
   */
  private _executeTransactionGroup(
    proposalId: uint64,
    groupId: uint64,
    groupIn: SignerGroup,
    numPayloads: uint64,
  ): void {
    let group = clone(groupIn)
    const isCustodian = groupIn.groupType === GT_CUSTODIAN

    // Pass 1 — validate and account for spending / guard deductions.
    //
    // Validation is delegated to the hash-pinned AlgoSafeTxnValidator library
    // contract via an inner app call per entry (each inner app call also ADDS
    // 700 to the pooled opcode budget, so delegation is budget-positive).
    // TX_APP is the exception: its appArgs can legitimately reach 2 048 bytes,
    // which cannot fit through the inner-call argument limit, so it is
    // validated locally — the safe must enforce those size limits anyway.
    //
    // The validator returns [assetId, amount, hasClose, sender]: assetId 0 =
    // ALGO; hasClose nonzero means the transfer sweeps the sender's entire
    // remaining balance, so the live balance is counted instead of the
    // declared amount (a close-out must not bypass spending limits/guards).
    for (let p = Uint64(1); p <= numPayloads; p = p + Uint64(1)) {
      const key: uint64 = proposalId * TXG_KEY_MULT + p
      if (this.transactionGroups(key).exists) {
        const payload = clone(this.transactionGroups(key).value)
        for (let i = Uint64(0); i < payload.length; i = i + Uint64(1)) {
          const entry = clone(payload[i])
          if (entry.txType === TX_APP) {
            this._validateApp(decodeArc4<AppTxn>(entry.data), groupIn)
          } else {
            const validated = abiCall({
              method: AlgoSafeTxnValidator.prototype.validateTxn,
              appId: this.validatorApp.value,
              args: [entry.txType, entry.data, groupIn.allowedActions, groupIn.adminPrivileges, groupIn.groupType],
              fee: 0,
            }).returnValue
            const assetId = validated[0]
            let amount = validated[1]
            const hasClose = validated[2]
            const txSender = validated[3]
            // Standard groups only track the group's limit asset; custodians
            // account every value-moving entry against their asset guard.
            const tracked = assetId === group.limitAssetId
            if (isCustodian || tracked) {
              if (hasClose !== Uint64(0)) {
                // Close-out sweeps the full balance; read it now before pass 2 empties it.
                const sender = txSender === Global.zeroAddress ? Global.currentApplicationAddress : txSender
                if (assetId === Uint64(0)) {
                  amount = op.balance(sender)
                } else {
                  const [bal] = op.AssetHolding.assetBalance(sender, assetId)
                  amount = bal
                }
              }
              if (isCustodian) {
                this._deductFromGuard(groupId, assetId, amount)
              } else {
                group = this._accountSpend(group, amount)
              }
            }
          }
        }
      }
    }

    group.lastExecutionRound = Global.round
    this.groups(groupId).value = clone(group)

    // Pass 2 — stage inner transactions. No budget calls allowed here (group is open).
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
          } else if (entry.txType === TX_ACFG) {
            this._stageAssetConfig(decodeArc4<AssetConfigTxn>(entry.data), first)
          } else if (entry.txType === TX_REKEY) {
            this._stageRekey(decodeArc4<RekeyTxn>(entry.data), first)
          }
          txIndex = txIndex + Uint64(1)
        }
      }
    }

    op.ITxnCreate.submit()
  }

  /**
   * _deductFromGuard — subtract amount from the custodian group's asset guard.
   * Called in pass 1 (before inner txns are submitted). Because pass 1 runs before
   * the inner group executes, a failed inner transaction (pass 2) will cause the
   * entire AVM transaction to revert, automatically rolling back these deductions.
   */
  private _deductFromGuard(custodianGroupId: uint64, assetId: uint64, amount: uint64): void {
    if (amount === Uint64(0)) return
    const guardKey = { custodianGroupId, assetId }
    assert(this.assetGuards(guardKey).exists, 'no guard for custodian+asset')
    const guard = clone(this.assetGuards(guardKey).value)
    assert(guard.lockedAmount >= amount, 'exceeds guard allocation')
    guard.lockedAmount = guard.lockedAmount - amount
    this.assetGuards(guardKey).value = clone(guard)
  }

  // -------------------------------------------------------------------------
  // Inner-transaction staging helpers
  // -------------------------------------------------------------------------

  /** _beginOrNext — start or extend an op.ITxnCreate group. */
  private _beginOrNext(first: boolean): void {
    if (first) op.ITxnCreate.begin()
    else op.ITxnCreate.next()
  }

  /** _setSenderIfSet — override the inner-txn sender only when explicitly specified. */
  private _setSenderIfSet(sender: Account): void {
    if (sender !== Global.zeroAddress) op.ITxnCreate.setSender(sender)
  }

  private _stagePayment(tx: PaymentTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.Payment))
    op.ITxnCreate.setFee(Uint64(0))
    this._setSenderIfSet(tx.sender)
    op.ITxnCreate.setReceiver(tx.receiver)
    op.ITxnCreate.setAmount(tx.amount)
    if (tx.hasClose !== Uint64(0)) op.ITxnCreate.setCloseRemainderTo(tx.closeRemainderTo)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
  }

  private _stageAsset(tx: AssetTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.AssetTransfer))
    op.ITxnCreate.setFee(Uint64(0))
    this._setSenderIfSet(tx.sender)
    op.ITxnCreate.setXferAsset(tx.xferAsset)
    op.ITxnCreate.setAssetReceiver(tx.assetReceiver)
    op.ITxnCreate.setAssetAmount(tx.assetAmount)
    if (tx.hasAssetClose !== Uint64(0)) op.ITxnCreate.setAssetCloseTo(tx.assetCloseTo)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
  }

  /**
   * _stageRekey — emit a 0-amount self-payment with RekeyTo set.
   * sender=zero means the safe itself; otherwise the registered rekeyed address.
   * The receiver must equal the (resolved) sender so no ALGO moves.
   */
  private _stageRekey(tx: RekeyTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.Payment))
    op.ITxnCreate.setFee(Uint64(0))
    this._setSenderIfSet(tx.sender)
    const selfAddr = tx.sender === Global.zeroAddress ? Global.currentApplicationAddress : tx.sender
    op.ITxnCreate.setReceiver(selfAddr)
    op.ITxnCreate.setAmount(Uint64(0))
    op.ITxnCreate.setRekeyTo(tx.rekeyTo)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
  }

  /**
   * _stageAppCall — stage an application-call inner transaction.
   * Uses op.ITxnCreate loop setters for appArgs/accounts/foreignApps/foreignAssets
   * because the typed itxnCompose API requires statically-sized tuples, whereas
   * these arrays are runtime-length. Each setter call appends one element.
   */
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
      op.ITxnCreate.setVotePk(tx.voteKey)
      op.ITxnCreate.setSelectionPk(tx.selectionKey)
      op.ITxnCreate.setStateProofPk(tx.stateProofKey)
      op.ITxnCreate.setVoteFirst(tx.voteFirst)
      op.ITxnCreate.setVoteLast(tx.voteLast)
      op.ITxnCreate.setVoteKeyDilution(tx.voteKeyDilution)
    }
  }

  /**
   * _stageAssetConfig — stage an asset-create or asset-reconfigure inner transaction.
   * For asset CREATE (configAsset === 0): do NOT call setConfigAsset — setting it to
   * 0 triggers "unavailable Asset 0" on the AVM. Only set it for reconfigure/destroy.
   */
  private _stageAssetConfig(tx: AssetConfigTxn, first: boolean): void {
    this._beginOrNext(first)
    op.ITxnCreate.setTypeEnum(Uint64(TransactionType.AssetConfig))
    op.ITxnCreate.setFee(Uint64(0))
    if (tx.configAsset === Uint64(0)) {
      op.ITxnCreate.setConfigAssetTotal(tx.total)
      op.ITxnCreate.setConfigAssetDecimals(tx.decimals)
      op.ITxnCreate.setConfigAssetDefaultFrozen(tx.defaultFrozen !== Uint64(0))
      if (tx.unitName !== '') op.ITxnCreate.setConfigAssetUnitName(Bytes(tx.unitName))
      if (tx.assetName !== '') op.ITxnCreate.setConfigAssetName(Bytes(tx.assetName))
      if (tx.url !== '') op.ITxnCreate.setConfigAssetUrl(Bytes(tx.url))
      if (tx.metadataHash.length === Uint64(32)) op.ITxnCreate.setConfigAssetMetadataHash(tx.metadataHash)
    } else {
      op.ITxnCreate.setConfigAsset(tx.configAsset)
    }
    op.ITxnCreate.setConfigAssetManager(tx.manager)
    op.ITxnCreate.setConfigAssetReserve(tx.reserve)
    op.ITxnCreate.setConfigAssetFreeze(tx.freeze)
    op.ITxnCreate.setConfigAssetClawback(tx.clawback)
    if (tx.note !== '') op.ITxnCreate.setNote(Bytes(tx.note))
  }

  // -------------------------------------------------------------------------
  // Transaction validation helpers
  // -------------------------------------------------------------------------

  /**
   * _validateApp — the one payload validation kept in the safe: an app call's
   * appArgs can total 2 048 bytes, which cannot fit through the inner-app-call
   * argument pipe to the validator library. All other payload types are
   * validated in AlgoSafeTxnValidator (see _executeTransactionGroup pass 1).
   */
  private _validateApp(tx: AppTxn, group: SignerGroup): void {
    assert((group.allowedActions & ACT_APPL) !== Uint64(0), 'appl not allowed')
    assert(tx.appId !== Uint64(0), 'appId required')
    // Prevent the safe from calling itself — could be used to bypass governance.
    assert(tx.appId !== Global.currentApplicationId.id, 'self-call not allowed')
    assert(tx.onCompletion <= Uint64(5), 'invalid onCompletion')
    // UpdateApplication is blocked because the safe cannot carry approval program bytes.
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

  private _storePayloadGroup(proposalId: uint64, payloadIndex: uint64, payload: SafeTxnGroup): void {
    if (payload.length > Uint64(0)) {
      this.transactionGroups(proposalId * TXG_KEY_MULT + payloadIndex).value = clone(payload)
    }
  }

  /**
   * _accountSpend — enforce daily and monthly spending limits for standard groups.
   * Resets the usage counter and window start when the current window has elapsed.
   * Only the limitAssetId asset is tracked; other assets increment amount=0 and pass through.
   */
  private _accountSpend(groupIn: SignerGroup, amount: uint64): SignerGroup {
    const group = clone(groupIn)
    if (amount === Uint64(0)) return group

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
  // Admin change helpers
  // -------------------------------------------------------------------------

  /**
   * _assertCustodianActions — M-01 (Fable-5): custodian groups may only hold
   * the guard-metered action bits (ACT_PAY | ACT_AXFER). Asset guards do not
   * bound value moved via app calls or asset-config changes, so granting a
   * custodian ACT_APPL/ACT_ACFG/ACT_KEYREG/ACT_REKEY would let a compromised
   * custodian protocol exceed its guard allocation. No-op for standard groups.
   */
  private _assertCustodianActions(groupType: uint64, allowedActions: uint64): void {
    if (groupType === GT_CUSTODIAN) {
      // ACT_PAY|ACT_AXFER are the two lowest bits, so <= is exactly "no other bit set".
      assert(allowedActions <= (ACT_PAY | ACT_AXFER), 'custodian actions limited to pay/axfer')
    }
  }

  /** _assertPrivilegeForChange — dispatch privilege requirement by change type. */
  private _assertPrivilegeForChange(changeType: uint64, group: SignerGroup): void {
    if (changeType === ADM_SET_POLICY) {
      assert((group.adminPrivileges & PRIV_POLICY) !== Uint64(0), 'policy admin required')
    } else {
      assert((group.adminPrivileges & PRIV_GROUP) !== Uint64(0), 'group admin required')
    }
  }

  /**
   * _wouldRemoveLastGroupAdmin — M-01 lockout guard predicate.
   * Returns true when applying the proposed change would leave zero active groups
   * holding PRIV_GROUP, which would make the safe un-governable. Checked at
   * execution time for both ADM_SET_PRIVILEGES and ADM_SET_ACTIVE.
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

  /**
   * _applyAdminChange — execute a validated admin change.
   * Called from _executeProposalInternal after proposal-level checks pass.
   * Each branch implements one ADM_* change type. The else-branch handles
   * ADM_SET_PAUSED (value 10) without an explicit constant to save binary space.
   */
  private _applyAdminChange(change: AdminChange): void {
    if (change.changeType === ADM_CREATE_GROUP) {
      this._createGroup(change, GT_STANDARD)
    } else if (change.changeType === ADM_ADD_MEMBER) {
      this._adminAddMember(change)
    } else if (change.changeType === ADM_REMOVE_MEMBER) {
      this._adminRemoveMember(change)
    } else if (change.changeType === ADM_ADD_REKEYED_ADDR) {
      // L-02 (Fable-5): mirrors bootstrapRekeyedAddress — a zero entry would turn
      // a migration rekey payload entry into a premature self-rekey of the safe.
      assert(change.memberAddr !== Global.zeroAddress, 'address required')
      assert(!this.rekeyedAddresses(change.memberAddr).exists, 'already registered')
      const entry: RekeyedAddress = { label: change.memberLabel, addedRound: Global.round }
      this.rekeyedAddresses(change.memberAddr).value = clone(entry)
      emit<RekeyedAddressAdded>({ addr: change.memberAddr, label: change.memberLabel })
    } else if (change.changeType === ADM_REMOVE_REKEYED_ADDR) {
      assert(this.rekeyedAddresses(change.memberAddr).exists, 'not registered')
      this.rekeyedAddresses(change.memberAddr).delete()
      emit<RekeyedAddressRemoved>({ addr: change.memberAddr })
    } else if (change.changeType === ADM_CHANGE_THRESHOLD) {
      const group = clone(this.groups(change.targetGroupId).value)
      // L-01: threshold 0 would make proposals READY on the proposer's
      // auto-approval alone while UIs display "0 approvals required".
      assert(change.threshold >= Uint64(1), 'threshold must be at least 1')
      assert(change.threshold <= group.memberCount, 'threshold exceeds members')
      group.threshold = change.threshold
      this.groups(change.targetGroupId).value = clone(group)
      emit<GroupUpdated>({ groupId: change.targetGroupId })
    } else if (change.changeType === ADM_SET_POLICY) {
      const group = clone(this.groups(change.targetGroupId).value)
      // M-01 (Fable-5): a policy change must not widen a custodian's actions
      // beyond the guard-metered pay/axfer bits.
      this._assertCustodianActions(group.groupType, change.allowedActions)
      const assetChanged = group.limitAssetId !== change.limitAssetId
      group.allowedActions = change.allowedActions
      group.limitAssetId = change.limitAssetId
      group.dailyLimit = change.dailyLimit
      group.monthlyLimit = change.monthlyLimit
      group.cooldownRounds = change.cooldownRounds
      if (assetChanged) {
        // Reset usage counters when the limit asset changes to avoid stale accounting.
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
      // Custodian groups can never hold admin privileges.
      assert(group.groupType === GT_STANDARD, 'cannot set privileges on custodian groups')
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
    } else if (change.changeType === ADM_SET_ACTIVE) {
      const group = clone(this.groups(change.targetGroupId).value)
      const wasActive = group.active !== Uint64(0)
      const willBeActive = change.activeFlag !== Uint64(0)
      if (group.groupType !== GT_CUSTODIAN) {
        assert(!this._wouldRemoveLastGroupAdmin(change, group), 'must keep at least one active group admin')
        const hasGroupPriv = (group.adminPrivileges & PRIV_GROUP) !== Uint64(0)
        if (hasGroupPriv && wasActive && !willBeActive) {
          this.activePrivGroupCount.value = this.activePrivGroupCount.value - Uint64(1)
        } else if (hasGroupPriv && !wasActive && willBeActive) {
          this.activePrivGroupCount.value = this.activePrivGroupCount.value + Uint64(1)
        }
      }
      group.active = willBeActive ? Uint64(1) : Uint64(0)
      this.groups(change.targetGroupId).value = clone(group)
      emit<GroupUpdated>({ groupId: change.targetGroupId })
    } else if (change.changeType === ADM_CREATE_CUSTODIAN) {
      this._createGroup(change, GT_CUSTODIAN)
    } else if (change.changeType === ADM_DISSOLVE_CUSTODIAN) {
      // guardCount is validated at execution time (not at proposal time).
      // The groupType assertion was also deferred — it was already checked by
      // _executeProposalInternal before reaching here.
      const gid = change.targetGroupId
      const group = clone(this.groups(gid).value)
      assert(group.guardCount === Uint64(0), 'remove all guards before dissolving')
      // M-01: dissolution must not orphan member boxes (their MBR would be
      // locked forever). Admins prune the group to one member first via
      // ADM_REMOVE_MEMBER (which deletes those boxes); the dissolve proposal
      // names the last member in memberAddr so its box is deleted here too.
      assert(group.memberCount === Uint64(1), 'remove other members before dissolving')
      assert(this.members({ groupId: gid, account: change.memberAddr }).exists, 'memberAddr must be the last member')
      this.members({ groupId: gid, account: change.memberAddr }).delete()
      this.groups(gid).delete()
      if (this.groupCount.value > Uint64(0)) {
        this.groupCount.value = this.groupCount.value - Uint64(1)
      }
      emit<CustodianGroupDissolved>({ groupId: gid })
    } else if (change.changeType === ADM_SET_GUARD) {
      const gid = change.targetGroupId
      const assetId = change.limitAssetId  // limitAssetId doubles as guard assetId
      const target = clone(this.groups(gid).value)
      assert(target.groupType === GT_CUSTODIAN, 'target must be a custodian group')
      const guardKey = { custodianGroupId: gid, assetId }
      if (this.assetGuards(guardKey).exists) {
        // Update existing guard — guardCount stays the same.
        const guard = clone(this.assetGuards(guardKey).value)
        guard.lockedAmount = change.guardAmount
        this.assetGuards(guardKey).value = clone(guard)
      } else {
        // New guard — increment guardCount so dissolution is blocked until removed.
        const guard: AssetGuard = { createdRound: Global.round, lockedAmount: change.guardAmount }
        this.assetGuards(guardKey).value = clone(guard)
        target.guardCount = target.guardCount + Uint64(1)
        this.groups(gid).value = clone(target)
      }
      emit<AssetGuardSet>({ custodianGroupId: gid, assetId, lockedAmount: change.guardAmount })
    } else if (change.changeType === ADM_REMOVE_GUARD) {
      const gid = change.targetGroupId
      const assetId = change.limitAssetId
      const target = clone(this.groups(gid).value)
      assert(target.groupType === GT_CUSTODIAN, 'target must be a custodian group')
      const guardKey = { custodianGroupId: gid, assetId }
      assert(this.assetGuards(guardKey).exists, 'guard not found')
      this.assetGuards(guardKey).delete()
      target.guardCount = target.guardCount - Uint64(1)
      this.groups(gid).value = clone(target)
      emit<AssetGuardRemoved>({ custodianGroupId: gid, assetId })
    } else {
      // ADM_SET_PAUSED (value 10) — not declared as a constant to save program space.
      // activeFlag nonzero = pause; zero = unpause.
      this.paused.value = change.activeFlag !== Uint64(0) ? Uint64(1) : Uint64(0)
      emit<SafePaused>({ paused: this.paused.value })
    }
  }

  /**
   * _createGroup — shared helper for ADM_CREATE_GROUP and ADM_CREATE_CUSTODIAN.
   * Enforces adminPrivileges=0 for custodian groups regardless of what the
   * AdminChange carries. Starts with memberCount=1 (the first member from change).
   * New groups must pass at most threshold=1 since they have exactly one member.
   */
  private _createGroup(change: AdminChange, groupType: uint64): void {
    const now = Global.latestTimestamp
    const gid: uint64 = this.nextGroupId.value
    // L-01: exactly 1 — the group starts with a single member, and threshold 0
    // (READY on auto-approval alone) is never valid.
    assert(change.threshold === Uint64(1), 'new group starts with one member')
    // L-01 (Fable-5): the zero address can never sign — same guard as _seedGroup
    // and _adminAddMember, previously missing on this third member-writing path.
    assert(change.memberAddr !== Global.zeroAddress, 'member required')
    assert(change.allowedActions <= ACT_ALL, 'invalid actions')
    assert(change.adminPrivileges <= PRIV_ALL, 'invalid privileges')
    // M-01 (Fable-5): asset guards only meter TX_PAYMENT/TX_ASSET value, so a
    // custodian holding any other action bit could move value no guard bounds.
    this._assertCustodianActions(groupType, change.allowedActions)

    const grp: SignerGroup = {
      name: change.groupName,
      threshold: change.threshold,
      memberCount: Uint64(1),
      // Force adminPrivileges to 0 for custodian groups — the caller's value is ignored.
      adminPrivileges: groupType === GT_CUSTODIAN ? Uint64(0) : change.adminPrivileges,
      allowedActions: change.allowedActions,
      limitAssetId: change.limitAssetId,
      dailyLimit: change.dailyLimit,
      dailyUsage: Uint64(0),
      dailyPeriodStart: now,
      monthlyLimit: change.monthlyLimit,
      monthlyUsage: Uint64(0),
      monthlyPeriodStart: now,
      cooldownRounds: change.cooldownRounds,
      lastExecutionRound: Uint64(0),
      membershipEpoch: Uint64(0),
      active: Uint64(1),
      groupType,
      guardCount: Uint64(0),
    }
    this.groups(gid).value = clone(grp)

    const m: Member = { accountType: change.memberType, label: change.memberLabel, addr: change.memberAddr }
    this.members({ groupId: gid, account: change.memberAddr }).value = clone(m)

    this.nextGroupId.value = gid + Uint64(1)
    this.groupCount.value = this.groupCount.value + Uint64(1)

    if (groupType === GT_CUSTODIAN) {
      emit<CustodianGroupCreated>({ groupId: gid, name: change.groupName, threshold: change.threshold })
    } else {
      if ((change.adminPrivileges & PRIV_GROUP) !== Uint64(0)) {
        this.activePrivGroupCount.value = this.activePrivGroupCount.value + Uint64(1)
      }
      emit<GroupCreated>({ groupId: gid, name: change.groupName, threshold: change.threshold })
    }
    emit<MemberAdded>({ groupId: gid, member: change.memberAddr, accountType: change.memberType })
  }

  private _adminAddMember(change: AdminChange): void {
    const gid = change.targetGroupId
    // L-02: same guard as bootstrapGroup — the zero address can never sign,
    // so admitting it only inflates memberCount and wastes box MBR.
    assert(change.memberAddr !== Global.zeroAddress, 'member required')
    assert(!this.members({ groupId: gid, account: change.memberAddr }).exists, 'already a member')

    const m: Member = { accountType: change.memberType, label: change.memberLabel, addr: change.memberAddr }
    this.members({ groupId: gid, account: change.memberAddr }).value = clone(m)

    const group = clone(this.groups(gid).value)
    group.memberCount = group.memberCount + Uint64(1)
    this.groups(gid).value = clone(group)

    emit<MemberAdded>({ groupId: gid, member: change.memberAddr, accountType: change.memberType })
  }

  /**
   * _adminRemoveMember — remove a member and increment membershipEpoch.
   * Incrementing the epoch invalidates every pending proposal's already-recorded
   * approvals (they must be re-approved from scratch), closing the window where
   * a since-removed (e.g. compromised) signer's stale approval still counted.
   */
  private _adminRemoveMember(change: AdminChange): void {
    const gid = change.targetGroupId
    assert(this.members({ groupId: gid, account: change.memberAddr }).exists, 'not a member')

    const group = clone(this.groups(gid).value)
    assert(group.memberCount - Uint64(1) >= group.threshold, 'would drop below threshold')

    this.members({ groupId: gid, account: change.memberAddr }).delete()
    group.memberCount = group.memberCount - Uint64(1)
    group.membershipEpoch = group.membershipEpoch + Uint64(1)
    this.groups(gid).value = clone(group)

    emit<MemberRemoved>({ groupId: gid, member: change.memberAddr })
  }
}
