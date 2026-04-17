import { validateAttachment } from '../../src/services/attachmentValidator';

async function detectAs(mime: string | undefined): Promise<string | undefined> {
  return mime;
}

describe('validateAttachment', () => {
  it('rejects when existing count is at the max quota', async () => {
    const result = await validateAttachment(Buffer.alloc(10), 'x.jpg', 25, () => detectAs('image/jpeg'));
    expect(result.valid).toBe(false);
    expect(result.rejectionCode).toBe('quota_exceeded');
  });

  it('accepts a JPEG under the size limit', async () => {
    const result = await validateAttachment(Buffer.alloc(10), 'x.jpg', 0, () => detectAs('image/jpeg'));
    expect(result).toEqual({ valid: true, kind: 'image' });
  });

  it('accepts PNG and WebP via detector', async () => {
    expect((await validateAttachment(Buffer.alloc(10), 'x.png', 0, () => detectAs('image/png'))).kind).toBe('image');
    expect((await validateAttachment(Buffer.alloc(10), 'x.webp', 0, () => detectAs('image/webp'))).kind).toBe('image');
  });

  it('rejects unknown MIME as invalid_type with detail', async () => {
    const result = await validateAttachment(Buffer.alloc(10), 'x.txt', 0, () => detectAs(undefined));
    expect(result.valid).toBe(false);
    expect(result.rejectionCode).toBe('invalid_type');
    expect(result.rejectionDetail).toMatch(/unknown/i);
  });

  it('rejects unknown explicit mime type as invalid_type', async () => {
    const result = await validateAttachment(Buffer.alloc(10), 'x.bin', 0, () => detectAs('application/octet-stream'));
    expect(result.rejectionCode).toBe('invalid_type');
    expect(result.rejectionDetail).toMatch(/application\/octet-stream/);
  });

  it('oversize image → oversize', async () => {
    const buf = Buffer.alloc(13 * 1024 * 1024);
    const result = await validateAttachment(buf, 'x.jpg', 0, () => detectAs('image/jpeg'));
    expect(result.rejectionCode).toBe('oversize');
  });

  it('accepts a minimal valid PDF header', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(10)]);
    const result = await validateAttachment(pdf, 'x.pdf', 0, () => detectAs('application/pdf'));
    expect(result).toEqual({ valid: true, kind: 'pdf' });
  });

  it('rejects PDF without magic header as corrupt', async () => {
    const bogus = Buffer.alloc(10);
    const result = await validateAttachment(bogus, 'x.pdf', 0, () => detectAs('application/pdf'));
    expect(result.rejectionCode).toBe('corrupt');
  });

  it('oversize PDF → oversize', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(21 * 1024 * 1024)]);
    const result = await validateAttachment(pdf, 'x.pdf', 0, () => detectAs('application/pdf'));
    expect(result.rejectionCode).toBe('oversize');
  });

  it('oversize MP4 → oversize (skips codec check)', async () => {
    const buf = Buffer.alloc(201 * 1024 * 1024);
    const result = await validateAttachment(buf, 'x.mp4', 0, () => detectAs('video/mp4'));
    expect(result.rejectionCode).toBe('oversize');
  });
});
