import { test, expect } from '@playwright/test'

// Smoke test — happy-path route walk against the mocked AlgoSafe Console v2 UI.
// The webServer block in playwright.config.ts auto-starts `npm run dev` on port 5173.
// No wallet / network connection required (data is fully mocked via SafeService).

test.describe('AlgoSafe Console v2 — smoke (happy path)', () => {
  test('Safe Selection page gates safes behind a wallet connection', async ({ page }) => {
    await page.goto('/')
    // Without a connected wallet the page shows the chain + wallet picker instead of the safe list.
    await expect(page.getByRole('heading', { name: 'Choose chain and wallet' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('Authentication required')).toBeVisible()
  })

  test('Safe route opens the Agent Dashboard', async ({ page }) => {
    // Existing Safes need a connected wallet (not available in this mocked run), so open the route directly.
    await page.goto('/safe/safe_1')
    await expect(page.getByText('Agent Dashboard')).toBeVisible({ timeout: 15000 })
  })

  test('Proposals page shows Proposals heading', async ({ page }) => {
    await page.goto('/safe/safe_1/proposals')
    await expect(page.getByRole('heading', { name: 'Proposals', exact: true })).toBeVisible({ timeout: 15000 })
  })

  test('Treasury Assets page shows Assets heading', async ({ page }) => {
    await page.goto('/safe/safe_1/assets')
    await expect(page.getByRole('heading', { name: 'Assets' })).toBeVisible({ timeout: 15000 })
  })

  test('Register Agent page shows Agent Policy Preview', async ({ page }) => {
    await page.goto('/safe/safe_1/agents/register')
    // Two h2 elements with this text exist: one for mobile (lg:hidden), one for desktop (lg:block).
    // On Desktop Chrome viewport the desktop one is visible (second element, index 1).
    await expect(page.getByText('Agent Policy Preview').nth(1)).toBeVisible({ timeout: 15000 })
  })
})
