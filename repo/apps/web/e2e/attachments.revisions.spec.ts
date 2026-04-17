import { test, expect, Page } from '@playwright/test'
import { SEEDED, login } from './helpers'

async function createDraft(page: Page): Promise<string> {
  await page.goto('/listings/new')
  await page.locator('input[placeholder="123 Main St"]').fill('9 Revision St')
  await page.getByLabel('City').fill('Boston')
  await page.getByLabel('State Code').fill('MA')
  await page.getByLabel('Postal Code').fill('02108')
  await page.locator('input[placeholder="500000"]').fill('420000')
  await page.getByLabel('Beds').fill('2')
  await page.getByLabel('Baths').selectOption('1')
  await page.locator('input[placeholder="Area in sqft"]').fill('1100')
  await page.getByRole('button', { name: /create listing/i }).click()
  await page.waitForURL(/\/listings\/\d+$/, { timeout: 15_000 })
  return page.url().match(/\/listings\/(\d+)$/)![1]
}

const JPEG_A = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
    'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
    'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
    'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
    'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMB' +
    'AAIRAxEAPwD3+iiigD//2Q==',
  'base64',
)

test.describe('browser attachments: revision drawer + rollback', () => {
  test('merchant opens the Revisions drawer for an uploaded attachment', async ({ page }) => {
    await login(page, SEEDED.merchant)
    const listingId = await createDraft(page)
    await page.goto(`/listings/${listingId}/attachments`)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'rev-a.jpg',
      mimeType: 'image/jpeg',
      buffer: JPEG_A,
    })
    await expect(page.getByText('rev-a.jpg').first()).toBeVisible({ timeout: 20_000 })

    const revisionsBtn = page.getByRole('button', { name: /revisions/i }).first()
    await expect(revisionsBtn).toBeVisible({ timeout: 10_000 })
    await revisionsBtn.click()

    await expect(
      page.getByText(/revision|rollback/i).first(),
    ).toBeVisible({ timeout: 10_000 })
  })
})
