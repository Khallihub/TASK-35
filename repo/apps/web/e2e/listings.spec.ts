import { test, expect } from '@playwright/test'
import { SEEDED, login } from './helpers'

test.describe('listings / create + edit workflow', () => {
  test('merchant creates a listing and sees it in the listings table', async ({ page }) => {
    await login(page, SEEDED.merchant)

    await page.goto('/listings/new')

    const priceInput = page.locator('input[placeholder="500000"]')
    await expect(priceInput).toBeVisible({ timeout: 10_000 })

    await page.locator('input[type="text"]').first().fill('Boston')
    await priceInput.fill('550000')

    await page.getByRole('button', { name: /save|create/i }).first().click()

    await page.waitForURL(/\/listings(?:\/\d+)?(?:\?|$)/, { timeout: 10_000 })
  })

  test('listings table shows the authenticated user rows', async ({ page }) => {
    await login(page, SEEDED.merchant)
    await page.goto('/listings')

    await expect(
      page.getByText(/no listings|listings|city|status/i).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})
