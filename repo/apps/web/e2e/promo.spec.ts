import { test, expect } from '@playwright/test'
import { SEEDED, login } from './helpers'

test.describe('browser promo: operations scheduling flow', () => {
  test('ops user opens the New Collection modal, submits, and lands on detail', async ({ page }) => {
    await login(page, SEEDED.ops)
    await page.goto('/promo')

    await page.getByRole('button', { name: /new collection/i }).click()

    const title = `Open Houses ${Date.now()}`
    const titleInput = page.locator('input[placeholder="Spring Collection 2025"]')
    await expect(titleInput).toBeVisible({ timeout: 10_000 })
    await titleInput.fill(title)

    const pad = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const starts = new Date(now.getTime() + 60 * 60_000)
    const ends = new Date(now.getTime() + 4 * 60 * 60_000)
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

    await page.locator('input[type="datetime-local"]').nth(0).fill(fmt(starts))
    await page.locator('input[type="datetime-local"]').nth(1).fill(fmt(ends))

    await page.getByRole('button', { name: /create collection|create/i }).click()
    await page.waitForURL(/\/promo\/\d+$/, { timeout: 15_000 })
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 10_000 })
  })

  test('ops user sees the newly created collection in the /promo list', async ({ page }) => {
    await login(page, SEEDED.ops)
    await page.goto('/promo')

    await page.getByRole('button', { name: /new collection/i }).click()
    const title = `List View ${Date.now()}`
    await page.locator('input[placeholder="Spring Collection 2025"]').fill(title)
    const pad = (n: number) => String(n).padStart(2, '0')
    const now = new Date()
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    await page.locator('input[type="datetime-local"]').nth(0).fill(fmt(new Date(now.getTime() + 60_000)))
    await page.locator('input[type="datetime-local"]').nth(1).fill(fmt(new Date(now.getTime() + 3_600_000)))
    await page.getByRole('button', { name: /create collection|create/i }).click()
    await page.waitForURL(/\/promo\/\d+$/, { timeout: 15_000 })

    await page.goto('/promo')
    await expect(page.getByText(title).first()).toBeVisible({ timeout: 15_000 })
  })

  test('merchant is bounced off /promo by the router guard', async ({ page }) => {
    await login(page, SEEDED.merchant)
    await page.goto('/promo')
    await expect(page).toHaveURL(/\/listings(?:\?|$)/, { timeout: 10_000 })
  })
})
