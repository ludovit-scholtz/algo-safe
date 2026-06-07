import { algo, AlgorandClient } from '@algorandfoundation/algokit-utils';
import {
  Transaction,
  encodeTransactionRaw,
  groupTransactions,
} from '@algorandfoundation/algokit-utils/transact';
import { microAlgo } from '@algorandfoundation/algokit-utils/amount';
import algosdk from 'algosdk';
import { AlgoSafeClient } from 'algo-safe';
import type { PaymentPayloadResult, PaymentRequirements, SchemeNetworkClient } from '@x402/core/types';
import type { ClientAvmConfig, ClientAvmSigner, ExactAvmPayloadV2 } from '@x402/avm';
import { getAlgokitSigner, isTestnetNetwork } from '@x402/avm';

const DEFAULT_SAFE_APP_ID = 764044668n;
const DEFAULT_SAFE_GROUP_ID = 2n;
const DEFAULT_VALIDITY_WINDOW = 200n;
const READY_STATUS = 2n;
const ZERO_ADDRESS = algosdk.encodeAddress(new Uint8Array(32));
const EXECUTION_CALL_FEE = algo(0.2);
const APPROVE_PROPOSAL_METHOD = 'approveProposal(uint64)void';
const EXECUTE_PROPOSAL_METHOD = 'executeProposal(uint64)void';

type SafePaymentConfig = {
  appId: bigint;
  groupId: bigint;
  proposalId?: bigint;
};

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
    const safeClient = this.getSafeClient(algorandClient, safeConfig.appId);

    const proposalId =
      safeConfig.proposalId ??
      (await this.createAssetTransferProposal(safeClient, safeConfig.groupId, paymentRequirements, x402Version));

    const proposal = await safeClient.getProposal({ args: [proposalId] });
    const hasApproved = await safeClient.hasApproved({ args: [proposalId, this.signer.address] });
    const approveBoxReferences = getApproveBoxReferences(
      safeConfig.appId,
      proposalId,
      proposal.groupId,
      this.signer.address,
    );
    const executeBoxReferences = getExecuteBoxReferences(
      safeConfig.appId,
      proposalId,
      proposal.groupId,
      proposal.payloadType,
    );
    const transactions: Transaction[] = [];

    if (proposal.status !== READY_STATUS && !hasApproved) {
      const approvalParams = await safeClient.appClient.params.call({
        method: APPROVE_PROPOSAL_METHOD,
        args: [proposalId],
        staticFee: microAlgo(1_000),
        boxReferences: approveBoxReferences,
      });
      const approvalCall = await safeClient.algorand.createTransaction.appCallMethodCall(approvalParams);
      transactions.push(...approvalCall.transactions);
    }

    const executeParams = await safeClient.appClient.params.call({
      method: EXECUTE_PROPOSAL_METHOD,
      args: [proposalId],
      maxFee: EXECUTION_CALL_FEE,
      populateAppCallResources: true,
      coverAppCallInnerTransactionFees: true,
      boxReferences: executeBoxReferences,
    });
    const executeCall = await safeClient.algorand.createTransaction.appCallMethodCall(executeParams);
    transactions.push(...executeCall.transactions);

    if (transactions.length === 0) {
      throw new Error('Algo Safe payment flow did not produce any application call transactions.');
    }

    const executeIndex = transactions.length - 1;
    const groupedTransactions = groupTransactions(transactions.map((txn) => new Transaction({ ...txn, group: undefined })));
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

  private getSafeClient(algorandClient: AlgorandClient, appId: bigint): AlgoSafeClient {
    const algokitSigner = getAlgokitSigner(this.signer);
    if (!algokitSigner) {
      throw new Error('The Algo Safe x402 client requires an AlgoKit-backed Algorand signer.');
    }

    algorandClient.setSigner(this.signer.address, algokitSigner.signer as unknown as never);

    return algorandClient.client.getTypedAppClientById(AlgoSafeClient, {
      appId,
      defaultSender: this.signer.address,
    });
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

  private async createAssetTransferProposal(
    safeClient: AlgoSafeClient,
    groupId: bigint,
    paymentRequirements: PaymentRequirements,
    x402Version: number,
  ): Promise<bigint> {
    const suggestedParams = await safeClient.algorand.getSuggestedParams();
    const firstValid = BigInt(
      (suggestedParams as { firstValid?: bigint | number; firstValidRound?: bigint | number }).firstValid ??
      (suggestedParams as { firstValid?: bigint | number; firstValidRound?: bigint | number }).firstValidRound ??
      0,
    );
    const expiryRound = firstValid + DEFAULT_VALIDITY_WINDOW;
    const note = `x402-safe-payment-v${x402Version}-${Date.now()}`;

    const proposal = await safeClient.send.proposeAssetTransfer({
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
      staticFee: microAlgo(1_000),
      suppressLog: true,
    });

    if (proposal.return === undefined) {
      throw new Error('Algo Safe proposal creation did not return a proposal id.');
    }

    return proposal.return;
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

function getApproveBoxReferences(appId: bigint, proposalId: bigint, groupId: bigint, account: string) {
  return [
    createBoxReference(appId, 'p', proposalId),
    createAccountScopedBoxReference(appId, 'm', groupId, account),
    createAccountScopedBoxReference(appId, 'a', proposalId, account),
  ];
}

function getExecuteBoxReferences(appId: bigint, proposalId: bigint, groupId: bigint, payloadType: bigint) {
  const payloadPrefix = payloadType === 1n ? 'txg' : 'dp';

  return [
    createBoxReference(appId, 'p', proposalId),
    createBoxReference(appId, 'g', groupId),
    createBoxReference(appId, payloadPrefix, proposalId),
  ];
}