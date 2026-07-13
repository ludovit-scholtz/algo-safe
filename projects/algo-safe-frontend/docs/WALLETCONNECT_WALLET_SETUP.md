# Acting as a WalletConnect wallet (Reown WalletKit)

`algo-safe-frontend` can now do two different things with WalletConnect:

1. **Outbound (client)** — connect *out* to a personal wallet (Pera, Defly, or any WalletConnect wallet) to sign the operator's own proposal/approval transactions. This has existed since the beginning (`@txnlab/use-wallet-react`'s `WalletId.WALLETCONNECT` connector, wired up in `src/App.tsx`).
2. **Inbound (wallet)** — let a third-party dapp pair with this app *as if it were a wallet*, using [Reown WalletKit](https://docs.reown.com/walletkit/overview) (the wallet-side successor to `@walletconnect/web3wallet`). This is new, implemented in `src/services/walletKitService.ts`, `src/hooks/useWalletKit.ts`, and the `/safe/:safeId/walletconnect` page.

This document covers the inbound (wallet) side: how it works, its limitations, and how to register it with Reown so other dapps can find it.

## How it works

1. An operator opens the Safe's **WalletConnect** page and pairs with a dapp by pasting its `wc:` URI (or scanning its QR code, wherever the dapp displays one).
2. The dapp's session proposal is approved with a single account exposed: the **Safe's own on-chain address** (`algorand:<chain-reference>:<safe-address>`), on the `algo_signTxn` method. Dapps see the Safe as "the wallet," not the operator's personal address.
3. When the dapp sends an `algo_signTxn` request, the app:
   - Decodes each transaction entry and runs it through `algo-safe`'s `algosdkTxnsToSafeTxnGroup` converter (see the contracts package README linked below) to build a Safe `proposeTransactionGroup` payload.
   - Rejects upfront, with a **human-readable reason** shown in the UI, if the request can't be represented as a Safe proposal — see [Limitations](#limitations).
   - On success, shows a preview of the decoded transactions and lets the operator pick a signer group + expiry, then either:
     - **Submit Proposal to Chain** (recommended, default) — proposes the transaction group on-chain directly; the WalletConnect request is closed with a message pointing at the new proposal.
     - **Sign & Return via WalletConnect** — signs the `proposeTransactionGroup` app call with the connected use-wallet signer and returns *that* signed transaction as the `algo_signTxn` response.

### Important limitation: what gets signed and returned

A Safe never signs a dapp's original transactions as themselves — every transaction group becomes a governance proposal that executes later (immediately, if the target signer group is 1-of-1, or after M-of-N approval otherwise), via a **different** app-call transaction. This means:

- "Submit Proposal to Chain" is unambiguous: the proposal goes on-chain, and the dapp is told to track it (there's no standard `algo_signTxn` result that fits, so the request is closed with an informational message instead of a spoofed success).
- "Sign & Return via WalletConnect" returns the *proposal* transaction, not the dapp's original transaction(s). This will satisfy simple/permissive dapps that just want something signed back, but **will not** satisfy dapps that verify the returned blob matches what they requested byte-for-byte. Only use it when you control (or trust) the connecting dapp's expectations.

## Limitations

An incoming request is rejected (with the reason shown directly in the UI) when:

- A transaction entry's `signers` field is an explicit empty array (`[]`) — the WalletConnect Algorand spec's own signal that a different party must authorize it (e.g. a LogicSig, or another multisig member). The Safe can only co-sign for its own address or addresses currently rekeyed to it.
- A transaction's sender is neither the Safe's address nor an address registered as rekeyed to it (see `readRekeyedAddress` in the contracts README) — the Safe genuinely has no authority to move funds from it.
- The transaction type or shape isn't one `algo-safe`'s converter supports (its thrown error message is surfaced directly).

## Registering with Reown

1. **Create a Reown Cloud project** at [cloud.reown.com](https://cloud.reown.com). Sign in, create a new project, and copy its **Project ID**.
2. **Set the project ID** in the frontend's environment: add `VITE_WALLETCONNECT_PROJECT_ID=<your project id>` to `.env` (see `.env.template`). The same ID backs both the outbound use-wallet connector and the inbound WalletKit instance; a dedicated project is recommended if you want independent analytics/rate limits for the wallet-listing use case.
3. **WalletKit integration reference**: [docs.reown.com/walletkit/overview](https://docs.reown.com/walletkit/overview) — this is the SDK `src/services/walletKitService.ts` is built on.
4. **List it as a wallet** (so other dapps can discover and deep-link to it from WalletConnect's wallet picker/explorer): from your project's Reown Cloud dashboard, look for the Explorer/wallet-listing submission flow. Reown has moved this exact form before, so if the direct link doesn't match what you see, navigate from the Cloud dashboard itself rather than trusting a stale deep link.

## Related links

- **Documentation**: https://github.com/ludovit-scholtz/algo-safe/blob/main/projects/algo-safe-contracts/README.md
- **Security Audit**: https://github.com/ludovit-scholtz/algo-safe/tree/main/audits
