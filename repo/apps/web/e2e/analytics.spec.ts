import { test, expect } from '@playwright/test'
import { SEEDED, login } from './helpers'

test.describe('browser analytics: ops dashboard + export', () => {
  test('ops user lands on /analytics and sees KPI cards', async ({ page }) => {
    await login(page, SEEDED.ops)
    await page.goto('/analytics')

    await expect(
      page
        .getByText(/engagement actions|new users|active users|listings published/i)
        .first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('ops user kicks off a CSV export through the ExportPanel button', async ({ page }) => {
    await login(page, SEEDED.ops)
    await page.goto('/analytics')

    const generateBtn = page.getByRole('button', { name: /generate csv|export|download/i }).first()
    await expect(generateBtn).toBeVisible({ timeout: 10_000 })
    await generateBtn.click()

    await expect(
      page.getByText(/queued|running|completed|download/i).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('merchant is bounced off /analytics by the router guard', async ({ page }) => {
    await login(page, SEEDED.merchant)
    await page.goto('/analytics')
    await expect(page).toHaveURL(/\/listings(?:\?|$)/, { timeout: 10_000 })
  })
})
