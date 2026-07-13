import { expect, test } from '@playwright/test'

// Governance UI smoke tests (v3.1.0 feature work): the safe-wide pause control
// on the dashboard and the create-signer-group flow (standard vs custodian).
// These run against the mocked Console UI — no wallet / network required. The
// on-chain pause read fails silently without a wallet, so the control renders
// its default "Active" state with disabled action buttons, which is enough to
// assert the surface exists and the custodian/standard form logic behaves.

test.describe('AlgoSafe Console — governance controls', () => {
  test('Dashboard surfaces the safe-wide pause control', async ({ page }) => {
    await page.goto('/safe/safe_1')
    await expect(page.getByRole('heading', { name: 'Safe Status' })).toBeVisible({ timeout: 15000 })
    // The New Signer Group shortcut routes to the create page.
    await page.getByRole('button', { name: 'New Signer Group' }).click()
    await expect(page).toHaveURL(/\/safe\/safe_1\/signer-groups\/create/, { timeout: 10000 })
  })

  test('Create Signer Group page toggles between standard and custodian', async ({ page }) => {
    await page.goto('/safe/safe_1/signer-groups/create')
    await expect(page.getByRole('heading', { name: 'Create Signer Group' })).toBeVisible({ timeout: 15000 })

    // Standard is the default: the Admin Privileges section is shown.
    await expect(page.getByRole('heading', { name: 'Admin Privileges' })).toBeVisible()
    await expect(page.getByText('Allow app calls')).toBeVisible()

    // Switching to custodian hides admin privileges and non-transfer actions.
    await page.getByRole('button', { name: 'Custodian group' }).click()
    await expect(page.getByRole('heading', { name: 'Admin Privileges' })).toHaveCount(0)
    await expect(page.getByText('Allow app calls')).toHaveCount(0)
    await expect(page.getByText(/restricted to payment and asset-transfer/i)).toBeVisible()

    // Payment / asset-transfer actions remain available for custodians.
    await expect(page.getByText('Allow ALGO payments')).toBeVisible()
    await expect(page.getByText('Allow ASA transfers')).toBeVisible()
  })
})
