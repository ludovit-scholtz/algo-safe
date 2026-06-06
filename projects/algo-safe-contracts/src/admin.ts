import type { AdminChange } from '../smart_contracts/artifacts/algo_safe/AlgoSafeClient'
import { ZERO_ADDR } from './safe-tx'

export function createAdminChange(partial: Partial<AdminChange>): AdminChange {
  return {
    changeType: 0n,
    targetGroupId: 0n,
    groupName: '',
    memberAddr: ZERO_ADDR,
    memberType: 1n,
    memberLabel: '',
    threshold: 0n,
    adminPrivileges: 0n,
    allowedActions: 0n,
    dailyLimit: 0n,
    monthlyLimit: 0n,
    cooldownRounds: 0n,
    activeFlag: 0n,
    ...partial,
  }
}
