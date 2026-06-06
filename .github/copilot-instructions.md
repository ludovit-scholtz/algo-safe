# Copilot instructions

## Project overview

This is an AlgoKit monorepo for Algorand smart contracts and a React frontend:

- `projects/algo-safe-contracts`: Algorand TypeScript smart contracts, deployment scripts, and tests.
- `projects/algo-safe-frontend`: React/Vite frontend that consumes generated contract clients.
- `skills/`: repository-provided Algorand reference material for coding agents.

Use the root `AGENTS.md` for detailed Algorand-specific workflow, skill, MCP, AVM, frontend, and x402 guidance.

## Development workflow

- Bootstrap dependencies from the repository root with `algokit project bootstrap all`.
- Build all projects with `algokit project run build`.
- Run all tests with `algokit project run test`.
- Run project-specific commands with `--project-name`, for example:
  - `algokit project run lint --project-name 'algo-safe-contracts'`
  - `algokit project run test --project-name 'algo-safe-contracts'`
  - `algokit project run lint --project-name 'algo-safe-frontend'`
  - `algokit project run test --project-name 'algo-safe-frontend'`
- Start LocalNet before contract integration, deployment, or end-to-end work with `algokit localnet start`.

## Coding guidance

- Keep changes focused and avoid modifying generated artifacts unless the source change requires regeneration.
- For smart contracts, load the Algorand TypeScript and AVM guidance described in `AGENTS.md` before changing contract logic.
- For frontend changes, preserve the existing React, TypeScript, Tailwind, and wallet-integration patterns.
- Do not commit secrets or local environment files.
