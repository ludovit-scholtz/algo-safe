# Automated npm Publishing For algo-safe-contracts

This repository publishes the `algo-safe` package automatically from GitHub Actions whenever code under `projects/algo-safe-contracts` changes on `main`.

## What the workflow does

The workflow file is `.github/workflows/algo-safe-contracts-package-publish.yaml`.

On each qualifying push it will:

1. Run the existing contract validation workflow.
2. Rebuild the smart-contract artifacts and generated client.
3. Run `build-package` to bundle the npm library.
4. Stamp a CI-only prerelease version in the form `<package.json version>-build.<run_number>`.
5. Publish that build to npm with the `next` dist-tag.

Because npm does not allow republishing the same version, the workflow publishes a unique prerelease version for every successful run. Consumers can install the latest CI package with `npm install algo-safe@next`.

## Required GitHub setup

Create a GitHub environment named `npm` and add the following secret:

- `NPM_TOKEN`: An npm access token with permission to publish the target package.

## How to create the npm token

1. Log in to npm with an account that has publish rights for the `algo-safe` package.
2. Open Access Tokens in npm account settings.
3. Create a granular or automation token with publish permission for the package.
4. Copy the token value immediately after creation.

## How to add the secret in GitHub

1. Open the repository in GitHub.
2. Go to Settings > Environments.
3. Create the `npm` environment if it does not already exist.
4. Open the environment and add a new secret named `NPM_TOKEN`.
5. Paste the npm token value and save it.

## First publish checklist

Before relying on the workflow, confirm these points:

1. The `algo-safe` package name is available to your npm account, or the package name in `projects/algo-safe-contracts/package.json` has been updated to the correct scope/name.
2. The npm token can publish that package.
3. The `main` branch protections allow the workflow to run after merge.
4. A merge to `main` includes a change under `projects/algo-safe-contracts`.

## Manual verification

If you want to verify the package locally before merging:

1. Run `corepack pnpm install` in `projects/algo-safe-contracts`.
2. Run `corepack pnpm run build`.
3. Run `corepack pnpm run build-package`.

If the local machine enforces pnpm minimum package age policies, use the same override that was needed during development:

`corepack pnpm install --config.minimum-release-age=0`