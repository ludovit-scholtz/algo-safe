import { config } from 'dotenv';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { ExactAvmScheme, toClientAvmSigner, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import algosdk from 'algosdk';

config();

const avmMnemonic = process.env.AVM_MNEMONIC as string;
const algodServer = process.env.ALGOD_SERVER?.trim() || 'https://testnet-api.algonode.cloud';
const algodToken = process.env.ALGOD_TOKEN?.trim() || '';
const algodPort = process.env.ALGOD_PORT?.trim() || '';
const usdcAssetId = Number.parseInt(process.env.USDC_ASSET_ID?.trim() || '10458941', 10);
//const url = 'https://x402.goplausible.xyz/examples/weather';
const url = 'http://localhost:4021/weather';

async function main(): Promise<void> {
  const account = algosdk.mnemonicToSecretKey(avmMnemonic);
  const algod = new algosdk.Algodv2(algodToken, algodServer, algodPort);
  await ensureAssetOptIn(algod, account, usdcAssetId);
  const secretKey = Buffer.from(account.sk).toString('base64');

  // Create the Algorand signer used to authorize payments.
  const avmSigner = toClientAvmSigner(secretKey);

  // Initialize the x402 client.
  const client = new x402Client();

  // Register Algorand testnet scheme
  client.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(avmSigner, {
    algodUrl: algodServer,
    algodToken,
  }));

  console.info(`AVM signer: ${avmSigner.address}`);

  // Wrap fetch so 402 responses trigger payment handling automatically.
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  // Make request
  const response = await fetchWithPayment(url, {
    method: 'GET',
  });

  if (response.ok) {
    // Read payment settlement headers
    const paymentResponse = new x402HTTPClient(client).getPaymentSettleResponse(name =>
      response.headers.get(name),
    );

    console.log('\nPayment response:');
    console.log(JSON.stringify(paymentResponse, null, 2));

    // Read the resource server response body
    const data = await response.json();

    console.log('\nWeather response:');
    console.log(JSON.stringify(data, null, 2));
  } else {
    await logUnsuccessfulResponse(response, client);
  }
}

async function logUnsuccessfulResponse(response: Response, client: x402Client): Promise<void> {
  const bodyText = await response.text();

  if (response.status === 402) {
    const paymentRequired = new x402HTTPClient(client).getPaymentRequiredResponse(
      name => response.headers.get(name),
      parseJsonSafely(bodyText),
    );

    console.log('\nPayment requirements:');
    console.log(JSON.stringify(paymentRequired, null, 2));
    console.log(`\nNo payment settled (response status: ${response.status})`);
    return;
  }

  console.error(`Request failed with status ${response.status} ${response.statusText}`);
  console.error('Response headers:', Object.fromEntries(response.headers.entries()));
  if (bodyText) {
    console.error('Response body:', bodyText);
  }
}

function parseJsonSafely(bodyText: string): unknown {
  if (!bodyText.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return undefined;
  }
}

async function ensureAssetOptIn(
  algod: algosdk.Algodv2,
  account: algosdk.Account,
  assetId: number,
): Promise<void> {
  if (Number.isNaN(assetId)) {
    throw new Error('USDC_ASSET_ID must be a valid integer asset id.');
  }

  const info = await algod.accountInformation(account.addr).do();
  const holdings = (info.assets ?? []) as Array<{ assetId?: bigint | number; ['asset-id']?: bigint | number }>;
  const alreadyOptedIn = holdings.some(
    (asset) => String(asset.assetId ?? asset['asset-id']) === String(assetId),
  );

  if (alreadyOptedIn) {
    return;
  }

  const suggestedParams = await algod.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: account.addr.toString(),
    receiver: account.addr.toString(),
    amount: 0,
    assetIndex: assetId,
    suggestedParams,
  });
  const signedTxn = optInTxn.signTxn(account.sk);
  const { txid } = await algod.sendRawTransaction(signedTxn).do();
  const txId = txid;
  await algosdk.waitForConfirmation(algod, txId, 10);
  console.info(`Opted client account into asset ${assetId} via ${txId}`);
}

main().catch(error => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});