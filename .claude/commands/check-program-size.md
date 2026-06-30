---
description: Measure the compiled approval-program size against the AVM limit
---

The AVM caps the approval program at **8192 bytes** (`MaxExtraAppProgramPages = 3` → 4 pages × 2048). Going over makes deploy fail with `tx.ExtraProgramPages exceeds MaxExtraAppProgramPages = 3` — and every e2e test fails at the deploy step, not at the assertion you were expecting.

After `pnpm build`, measure the **compiled bytecode** size (the `.teal` line count is not the limit — bytecode bytes are). LocalNet must be running (`algokit localnet start`).

Run from `projects/algo-safe-contracts/`:

```bash
python -c "
import urllib.request, json, base64
teal = open('smart_contracts/artifacts/algo_safe/AlgoSafe.approval.teal','rb').read()
req = urllib.request.Request('http://localhost:4001/v2/teal/compile', data=teal,
    headers={'X-Algo-API-Token':'a'*64, 'Content-Type':'text/plain'})
sz = len(base64.b64decode(json.load(urllib.request.urlopen(req))['result']))
print(f'compiled approval bytecode: {sz} bytes (limit 8192, margin {8192 - sz})')
"
```

If it's over (or close): the usual culprit is emitting large statically-sized code per case. Prefer **loops over the low-level `op.ITxnCreate` append setters** rather than enumerating tuple lengths for inner-transaction array fields (`appArgs`/`accounts`/`assets`/`apps`). See the "Contract authoring gotchas" section in `CLAUDE.md`.
