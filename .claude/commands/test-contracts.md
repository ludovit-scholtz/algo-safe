---
description: Run smart contract tests (unit and/or e2e)
---

From `projects/algo-safe-contracts/`:

```bash
# Unit tests + coverage (no localnet needed)
pnpm test

# E2E tests (requires: algokit localnet start)
algokit localnet start
pnpm test:e2e
```

Test files live in `smart_contracts/algo_safe/contract.e2e.spec.ts`.
Framework: Vitest + `@algorandfoundation/algorand-typescript-testing`.
