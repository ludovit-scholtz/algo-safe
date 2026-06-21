---
description: Build smart contracts and regenerate typed clients
---

Run from `projects/algo-safe-contracts/`:

```bash
pnpm build
```

This compiles Algorand TypeScript → AVM bytecode, then auto-generates typed clients into `smart_contracts/artifacts/` and `src/contracts/`.

If the build fails, check:
1. AVM type errors (only `uint64` and `bytes` are valid AVM types)
2. Missing `ensureBudget()` calls for complex methods
3. `algokit localnet start` is not required for build — only for deploy/test:e2e
