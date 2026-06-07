import { config } from 'dotenv';
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from '@x402/fetch';
import { toClientAvmSigner, ExactAvmScheme, ALGORAND_TESTNET_CAIP2 } from '@x402/avm';
import {
  ed25519SigningKeyFromWrappedSecret,
  type WrappedEd25519Seed,
} from '@algorandfoundation/algokit-utils/crypto';
import { seedFromMnemonic } from '@algorandfoundation/algokit-utils/algo25';

config();

const avmMnemonic = process.env.AVM_MNEMONIC as string;
const url = 'https://x402.goplausible.xyz/examples/weather';

async function main(): Promise<void> {
  const secretKey = await getSecretKeyFromMnemonic(avmMnemonic);

  // Create the Algorand signer used to authorize payments.
  const avmSigner = toClientAvmSigner(secretKey);

  // Initialize the x402 client.
  const client = new x402Client();

  // Register Algorand testnet scheme
  client.register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(avmSigner));

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
    console.log(`\nNo payment settled (response status: ${response.status})`);
  }
}

// Build the base64-encoded signing key that x402-avm expects.
// Format = 32-byte Ed25519 seed + 32-byte public key
async function getSecretKeyFromMnemonic(avmMnemonic: string): Promise<string> {
  const seed = seedFromMnemonic(avmMnemonic);

  const seedCopy = new Uint8Array(seed);

  const wrappedSeed: WrappedEd25519Seed = {
    unwrapEd25519Seed: async () => seed,
    wrapEd25519Seed: async () => {},
  };

  const wrappedSecret = await ed25519SigningKeyFromWrappedSecret(wrappedSeed);

  return Buffer.concat([Buffer.from(seedCopy), Buffer.from(wrappedSecret.ed25519Pubkey)]).toString(
    'base64',
  );
}

main().catch(error => {
  console.error(error?.response?.data?.error ?? error);
  process.exit(1);
});