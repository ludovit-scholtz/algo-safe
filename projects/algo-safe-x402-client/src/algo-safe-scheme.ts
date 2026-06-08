import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils';
import { microAlgo } from '@algorandfoundation/algokit-utils/amount';
import {
  decodeTransaction as decodeAlgokitTransaction,
  encodeTransactionRaw,
  groupTransactions,
  Transaction as AlgokitTransaction,
} from '@algorandfoundation/algokit-utils/transact';
import algosdk from 'algosdk';
import { getAlgoSafeContractVersion, getClient, TX_ASSET } from 'algo-safe';
import type { PaymentPayloadResult, PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';
import type { ClientAvmConfig, ClientAvmSigner, ExactAvmPayloadV2 } from '@x402/avm';
import { getAlgokitSigner, isTestnetNetwork } from '@x402/avm';

const DEFAULT_SAFE_APP_ID = 764044668n;
const DEFAULT_SAFE_GROUP_ID = 2n;
const DEFAULT_VALIDITY_WINDOW = 200n;
const ZERO_ADDRESS = algosdk.encodeAddress(new Uint8Array(32));
const MIN_APP_CALL_FEE = microAlgo(200_000);
const EXECUTION_CALL_MAX_FEE = algo(0.2);

type SafePaymentConfig = {
  appId: bigint;
  groupId: bigint;
  proposalId?: bigint;
};

type AlgoSafeClientInstance = InstanceType<ReturnType<typeof getClient>>;

export class AlgoSafeExactAvmScheme implements SchemeNetworkClient {
  readonly scheme = 'exact';

  constructor(
    private readonly signer: ClientAvmSigner,
    private readonly config?: ClientAvmConfig,
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements,
  ): Promise<PaymentPayloadResult> {
    const { extra, network } = paymentRequirements;
    const safeConfig = this.getSafeConfig(extra);
    const algorandClient = this.getAlgorandClient(network);
    const safeClient = await this.getSafeClient(algorandClient, safeConfig.appId);
    const transactions: AlgokitTransaction[] = [];

    const proposalId = safeConfig.proposalId ?? (await this.getNextProposalId(safeClient));

    if (safeConfig.proposalId === undefined) {
      const proposalCall = await this.createAssetTransferProposal(
        safeClient,
        safeConfig.appId,
        safeConfig.groupId,
        proposalId,
        paymentRequirements,
        x402Version,
      );
      transactions.push(...proposalCall.transactions.map(unwrapTransaction));
    }

    const payloadType =
      safeConfig.proposalId === undefined
        ? TX_ASSET
        : (await safeClient.getProposal({ args: [proposalId] })).payloadType;
    const executeBoxReferences = getExecuteBoxReferences(
      safeConfig.appId,
      proposalId,
      safeConfig.groupId,
      payloadType,
    );

    const executeCall = await safeClient.createTransaction.executeProposal({
      args: { proposalId },
      staticFee: MIN_APP_CALL_FEE,
      maxFee: EXECUTION_CALL_MAX_FEE,
      accountReferences: [paymentRequirements.payTo],
      assetReferences: [this.getAssetId(paymentRequirements.asset)],
      populateAppCallResources: true,
      coverAppCallInnerTransactionFees: true,
      boxReferences: executeBoxReferences,
    } as never);
    transactions.push(...executeCall.transactions.map(unwrapTransaction));

    if (transactions.length === 0) {
      throw new Error('Algo Safe payment flow did not produce any application call transactions.');
    }

    const executeIndex = transactions.length - 1;
    const groupedTransactions = groupTransactions(transactions);
    const paymentIndex = executeIndex;
    const encodedTransactions = groupedTransactions.map((txn) => encodeTransactionRaw(txn));
    const signerIndexes = groupedTransactions
      .map((txn, index) => (txn.sender.toString() === this.signer.address ? index : -1))
      .filter((index) => index >= 0);
    const signedTransactions = await this.signer.signTransactions(encodedTransactions, signerIndexes);

    const paymentGroup = encodedTransactions.map((txnBytes, index) => {
      const signedTxn = signedTransactions[index];
      return Buffer.from(signedTxn ?? txnBytes).toString('base64');
    });

    return {
      x402Version,
      payload: {
        paymentGroup,
        paymentIndex,
      } satisfies ExactAvmPayloadV2,
    };
  }

  private getAlgorandClient(network: string): AlgorandClient {
    if (this.config?.algorandClient) {
      return this.config.algorandClient;
    }

    if (this.config?.algodUrl) {
      return AlgorandClient.fromConfig({
        algodConfig: {
          server: this.config.algodUrl,
          token: this.config.algodToken ?? '',
        },
      });
    }

    return isTestnetNetwork(network) ? AlgorandClient.testNet() : AlgorandClient.mainNet();
  }

  private async getSafeClient(algorandClient: AlgorandClient, appId: bigint): Promise<AlgoSafeClientInstance> {
    const algokitSigner = getAlgokitSigner(this.signer);
    if (!algokitSigner) {
      throw new Error('The Algo Safe x402 client requires an AlgoKit-backed Algorand signer.');
    }

    algorandClient.setSigner(this.signer.address, algokitSigner.signer as unknown as never);

    const clientVersion = await getAlgoSafeContractVersion(algorandClient.client.algod as never, appId);

    return algorandClient.client.getTypedAppClientById(getClient(clientVersion ?? 'latest') as never, {
      appId,
      defaultSender: this.signer.address,
    }) as AlgoSafeClientInstance;
  }

  private getSafeConfig(extra: PaymentRequirements['extra']): SafePaymentConfig {
    return {
      appId: this.toBigInt(extra?.algoSafeAppId ?? extra?.safeAppId ?? DEFAULT_SAFE_APP_ID, 'algoSafeAppId'),
      groupId: this.toBigInt(extra?.algoSafeGroupId ?? extra?.safeGroupId ?? DEFAULT_SAFE_GROUP_ID, 'algoSafeGroupId'),
      proposalId:
        extra?.algoSafeProposalId === undefined && extra?.safeProposalId === undefined
          ? undefined
          : this.toBigInt(extra?.algoSafeProposalId ?? extra?.safeProposalId ?? 0n, 'algoSafeProposalId'),
    };
  }

  private toBigInt(value: unknown, fieldName: string): bigint {
    if (typeof value === 'bigint') {
      return value;
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      return BigInt(value);
    }

    if (typeof value === 'string' && value.trim()) {
      return BigInt(value.trim());
    }

    throw new Error(`${fieldName} must be a bigint-compatible value.`);
  }

  private getAssetId(asset: string): bigint {
    if (/^\d+$/.test(asset)) {
      return BigInt(asset);
    }

    throw new Error(`Expected a numeric Algorand asset id, received "${asset}".`);
  }

  private async getNextProposalId(safeClient: AlgoSafeClientInstance): Promise<bigint> {
    const result = await safeClient.getConfig({ args: [] });
    const nextProposalId = result?.[3];

    if (typeof nextProposalId !== 'bigint') {
      throw new Error('Algo Safe config did not return a bigint nextProposalId.');
    }

    return nextProposalId;
  }

  private async createAssetTransferProposal(
    safeClient: AlgoSafeClientInstance,
    appId: bigint,
    groupId: bigint,
    proposalId: bigint,
    paymentRequirements: PaymentRequirements,
    x402Version: number,
  ) {
    const suggestedParams = await safeClient.algorand.getSuggestedParams();
    const firstValid = BigInt(
      (suggestedParams as { firstValid?: bigint | number; firstValidRound?: bigint | number }).firstValid ??
      (suggestedParams as { firstValid?: bigint | number; firstValidRound?: bigint | number }).firstValidRound ??
      0,
    );
    const expiryRound = firstValid + DEFAULT_VALIDITY_WINDOW;
    const note = `x402-safe-payment-v${x402Version}-${Date.now()}`;
    return safeClient.createTransaction.proposeAssetTransfer({
      args: {
        groupId,
        payload: {
          xferAsset: this.getAssetId(paymentRequirements.asset),
          assetReceiver: paymentRequirements.payTo,
          assetAmount: BigInt(paymentRequirements.amount),
          hasClose: 0n,
          assetCloseTo: ZERO_ADDRESS,
          note,
        },
        expiryRound,
      },
      staticFee: MIN_APP_CALL_FEE as never,
      sender: this.signer.address,
      boxReferences: getProposalBoxReferences(appId, groupId, proposalId, this.signer.address),
    });
  }
}

function encodeUint64(value: bigint) {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setBigUint64(0, value);
  return bytes;
}

function concatBytes(...parts: Uint8Array[]) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function createBoxReference(appId: bigint, prefix: string, id: bigint) {
  return {
    appId,
    name: concatBytes(new TextEncoder().encode(prefix), encodeUint64(id)),
  };
}

function createAccountScopedBoxReference(appId: bigint, prefix: string, id: bigint, account: string) {
  return {
    appId,
    name: concatBytes(
      new TextEncoder().encode(prefix),
      encodeUint64(id),
      algosdk.decodeAddress(account).publicKey,
    ),
  };
}

function getExecuteBoxReferences(appId: bigint, proposalId: bigint, groupId: bigint, payloadType: bigint) {
  const payloadPrefix = payloadType === 1n ? 'txg' : 'dp';

  return [
    createBoxReference(appId, 'p', proposalId),
    createBoxReference(appId, 'g', groupId),
    createBoxReference(appId, payloadPrefix, proposalId),
  ];
}

function getProposalBoxReferences(appId: bigint, groupId: bigint, proposalId: bigint, account: string) {
  return [
    createBoxReference(appId, 'g', groupId),
    createAccountScopedBoxReference(appId, 'm', groupId, account),
    createBoxReference(appId, 'p', proposalId),
    createAccountScopedBoxReference(appId, 'a', proposalId, account),
    createBoxReference(appId, 'txg', proposalId),
  ];
}

function unwrapTransaction(txn: unknown): AlgokitTransaction {
  if (txn instanceof AlgokitTransaction) {
    return txn;
  }

  if (txn instanceof algosdk.Transaction) {
    return decodeAlgokitTransaction(txn.toByte());
  }

  if (txn && typeof txn === 'object' && 'toByte' in txn && typeof txn.toByte === 'function') {
    return decodeAlgokitTransaction((txn as { toByte: () => Uint8Array }).toByte());
  }

  if (txn && typeof txn === 'object' && 'txn' in txn) {
    return unwrapTransaction((txn as { txn: unknown }).txn);
  }

  if (txn && typeof txn === 'object' && 'transaction' in txn) {
    return unwrapTransaction((txn as { transaction: unknown }).transaction);
  }

  if (txn && typeof txn === 'object' && 'unsignedTxn' in txn) {
    return unwrapTransaction((txn as { unsignedTxn: unknown }).unsignedTxn);
  }

  if (txn && typeof txn === 'object' && 'unsignedTransaction' in txn) {
    return unwrapTransaction((txn as { unsignedTransaction: unknown }).unsignedTransaction);
  }

  throw new Error('Algo Safe returned a transaction value that could not be normalized.');
}