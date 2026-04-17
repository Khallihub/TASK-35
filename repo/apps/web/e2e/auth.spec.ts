import { test, expect } from '@playwright/test'
import { SEEDED, login } from './helpers'

test.describe('auth / login workflow', () => {
  test('operations user signs in and lands on the listings workspace', async ({ page }) => {
    await login(page, SEEDED.ops)
    // login helper already asserts /listings URL
  })

  test('invalid credentials render a generic error without disclosing account state', async ({ page }) => {
    await page.goto('/')
    await page.locator('input[autocomplete="username"]').fill(SEEDED.ops.username)
    await page.locator('input[autocomplete="current-password"]').fill('wrong-password-0')
    await page.getByRole('button', { name: /sign in/i }).click()

    const errorBox = page.locator('.form-error')
    await expect(errorBox).toBeVisible({ timeout: 5_000 })
    await expect(errorBox).not.toContainText(/locked|disabled|not found/i)
  })

  test('administrator first-login forces a password change modal', async ({ page }) => {
    await login(page, SEEDED.admin, { expectChangePassword: true })
  })
})
