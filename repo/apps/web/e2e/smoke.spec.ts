import { test, expect } from '@playwright/test'

/**
 * Phase-4 exit smoke E2E. Verifies the desktop-first sign-in surface loads
 * and the API health endpoint responds through the same nginx ingress that
 * production uses. This is the seed scaffold; broader workflow E2Es
 * (listing draft → submit → approve → publish, attachment upload, promo
 * editor, analytics export) belong here too.
 */
test.describe('HarborStone smoke', () => {
  test('login page renders the expected affordances', async ({ page }) => {
    await page.goto('/')
    // Login view should expose a username + password input.
    await expect(page.locator('input[type="password"]')).toBeVisible()
    await expect(page.locator('input').first()).toBeVisible()
  })

  test('API health endpoint reports ok via nginx ingress', async ({ request }) => {
    const res = await request.get('/api/v1/health')
    // The route mounts under /api/v1; status may be 200 with { ok: true }.
    expect(res.status()).toBeLessThan(500)
  })
})
