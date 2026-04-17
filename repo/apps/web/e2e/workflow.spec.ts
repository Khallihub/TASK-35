import { test, expect, Page } from '@playwright/test'
import { SEEDED, login } from './helpers'

async function createDraftViaUI(page: Page): Promise<string> {
  await page.goto('/listings/new')
  await page.locator('input[placeholder="123 Main St"]').fill('42 Browser Way')
  await page.getByLabel('City').fill('Boston')
  await page.getByLabel('State Code').fill('MA')
  await page.getByLabel('Postal Code').fill('02108')
  await page.locator('input[placeholder="500000"]').fill('300000')
  await page.getByLabel('Beds').fill('2')
  await page.getByLabel('Baths').selectOption('1')
  await page.locator('input[placeholder="Area in sqft"]').fill('1200')

  await page.getByRole('button', { name: /create listing/i }).click()
  await page.waitForURL(/\/listings\/\d+$/, { timeout: 15_000 })
  const url = page.url()
  const match = url.match(/\/listings\/(\d+)$/)
  if (!match) throw new Error(`expected /listings/:id, got ${url}`)
  return match[1]
}

test.describe('browser workflow: draft → submit → approve → publish', () => {
  test('agent drafts, merchant approves + publishes; UI reflects every transition', async ({ browser }) => {
    const baseURL = process.env.BASE_URL ?? 'https://web:443'
    const agentCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL })
    const merchantCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL })
    try {
      const agentPage = await agentCtx.newPage()
      const merchantPage = await merchantCtx.newPage()

      await login(agentPage, SEEDED.agent)
      const listingId = await createDraftViaUI(agentPage)

      await agentPage.goto(`/listings/${listingId}`)
      // "Submit for Review" opens a ConfirmDialog — click the confirm button
      await agentPage.getByRole('button', { name: /submit for review/i }).click()
      await agentPage.getByRole('button', { name: /^submit$/i }).last().click()
      await expect(agentPage.getByText(/in.?review/i).first()).toBeVisible({ timeout: 10_000 })

      await login(merchantPage, SEEDED.merchant)
      await merchantPage.goto(`/listings/${listingId}`)
      // "Approve" also opens a ConfirmDialog
      await merchantPage.getByRole('button', { name: /^approve$/i }).click()
      await merchantPage.getByRole('button', { name: /^approve$/i }).last().click()
      await expect(merchantPage.getByText(/approved/i).first()).toBeVisible({ timeout: 10_000 })

      // "Publish" also opens a ConfirmDialog
      await merchantPage.getByRole('button', { name: /^publish$/i }).click()
      await merchantPage.getByRole('button', { name: /^publish$/i }).last().click()
      await expect(merchantPage.getByText(/published/i).first()).toBeVisible({ timeout: 10_000 })

      await agentPage.reload()
      await expect(agentPage.getByText(/published/i).first()).toBeVisible({ timeout: 10_000 })
    } finally {
      await agentCtx.close()
      await merchantCtx.close()
    }
  })

  test('Reject path: merchant rejects an in_review listing back to draft', async ({ browser }) => {
    const baseURL = process.env.BASE_URL ?? 'https://web:443'
    const agentCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL })
    const merchantCtx = await browser.newContext({ ignoreHTTPSErrors: true, baseURL })
    try {
      const agentPage = await agentCtx.newPage()
      const merchantPage = await merchantCtx.newPage()

      await login(agentPage, SEEDED.agent)
      const listingId = await createDraftViaUI(agentPage)
      await agentPage.goto(`/listings/${listingId}`)
      // Submit for review + confirm
      await agentPage.getByRole('button', { name: /submit for review/i }).click()
      await agentPage.getByRole('button', { name: /^submit$/i }).last().click()
      await expect(agentPage.getByText(/in.?review/i).first()).toBeVisible({ timeout: 10_000 })

      await login(merchantPage, SEEDED.merchant)
      await merchantPage.goto(`/listings/${listingId}`)

      // Reject opens a reason textarea dialog
      await merchantPage.getByRole('button', { name: /^reject$/i }).click()
      const reasonTextarea = merchantPage.locator('textarea').first()
      await expect(reasonTextarea).toBeVisible({ timeout: 5_000 })
      await reasonTextarea.fill('Needs more photos before approval')
      await merchantPage.getByRole('button', { name: /^submit$/i }).last().click()
      await expect(merchantPage.getByText(/draft/i).first()).toBeVisible({
        timeout: 10_000,
      })
    } finally {
      await agentCtx.close()
      await merchantCtx.close()
    }
  })
})
