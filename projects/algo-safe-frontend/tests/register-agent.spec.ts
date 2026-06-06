import { test, expect } from '@playwright/test'

// Uses the webServer configured in playwright.config.ts (npm run dev on port 5173).
// reuseExistingServer is enabled locally — Playwright reuses an already-running server.

test.describe('Register Agent happy path', () => {
  test('fill form → submit → redirect to /agents with new alias', async ({ page }) => {
    // Navigate to register page (baseURL from playwright.config.ts)
    await page.goto('/agents/register')

    // Confirm we are on the Register AI Agent page (wait for React to hydrate)
    await expect(page.getByRole('heading', { name: 'Register AI Agent' })).toBeVisible({ timeout: 15000 })

    // Fill in Algorand public address
    await page.getByPlaceholder('e.g., V4XYZ...5TGA').fill(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    )

    // Fill in Agent Alias
    await page.getByPlaceholder('e.g., Arbitrage Bot Alpha').fill('Playwright Test Agent')

    // Select Operational Purpose — FormField wraps select in a <label> element
    await page.locator('select').nth(0).selectOption('treasury')

    // Submit the form
    await page.getByRole('button', { name: /Initialize Agent Contract/i }).click()

    // Should redirect to /agents
    await expect(page).toHaveURL(/\/agents$/, { timeout: 5000 })

    // The new alias should appear in the agents table
    await expect(page.getByText('Playwright Test Agent')).toBeVisible()
  })
})
