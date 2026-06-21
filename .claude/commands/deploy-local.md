---
description: Deploy contracts to localnet for development/testing
---

```bash
algokit localnet start
algokit project run build
algokit project deploy localnet
```

Note the App ID from deployment output — the frontend and tests read it from `.env.local` or environment variables. Deployment is idempotent (safe to re-run).
