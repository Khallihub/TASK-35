import { validateAttachment } from '../../src/services/attachmentValidator';

// Helper: create a minimal JPEG-like buffer (just magic bytes + filler)
function makeJpeg(sizeBytes = 100): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0);
  buf[0] = 0xff;
  buf[1] = 0xd8; // JPEG SOI
  buf[2] = 0xff;
  buf[3] = 0xe0; // APP0 marker (JFIF, not EXIF)
  return buf;
}

function makePdf(sizeBytes = 100): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0x20);
  buf.write('%PDF', 0, 'ascii');
  return buf;
}

function makePdfCorrupt(sizeBytes = 100): Buffer {
  const buf = Buffer.alloc(sizeBytes, 0x20);
  buf.write('NOPE', 0, 'ascii');
  return buf;
}

// Mock mime detector helpers
const jpegDetector = async (_buf: Buffer) => 'image/jpeg';
const pngDetector = async (_buf: Buffer) => 'image/png';
const mp4Detector = async (_buf: Buffer) => 'video/mp4';
const pdfDetector = async (_buf: Buffer) => 'application/pdf';
const unknownDetector = async (_buf: Buffer) => 'application/octet-stream';

describe('validateAttachment', () => {
  describe('quota check', () => {
    it('returns quota_exceeded when existingCount >= 25', async () => {
      const buf = makeJpeg();
      const result = await validateAttachment(buf, 'test.jpg', 25, jpegDetector);
      expect(result.valid).toBe(false);
      expect(result.rejectionCode).toBe('quota_exceeded');
    });

    it('allows upload when existingCount = 24', async () => {
      const buf = makeJpeg(100);
      const result = await validateAttachment(buf, 'test.jpg', 24, jpegDetector);
      // Should not be quota_exceeded
      expect(result.rejectionCode).not.toBe('quota_exceeded');
    });
  });

  describe('MIME type detection', () => {
    it('validates a JPEG image under limit', async () => {
      const buf = makeJpeg(100);
      const result = await validateAttachment(buf, 'photo.jpg', 0, jpegDetector);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe('image');
    });

    it('validates a PNG image', async () => {
      const buf = makeJpeg(100);
      const result = await validateAttachment(buf, 'photo.png', 0, pngDetector);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe('image');
    });

    it('returns invalid_type for unknown MIME', async () => {
      const buf = Buffer.alloc(100);
      const result = await validateAttachment(buf, 'file.bin', 0, unknownDetector);
      expect(result.valid).toBe(false);
      expect(result.rejectionCode).toBe('invalid_type');
      expect(result.rejectionDetail).toContain('application/octet-stream');
    });

    it('returns invalid_type for undefined MIME', async () => {
      const undefinedDetector = async (_buf: Buffer) => undefined;
      const buf = Buffer.alloc(100);
      const result = await validateAttachment(buf, 'file.dat', 0, undefinedDetector);
      expect(result.valid).toBe(false);
      expect(result.rejectionCode).toBe('invalid_type');
    });
  });

  describe('size limits', () => {
    it('rejects JPEG over 12 MB', async () => {
      const oversizedBuf = Buffer.alloc(13 * 1024 * 1024, 0);
      const result = await validateAttachment(oversizedBuf, 'big.jpg', 0, jpegDetector);
      expect(result.valid).toBe(false);
      expect(result.rejectionCode).toBe('oversize');
    });

    it('accepts JPEG exactly at 12 MB', async () => {
      const exactBuf = Buffer.alloc(12 * 1024 * 1024, 0);
      const result = await validateAttachment(exactBuf, 'exact.jpg', 0, jpegDetector);
      expect(result.rejectionCode).not.toBe('oversize');
    });

    it('rejects MP4 over 200 MB', async () => {
      const oversizedBuf = Buffer.alloc(201 * 1024 * 1024, 0);
      const result = await validateAttachment(oversizedBuf, 'big.mp4', 0, mp4Detector);
      expect(result.valid).toBe(false);
      expect(result.rejectionCode).toBe('oversize');
    });

    it('rejects PDF over 20 MB', async () => {
      const oversizedBuf = Buffer.alloc(21 * 1024 * 1024, 0x20);
      oversizedBuf.write('%PDF', 0, 'ascii');
      const result = await validateAttachment(oversizedBuf, 'big.pdf', 0, pdfDetector);
      expect(result.valid).toBe(false);
      expect(result.rejectionCode).toBe('oversize');
    });
  });

  describe('PDF header check', () => {
    it('accepts PDF with correct %PDF header', async () => {
      const buf = makePdf();
      const result = await validateAttachment(buf, 'doc.pdf', 0, pdfDetector);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe('pdf');
    });

    it('rejects PDF with wrong header (corrupt)', async () => {
      const buf = makePdfCorrupt();
      const result = await validateAttachment(buf, 'corrupt.pdf', 0, pdfDetector);
      expect(result.valid).toBe(false);
      expect(result.rejectionCode).toBe('corrupt');
    });
  });

  describe('video validation', () => {
    it('validates MP4 video (ffprobe unavailable → valid)', async () => {
      // In test environment ffprobe likely not available, so should be treated as valid
      const buf = Buffer.alloc(1000, 0);
      const result = await validateAttachment(buf, 'video.mp4', 0, mp4Detector);
      // If ffprobe not available, it should be valid; if available it might fail codec check
      // We just check it's not quota_exceeded/oversize/invalid_type
      if (!result.valid) {
        expect(result.rejectionCode).toBe('codec_unsupported');
      } else {
        expect(result.valid).toBe(true);
        expect(result.kind).toBe('video');
      }
    });
  });
});
