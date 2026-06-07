import { serve } from "@hono/node-server";
import { ALGORAND_TESTNET_CAIP2, toFacilitatorAvmSigner } from "@x402/avm";
import { ExactAvmScheme } from "@x402/avm/exact/facilitator";
import { x402Facilitator } from "@x402/core/facilitator";
import { config } from "dotenv";
import { Hono } from "hono";
import algosdk from "algosdk";

config();

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.PORT?.trim() || "4021", 10);
const algodServer = process.env.ALGOD_SERVER?.trim() || "https://testnet-api.algonode.cloud";
const algodToken = process.env.ALGOD_TOKEN?.trim() || "";
const algodPort = process.env.ALGOD_PORT?.trim() || "";
const algodUrl = formatAlgodUrl(algodServer, algodPort);

type VerifyPaymentPayload = Parameters<x402Facilitator["verify"]>[0];
type VerifyPaymentRequirements = Parameters<x402Facilitator["verify"]>[1];

const account = loadFacilitatorAccount();
const signer = toFacilitatorAvmSigner(account.privateKeyBase64, {
	algodToken,
	testnetUrl: algodUrl,
});

const facilitator = new x402Facilitator().register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(signer));
const app = new Hono();

app.get("/health", (context) => {
	return context.json({
		ok: true,
		address: account.address,
		network: ALGORAND_TESTNET_CAIP2,
	});
});

app.get("/supported", (context) => context.json(facilitator.getSupported()));

app.post("/verify", async (context) => {
	try {
		const { paymentPayload, paymentRequirements } = parseFacilitatorBody(await context.req.json());
		const result = await facilitator.verify(paymentPayload, paymentRequirements);
		return context.json(result);
	} catch (error) {
		return context.json(
			{ error: error instanceof Error ? error.message : "Invalid verify request." },
			400,
		);
	}
});

app.post("/settle", async (context) => {
	try {
		const { paymentPayload, paymentRequirements } = parseFacilitatorBody(await context.req.json());
		const result = await facilitator.settle(paymentPayload, paymentRequirements);
		return context.json(result);
	} catch (error) {
		return context.json(
			{ error: error instanceof Error ? error.message : "Invalid settle request." },
			400,
		);
	}
});

serve(
	{
		fetch: app.fetch,
		hostname: host,
		port: Number.isNaN(port) ? 4021 : port,
	},
	(info) => {
		console.info(`x402 facilitator listening on http://${info.address}:${info.port}`);
		console.info(`Facilitator signer: ${account.address}`);
		console.info(`Algod endpoint: ${algodUrl}`);
	},
);

function parseFacilitatorBody(input: unknown): {
	paymentPayload: VerifyPaymentPayload;
	paymentRequirements: VerifyPaymentRequirements;
} {
	if (!input || typeof input !== "object") {
		throw new Error("Expected a JSON object body.");
	}

	const { paymentPayload, paymentRequirements } = input as {
		paymentPayload?: VerifyPaymentPayload;
		paymentRequirements?: VerifyPaymentRequirements;
	};

	if (!paymentPayload) {
		throw new Error("Missing paymentPayload.");
	}

	if (!paymentRequirements) {
		throw new Error("Missing paymentRequirements.");
	}

	return { paymentPayload, paymentRequirements };
}

function loadFacilitatorAccount(): { address: string; privateKeyBase64: string } {
	const mnemonic = process.env.AVM_MNEMONIC?.trim();
	if (mnemonic) {
		const account = algosdk.mnemonicToSecretKey(mnemonic);
		return {
			address: account.addr.toString(),
			privateKeyBase64: Buffer.from(account.sk).toString("base64"),
		};
	}

	const privateKey = process.env.AVM_PRIVATE_KEY?.trim();
	if (privateKey) {
		const secretKey = new Uint8Array(Buffer.from(privateKey, "base64"));
		if (secretKey.length !== 64) {
			throw new Error("AVM_PRIVATE_KEY must be a base64-encoded 64-byte Algorand secret key.");
		}

		return {
			address: algosdk.encodeAddress(secretKey.slice(32)),
			privateKeyBase64: Buffer.from(secretKey).toString("base64"),
		};
	}

	const ephemeralAccount = algosdk.generateAccount();
	console.warn("AVM_MNEMONIC and AVM_PRIVATE_KEY are unset. Generated an ephemeral facilitator account for local verification only.");
	return {
		address: ephemeralAccount.addr.toString(),
		privateKeyBase64: Buffer.from(ephemeralAccount.sk).toString("base64"),
	};
}

function formatAlgodUrl(server: string, configuredPort: string): string {
	if (!configuredPort) {
		return server;
	}

	const parsed = new URL(server);
	if (parsed.port) {
		return parsed.toString();
	}

	parsed.port = configuredPort;
	return parsed.toString();
}