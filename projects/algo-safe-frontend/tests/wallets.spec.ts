import { expect, test } from '@playwright/test'

// use-wallet v5: the unauthenticated Safe Selection page lists wallets from the
// adapter packages. Biatec is its own adapter (id "biatec"), not a WalletConnect skin.
test.describe('wallet picker (use-wallet v5)', () => {
  test('lists Pera, Defly, WalletConnect and Biatec on a browser chain', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Choose chain and wallet' })).toBeVisible({ timeout: 15000 })
    await page.locator('select').first().selectOption('mainnet')

    for (const name of [/Pera/i, /Defly/i, /WalletConnect/i, /Biatec/i]) {
      await expect(page.getByRole('button', { name: new RegExp(`${name.source}.*Connect`, 'i') }).first()).toBeVisible()
    }
    await expect(page.getByText('Connect Biatec Wallet directly')).toBeVisible()
  })

  test('shows only KMD on localnet', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Choose chain and wallet' })).toBeVisible({ timeout: 15000 })
    const select = page.locator('select').first()
    test.skip((await select.locator('option[value="localnet"]').count()) === 0, 'KMD wallet unavailable')
    await select.selectOption('localnet')
    await expect(page.getByText('Choose a LocalNet wallet')).toBeVisible()
    await expect(page.getByText('Connect Biatec Wallet directly')).toHaveCount(0)
  })
})
