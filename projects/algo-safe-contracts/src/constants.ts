export const ACT_PAY = 1n
export const ACT_AXFER = 2n
export const ACT_APPL = 4n
export const ACT_KEYREG = 8n
export const ACT_ALL = 15n

export const PRIV_GROUP = 1n  // create/modify groups, members, thresholds, privileges, active
export const PRIV_POLICY = 2n // change spending/action policy
export const PRIV_ALL = 7n    // all privileges (bit 4 reserved for future granularity)

export const TX_PAYMENT = 1n
export const TX_ASSET = 2n
export const TX_APP = 3n
export const TX_KEYREG = 4n

export const ADM_CREATE_GROUP = 1n
export const ADM_ADD_MEMBER = 2n
export const ADM_REMOVE_MEMBER = 3n
export const ADM_CHANGE_THRESHOLD = 4n
export const ADM_SET_POLICY = 5n
export const ADM_SET_PRIVILEGES = 6n
export const ADM_SET_ACTIVE = 7n

export const FAR_EXPIRY = 4_000_000_000n

export const EMPTY_BYTES = new Uint8Array()
