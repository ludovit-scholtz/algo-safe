import { serve } from "@hono/node-server";
import { ALGORAND_TESTNET_CAIP2, toFacilitatorAvmSigner } from "@x402/avm";
import { x402Facilitator } from "@x402/core/facilitator";
import { config } from "dotenv";
import { Hono } from "hono";
import algosdk from "algosdk";
import { ExactAvmScheme } from "./scheme.js";

config();

const host = process.env.HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.PORT?.trim() || "4022", 10);
const algodServer = process.env.ALGOD_SERVER?.trim() || "https://testnet-api.algonode.cloud";
const algodToken = process.env.ALGOD_TOKEN?.trim() || "";
const algodPort = process.env.ALGOD_PORT?.trim() || "";
const algodUrl = formatAlgodUrl(algodServer, algodPort);
const usdcAssetId = Number.parseInt(process.env.USDC_ASSET_ID?.trim() || "10458941", 10);

type VerifyPaymentPayload = Parameters<x402Facilitator["verify"]>[0];
type VerifyPaymentRequirements = Parameters<x402Facilitator["verify"]>[1];

const account = loadFacilitatorAccount();
await ensureAssetOptIn(account);
const signer = toFacilitatorAvmSigner(account.privateKeyBase64, {
	algodToken,
	testnetUrl: algodUrl,
});

const facilitator = new x402Facilitator().register(ALGORAND_TESTNET_CAIP2, new ExactAvmScheme(signer));
const app = new Hono<{ Variables: { requestId: string } }>();

app.use("*", async (context, next) => {
	const requestId = createRequestId();
	const startedAt = Date.now();

	context.set("requestId", requestId);
	console.info(`[${requestId}] ${context.req.method} ${context.req.path} started`);

	try {
		await next();
		console.info(
			`[${requestId}] ${context.req.method} ${context.req.path} completed status=${context.res.status} durationMs=${Date.now() - startedAt}`,
		);
	} catch (error) {
		console.error(
			`[${requestId}] ${context.req.method} ${context.req.path} failed durationMs=${Date.now() - startedAt}`,
			error,
		);
		throw error;
	}
});

app.get("/health", (context) => {
	console.info(`[${getRequestId(context)}] Health check requested`);
	return context.json({
		ok: true,
		address: account.address,
		network: ALGORAND_TESTNET_CAIP2,
	});
});

app.get("/supported", (context) => {
	const supported = facilitator.getSupported();
	console.info(
		`[${getRequestId(context)}] Supported schemes requested kinds=${supported.kinds.length} signers=${Object.keys(supported.signers).length}`,
	);
	return context.json(supported);
});

app.post("/verify", async (context) => {
	try {
		const { paymentPayload, paymentRequirements } = parseFacilitatorBody(await context.req.json());
		console.info(
			`[${getRequestId(context)}] Verify requested ${formatRequestSummary(paymentPayload, paymentRequirements)}`,
		);
		const result = await facilitator.verify(paymentPayload, paymentRequirements);
		console.info(
			`[${getRequestId(context)}] Verify result isValid=${result.isValid}${result.isValid ? "" : ` reason=${result.invalidReason ?? "unknown"} message=${result.invalidMessage ?? "n/a"}`}`,
		);
		return context.json(result);
	} catch (error) {
		console.error(`[${getRequestId(context)}] Verify request rejected`, error);
		return context.json(
			{ error: error instanceof Error ? error.message : "Invalid verify request." },
			400,
		);
	}
});

app.post("/settle", async (context) => {
	try {
		const { paymentPayload, paymentRequirements } = parseFacilitatorBody(await context.req.json());
		console.info(
			`[${getRequestId(context)}] Settle requested ${formatRequestSummary(paymentPayload, paymentRequirements)}`,
		);
		const result = await facilitator.settle(paymentPayload, paymentRequirements);
		console.info(
			`[${getRequestId(context)}] Settle result success=${result.success}${result.success ? ` tx=${result.transaction}` : ` reason=${result.errorReason ?? "unknown"} message=${result.errorMessage ?? "n/a"}`}`,
		);
		return context.json(result);
	} catch (error) {
		console.error(`[${getRequestId(context)}] Settle request rejected`, error);
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

async function ensureAssetOptIn(account: { address: string; privateKeyBase64: string }): Promise<void> {
	if (Number.isNaN(usdcAssetId)) {
		throw new Error("USDC_ASSET_ID must be a valid integer asset id.");
	}

	const algod = new algosdk.Algodv2(algodToken, algodServer, algodPort);
	const accountInfo = await algod.accountInformation(account.address).do();
	const holdings = (accountInfo.assets ?? []) as Array<{ assetId?: bigint | number; ["asset-id"]?: bigint | number }>;
	const alreadyOptedIn = holdings.some(
		(asset) => String(asset.assetId ?? asset["asset-id"]) === String(usdcAssetId),
	);

	if (alreadyOptedIn) {
		console.info(`Facilitator signer already opted into asset ${usdcAssetId}`);
		return;
	}

	const suggestedParams = await algod.getTransactionParams().do();
	const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
		sender: account.address,
		receiver: account.address,
		amount: 0,
		assetIndex: usdcAssetId,
		suggestedParams,
	});
	const secretKey = new Uint8Array(Buffer.from(account.privateKeyBase64, "base64"));
	const signedTxn = optInTxn.signTxn(secretKey);
	const { txid } = await algod.sendRawTransaction(signedTxn).do();
	const txId = txid;
	await algosdk.waitForConfirmation(algod, txId, 10);
	console.info(`Facilitator signer opted into asset ${usdcAssetId} via ${txId}`);
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

function createRequestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function getRequestId(context: { get: (key: string) => unknown }): string {
	const value = context.get("requestId");
	return typeof value === "string" ? value : "unknown";
}

function formatRequestSummary(
	paymentPayload: VerifyPaymentPayload,
	paymentRequirements: VerifyPaymentRequirements,
): string {
	const payload = paymentPayload.payload as { paymentGroup?: unknown[]; paymentIndex?: unknown } | null;
	const paymentGroupSize = Array.isArray(payload?.paymentGroup) ? payload.paymentGroup.length : 0;
	const paymentIndex = typeof payload?.paymentIndex === "number" ? payload.paymentIndex : "unknown";

	return [
		`scheme=${paymentRequirements.scheme}`,
		`network=${paymentRequirements.network}`,
		`x402Version=${paymentPayload.x402Version}`,
		`paymentGroupSize=${paymentGroupSize}`,
		`paymentIndex=${paymentIndex}`,
	].join(" ");
}