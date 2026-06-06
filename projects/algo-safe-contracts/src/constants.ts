export const ACT_PAY = 1n
export const ACT_AXFER = 2n
export const ACT_APPL = 4n
export const ACT_KEYREG = 8n
export const ACT_ALL = 15n

export const PRIV_GROUP = 1n
export const PRIV_MEMBER = 2n
export const PRIV_THRESHOLD = 4n
export const PRIV_ALL = 7n

export const TX_PAYMENT = 1n
export const TX_ASSET = 2n
export const TX_APP = 3n
export const TX_KEYREG = 4n

export const ADM_CREATE_GROUP = 1n
export const ADM_ADD_MEMBER = 2n
export const ADM_REMOVE_MEMBER = 3n
export const ADM_CHANGE_THRESHOLD = 4n

export const FAR_EXPIRY = 4_000_000_000n

export const EMPTY_BYTES = new Uint8Array()