import { Account, assert, bytes, Contract, err, Global, uint64, Uint64 } from '@algorandfoundation/algorand-typescript'
import { abimethod, decodeArc4 } from '@algorandfoundation/algorand-typescript/arc4'
import {
  ACT_ACFG,
  ACT_AXFER,
  ACT_KEYREG,
  ACT_PAY,
  ACT_REKEY,
  AssetConfigTxn,
  AssetTxn,
  GT_CUSTODIAN,
  KeyRegTxn,
  PaymentTxn,
  PRIV_GROUP,
  RekeyTxn,
  TX_ACFG,
  TX_ASSET,
  TX_KEYREG,
  TX_PAYMENT,
  TX_REKEY,
} from '../shared/types'

/**
 * AlgoSafeTxnValidator — stateless, immutable payload-validation library for AlgoSafe.
 *
 * The AlgoSafe contract calls `validateTxn` via an inner application call for
 * every payment / asset-transfer / keyreg / asset-config / rekey entry in a
 * transaction-group proposal before staging the inner transactions. Moving this
 * pure validation logic out of the safe frees approval-program bytes there (the
 * safe sits against the AVM's 8 192-byte ceiling) and concentrates the
 * validation rules in one small contract that can be audited once and reused by
 * every safe on the network.
 *
 * Immutability: this contract declares no update or delete handlers, so the
 * ARC-4 router rejects UpdateApplication and DeleteApplication permanently.
 * The safe pins this contract by *bytecode hash* (sha256 of the compiled
 * approval program) at createApplication time — any app ID whose bytecode
 * matches the pinned hash is this exact program forever, which is why the safe
 * only needs to verify the hash once.
 *
 * Statelessness: no global/local/box state; app calls are the only surface.
 * The app account never needs funding.
 *
 * TX_APP entries are intentionally NOT handled here: an app-call payload can
 * legitimately carry up to 2 048 bytes of appArgs, which cannot fit through the
 * inner-app-call argument limit (2 048 bytes total including selector). The
 * safe validates TX_APP locally — it must enforce those same size limits anyway.
 */
export class AlgoSafeTxnValidator extends Contract {
  /**
   * validateTxn — decode and validate one SafeTxn envelope entry.
   *
   * @param txType TX_* tag of the entry (TX_APP is rejected — handled in the safe)
   * @param data ARC4-encoded payload struct for that type
   * @param allowedActions the executing group's ACT_* bitmask
   * @param adminPrivileges the executing group's PRIV_* bitmask
   * @param groupType the executing group's GT_* discriminator
   * @returns [assetId, amount, hasClose, sender] — the spending-accounting
   *   summary for the safe: assetId 0 = ALGO; amount is the declared amount
   *   (0 for non-value-moving types); hasClose nonzero means the safe must
   *   read the live balance (close-out sweeps everything); sender zero address
   *   means the safe's own app account.
   */
  @abimethod({ readonly: true })
  public validateTxn(
    txType: uint64,
    data: bytes,
    allowedActions: uint64,
    adminPrivileges: uint64,
    groupType: uint64,
  ): [uint64, uint64, uint64, Account] {
    if (txType === TX_PAYMENT) {
      const tx = decodeArc4<PaymentTxn>(data)
      assert((allowedActions & ACT_PAY) !== Uint64(0), 'pay not allowed')
      assert(tx.receiver !== Global.zeroAddress, 'receiver required')
      if (tx.hasClose !== Uint64(0)) {
        assert(tx.closeRemainderTo !== Global.zeroAddress, 'close target required')
      }
      return [Uint64(0), tx.amount, tx.hasClose, tx.sender]
    }
    if (txType === TX_ASSET) {
      const tx = decodeArc4<AssetTxn>(data)
      assert((allowedActions & ACT_AXFER) !== Uint64(0), 'axfer not allowed')
      assert(tx.xferAsset !== Uint64(0), 'asset id required')
      assert(tx.assetReceiver !== Global.zeroAddress, 'asset receiver required')
      if (tx.hasAssetClose !== Uint64(0)) {
        assert(tx.assetCloseTo !== Global.zeroAddress, 'asset close target required')
      }
      return [tx.xferAsset, tx.assetAmount, tx.hasAssetClose, tx.sender]
    }
    if (txType === TX_KEYREG) {
      decodeArc4<KeyRegTxn>(data)
      assert((allowedActions & ACT_KEYREG) !== Uint64(0), 'keyreg not allowed')
      return [Uint64(0), Uint64(0), Uint64(0), Global.zeroAddress]
    }
    if (txType === TX_ACFG) {
      const tx = decodeArc4<AssetConfigTxn>(data)
      assert((allowedActions & ACT_ACFG) !== Uint64(0), 'acfg not allowed')
      assert(
        tx.metadataHash.length === Uint64(0) || tx.metadataHash.length === Uint64(32),
        'metadataHash must be 0 or 32 bytes',
      )
      return [Uint64(0), Uint64(0), Uint64(0), Global.zeroAddress]
    }
    if (txType === TX_REKEY) {
      const tx = decodeArc4<RekeyTxn>(data)
      // Rekey is the most privileged operation: it transfers spending authority
      // over a rekeyed account, so it requires an admin-grade group and is
      // blocked for custodian groups (their protocol contract may be compromised).
      assert((allowedActions & ACT_REKEY) !== Uint64(0), 'rekey not allowed')
      assert((adminPrivileges & PRIV_GROUP) !== Uint64(0), 'rekey requires group admin privilege')
      assert(groupType !== GT_CUSTODIAN, 'custodian groups cannot rekey')
      assert(tx.rekeyTo !== Global.zeroAddress, 'rekey target required')
      return [Uint64(0), Uint64(0), Uint64(0), Global.zeroAddress]
    }
    err('unknown tx type')
  }
}
