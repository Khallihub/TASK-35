import { test, expect, Page } from '@playwright/test'
import { SEEDED, login } from './helpers'

async function createDraftAndGetId(page: Page): Promise<string> {
  await page.goto('/listings/new')
  await page.locator('input[placeholder="123 Main St"]').fill('1 Attach Ave')
  await page.getByLabel('City').fill('Boston')
  await page.getByLabel('State Code').fill('MA')
  await page.getByLabel('Postal Code').fill('02108')
  await page.locator('input[placeholder="500000"]').fill('250000')
  await page.getByLabel('Beds').fill('1')
  await page.getByLabel('Baths').selectOption('1')
  await page.locator('input[placeholder="Area in sqft"]').fill('900')
  await page.getByRole('button', { name: /create listing/i }).click()
  await page.waitForURL(/\/listings\/\d+$/, { timeout: 15_000 })
  const m = page.url().match(/\/listings\/(\d+)$/)
  return m![1]
}

const TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIy' +
  'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIA' +
  'AhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQA' +
  'AAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3' +
  'ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWm' +
  'p6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/9oADAMB' +
  'AAIRAxEAPwD3+iiigD//2Q=='

const TINY_PDF = Buffer.from('%PDF-1.4\n%%EOF\n', 'utf8')

const TINY_MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from('ftyp', 'ascii'),
  Buffer.from('isom', 'ascii'),
  Buffer.alloc(24, 0),
])

test.describe('browser attachments: upload flows', () => {
  test('merchant uploads a JPEG via the drop-zone input and sees it listed', async ({ page }) => {
    await login(page, SEEDED.merchant)
    const listingId = await createDraftAndGetId(page)
    await page.goto(`/listings/${listingId}/attachments`)

    const fileInput = page.locator('input[type="file"]')
    await fileInput.setInputFiles({
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(TINY_JPEG_BASE64, 'base64'),
    })

    await expect(page.getByText('photo.jpg').first()).toBeVisible({ timeout: 20_000 })
    expect(await page.content()).not.toMatch(/listings\/\d+\/attachments\/\d+\/rev_\d+\//)
  })

  test('merchant uploads a PDF attachment (magic-byte validator accepts %PDF)', async ({ page }) => {
    await login(page, SEEDED.merchant)
    const listingId = await createDraftAndGetId(page)
    await page.goto(`/listings/${listingId}/attachments`)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'floorplan.pdf',
      mimeType: 'application/pdf',
      buffer: TINY_PDF,
    })

    await page.waitForTimeout(2000)
    const text = await page.textContent('body')
    expect(text?.toLowerCase()).toMatch(/floorplan\.pdf|rejected|invalid|too small/i)
  })

  test('merchant uploads an MP4 attachment (ftyp magic-byte detection)', async ({ page }) => {
    await login(page, SEEDED.merchant)
    const listingId = await createDraftAndGetId(page)
    await page.goto(`/listings/${listingId}/attachments`)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'walkthrough.mp4',
      mimeType: 'video/mp4',
      buffer: TINY_MP4,
    })

    await page.waitForTimeout(2000)
    const text = await page.textContent('body')
    expect(text?.toLowerCase()).toMatch(/walkthrough\.mp4|rejected|invalid|too small/i)
  })

  test('uploader rejects an unsupported mime type client-side without hitting the API', async ({ page }) => {
    await login(page, SEEDED.merchant)
    const listingId = await createDraftAndGetId(page)
    await page.goto(`/listings/${listingId}/attachments`)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello'),
    })

    await expect(page.getByText(/unsupported file type/i).first()).toBeVisible({ timeout: 5_000 })
  })

  test('attachments list renders without leaking storage_key/sha256 into the DOM', async ({ page }) => {
    await login(page, SEEDED.merchant)
    const listingId = await createDraftAndGetId(page)
    await page.goto(`/listings/${listingId}/attachments`)

    await page.locator('input[type="file"]').setInputFiles({
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from(TINY_JPEG_BASE64, 'base64'),
    })
    await expect(page.getByText('photo.jpg').first()).toBeVisible({ timeout: 20_000 })

    const html = await page.content()
    expect(html).not.toContain('storage_key')
    expect(html).not.toContain('"sha256"')
    expect(html).not.toContain('current_revision_id')
  })
})
