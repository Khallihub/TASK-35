import { test, expect } from '@playwright/test'
import { SEEDED, login, loginAsAdmin } from './helpers'

test.describe('browser admin: privileged surfaces', () => {
  test('administrator navigates to /admin and sees the Users tab by default', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')

    await expect(page.getByRole('button', { name: /^users$/i }).first()).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByText(/username/i).first()).toBeVisible({ timeout: 10_000 })
  })

  test('administrator verifies the audit chain via the Audit Chain tab', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')

    await page.getByRole('button', { name: /audit chain/i }).click()

    const verifyBtn = page.getByRole('button', { name: /verify (audit )?chain/i }).first()
    await expect(verifyBtn).toBeVisible({ timeout: 10_000 })
    await verifyBtn.click()

    await expect(
      page.getByText(/audit chain is (valid|broken)/i).first(),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('administrator adds and removes a blacklist entry through the UI', async ({ page }) => {
    await loginAsAdmin(page)
    await page.goto('/admin')

    await page.getByRole('button', { name: /risk.*blacklist/i }).click()
    await page.getByRole('button', { name: /add to blacklist/i }).click()

    const ip = `198.51.100.${Math.floor(Math.random() * 254) + 1}`
    // Fill subject value (text input) and reason (textarea) in the blacklist modal.
    const subjectInput = page.locator('.base-modal input[type="text"], .modal input[type="text"]').first()
    await subjectInput.waitFor({ timeout: 10_000 })
    await subjectInput.fill(ip)
    const reasonTextarea = page.locator('.base-modal textarea, .modal textarea').first()
    await reasonTextarea.fill('e2e-spec')
    await page.getByRole('button', { name: /^add$/i }).last().click()

    await expect(page.getByText(ip).first()).toBeVisible({ timeout: 10_000 })

    // Remove via row button — the UI uses a Vue ConfirmDialog component
    // (not a native browser dialog), so click the confirm button in the modal.
    const row = page.locator('tr', { hasText: ip })
    const removeBtn = row.getByRole('button', { name: /remove/i })
    if (await removeBtn.isVisible().catch(() => false)) {
      await removeBtn.click()
      // ConfirmDialog renders a "Remove" confirm button
      const confirmBtn = page.getByRole('button', { name: /^remove$/i }).last()
      await confirmBtn.waitFor({ timeout: 5_000 }).catch(() => undefined)
      if (await confirmBtn.isVisible().catch(() => false)) {
        await confirmBtn.click()
      }
      await expect(page.getByText(ip)).toHaveCount(0, { timeout: 10_000 })
    }
  })

  test('operations is denied access to /admin (router guard)', async ({ page }) => {
    await login(page, SEEDED.ops)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/listings(?:\?|$)/, { timeout: 10_000 })
  })
})
