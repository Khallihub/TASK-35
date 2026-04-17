import { detectMimeType } from '../../src/services/mimeDetect';

/**
 * MIME detection service coverage.
 *
 * Attachments are validated by magic bytes (never by filename/Content-Type)
 * per the PRD's server-side re-validation requirement. This suite locks
 * the fallback detector — which is what actually runs under Jest since
 * file-type is ESM-only — and the error paths.
 */

describe('detectMimeType — magic-byte sniffing', () => {
  it('detects JPEG via FF D8 FF', async () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0]);
    expect(await detectMimeType(buf)).toBe('image/jpeg');
  });

  it('detects PNG via 89 50 4E 47', async () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await detectMimeType(buf)).toBe('image/png');
  });

  it('detects WebP via RIFF ... WEBP header', async () => {
    // RIFF (0x52 0x49 0x46 0x46) + 4-byte size (any) + WEBP (0x57 0x45 0x42 0x50)
    const buf = Buffer.concat([
      Buffer.from([0x52, 0x49, 0x46, 0x46]),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from([0x57, 0x45, 0x42, 0x50]),
    ]);
    expect(await detectMimeType(buf)).toBe('image/webp');
  });

  it('detects MP4 via "ftyp" box at offset 4', async () => {
    const buf = Buffer.concat([
      Buffer.from([0, 0, 0, 0]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from([0, 0, 0, 0]),
    ]);
    expect(await detectMimeType(buf)).toBe('video/mp4');
  });

  it('detects PDF via %PDF prefix', async () => {
    const buf = Buffer.concat([Buffer.from('%PDF', 'ascii'), Buffer.from([0x2d, 0x31, 0x2e, 0x37])]);
    expect(await detectMimeType(buf)).toBe('application/pdf');
  });

  it('returns undefined for buffers shorter than 4 bytes', async () => {
    expect(await detectMimeType(Buffer.from([0xff]))).toBeUndefined();
    expect(await detectMimeType(Buffer.from([]))).toBeUndefined();
  });

  it('returns undefined for unknown bytes (no known magic)', async () => {
    const buf = Buffer.from([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77]);
    expect(await detectMimeType(buf)).toBeUndefined();
  });
});
