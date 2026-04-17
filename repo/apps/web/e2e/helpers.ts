import { expect, Page } from '@playwright/test'

/**
 * Seeded credentials from apps/api/src/db/seeds/03_bootstrap_admin.ts.
 */
export const SEEDED = {
  admin: { username: 'admin', password: 'Admin@harborstone1' },
  ops: { username: 'ops_user', password: 'Ops@harborstone1' },
  merchant: { username: 'merchant_user', password: 'Merchant@harborstone1' },
  agent: { username: 'agent_user', password: 'Agent@harborstone1' },
}

/**
 * Shared login helper that handles consent modal + change-password modal.
 * After this returns, the page is on /listings (or another post-login route).
 */
export async function login(
  page: Page,
  creds: { username: string; password: string },
  opts?: { expectChangePassword?: boolean },
) {
  await page.goto('/')
  await page.locator('input[autocomplete="username"]').fill(creds.username)
  await page.locator('input[autocomplete="current-password"]').fill(creds.password)
  await page.getByRole('button', { name: /sign in/i }).click()

  // After sign-in, one of three things happens:
  //   1. Consent modal appears (first login for this user)
  //   2. Change-password modal appears (admin must_change_password=1)
  //   3. Redirect to /listings (consent already accepted, no pw change needed)
  //
  // Race all three outcomes with generous timeouts — Docker containers are slow.
  const consentBtn = page.getByRole('button', { name: /i agree/i })
  const changePwModal = page.locator('text=/change.*password/i').first()

  const outcome = await Promise.race([
    consentBtn.waitFor({ timeout: 15_000 }).then(() => 'consent' as const).catch(() => null),
    changePwModal.waitFor({ timeout: 15_000 }).then(() => 'changepw' as const).catch(() => null),
    page.waitForURL(/\/listings(?:\?|$)/, { timeout: 15_000 }).then(() => 'listings' as const).catch(() => null),
  ])

  if (outcome === 'consent') {
    await consentBtn.click()
    // After accepting consent, either change-password modal or /listings redirect.
    if (opts?.expectChangePassword) {
      await expect(changePwModal).toBeVisible({ timeout: 10_000 })
      return
    }
    await expect(page).toHaveURL(/\/listings(?:\?|$)/, { timeout: 15_000 })
    return
  }

  if (outcome === 'changepw') {
    if (opts?.expectChangePassword) return
    // Unexpected change-password — let it fail visibly
    throw new Error('Unexpected change-password modal')
  }

  if (outcome === 'listings') {
    if (opts?.expectChangePassword) {
      throw new Error('Expected change-password modal but landed on /listings')
    }
    return
  }

  // None of the three outcomes matched — login probably failed.
  throw new Error(`Login stuck on ${page.url()} — no consent, no changepw, no redirect`)
}

/** Rotated admin password for idempotent re-runs. */
export const ADMIN_ROTATED_PW = `Admin@e2e-${new Date().getUTCFullYear()}!`

/**
 * Login as admin, handling both initial (must_change_password) and rotated flows.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  for (const pw of [ADMIN_ROTATED_PW, SEEDED.admin.password]) {
    await page.goto('/')
    await page.locator('input[autocomplete="username"]').fill('admin')
    await page.locator('input[autocomplete="current-password"]').fill(pw)
    await page.getByRole('button', { name: /sign in/i }).click()

    // Race: consent modal, change-password modal, or /listings redirect.
    const consentBtn = page.getByRole('button', { name: /i agree/i })
    const changeModal = page.locator('text=/change.*password/i').first()

    const first = await Promise.race([
      consentBtn.waitFor({ timeout: 15_000 }).then(() => 'consent' as const).catch(() => null),
      changeModal.waitFor({ timeout: 15_000 }).then(() => 'modal' as const).catch(() => null),
      page.waitForURL(/\/listings(?:\?|$)/, { timeout: 15_000 }).then(() => 'listings' as const).catch(() => null),
    ])

    if (first === 'consent') {
      await consentBtn.click()
      // After consent: either change-password or listings
      const landed = await Promise.race([
        page.waitForURL(/\/listings(?:\?|$)/, { timeout: 10_000 }).then(() => 'listings' as const).catch(() => null),
        changeModal.waitFor({ timeout: 10_000 }).then(() => 'modal' as const).catch(() => null),
      ])
      if (landed === 'listings') return
      // fall through to modal handling
    }

    const landed = first === 'consent' ? 'modal' : first

    if (landed === 'listings') return

    if (landed === 'modal') {
      // Fill current + new password + confirm.
      const allPw = page.locator('input[type="password"]')
      const count = await allPw.count()
      if (count >= 3) {
        await allPw.nth(0).fill(pw)
        await allPw.nth(1).fill(ADMIN_ROTATED_PW)
        await allPw.nth(2).fill(ADMIN_ROTATED_PW)
      } else if (count === 2) {
        await allPw.nth(0).fill(ADMIN_ROTATED_PW)
        await allPw.nth(1).fill(ADMIN_ROTATED_PW)
      }
      await page.getByRole('button', { name: /change password|update|submit/i }).last().click()
      await page.waitForURL(/\/listings(?:\?|$)/, { timeout: 10_000 }).catch(() => undefined)
      return
    }
    // Login failed with this password — try the next one.
  }
  throw new Error('admin login failed with both known passwords')
}
