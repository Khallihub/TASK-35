import sharp from 'sharp';
import { processImage } from '../../src/services/imageProcessor';

async function createTestJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function createTestPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 255, b: 0 },
    },
  })
    .png()
    .toBuffer();
}

async function createTestWebp(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  })
    .webp()
    .toBuffer();
}

describe('processImage', () => {
  it('processes JPEG: output is valid JPEG with no EXIF marker', async () => {
    const input = await createTestJpeg(100, 80);
    const result = await processImage(input, 'image/jpeg');

    expect(result.mime).toBe('image/jpeg');
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.buffer.length).toBe(result.bytes);

    // Valid JPEG starts with FF D8
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);

    // Should NOT contain EXIF marker FF E1
    let hasExif = false;
    for (let i = 0; i < result.buffer.length - 1; i++) {
      if (result.buffer[i] === 0xff && result.buffer[i + 1] === 0xe1) {
        hasExif = true;
        break;
      }
    }
    expect(hasExif).toBe(false);
  });

  it('processes PNG → output is JPEG', async () => {
    const input = await createTestPng(100, 80);
    const result = await processImage(input, 'image/png');

    expect(result.mime).toBe('image/jpeg');
    // Valid JPEG
    expect(result.buffer[0]).toBe(0xff);
    expect(result.buffer[1]).toBe(0xd8);
  });

  it('processes WebP → output is WebP', async () => {
    const input = await createTestWebp(100, 80);
    const result = await processImage(input, 'image/webp');

    expect(result.mime).toBe('image/webp');
    // WebP starts with RIFF
    expect(result.buffer.slice(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('resizes image with long edge > 2048 so that long edge = 2048', async () => {
    // Create 3000x1000 image (long edge = 3000)
    const input = await createTestJpeg(3000, 1000);
    const result = await processImage(input, 'image/jpeg');

    const longEdge = Math.max(result.width, result.height);
    expect(longEdge).toBe(2048);
  });

  it('does not enlarge image with long edge < 2048', async () => {
    // Create 100x80 image (long edge = 100)
    const input = await createTestJpeg(100, 80);
    const result = await processImage(input, 'image/jpeg');

    expect(result.width).toBe(100);
    expect(result.height).toBe(80);
  });

  it('resizes portrait image (height > width > 2048)', async () => {
    // Create 1000x3000 image (long edge = 3000, portrait)
    const input = await createTestJpeg(1000, 3000);
    const result = await processImage(input, 'image/jpeg');

    const longEdge = Math.max(result.width, result.height);
    expect(longEdge).toBe(2048);
    // Aspect ratio preserved: width/height should be ~1000/3000 = 1/3
    expect(result.width).toBeLessThan(result.height);
  });

  it('output dimensions do not exceed 2048 on long edge', async () => {
    const input = await createTestJpeg(2500, 2500);
    const result = await processImage(input, 'image/jpeg');

    expect(result.width).toBeLessThanOrEqual(2048);
    expect(result.height).toBeLessThanOrEqual(2048);
  });

  it('returns correct width and height metadata', async () => {
    const input = await createTestJpeg(400, 300);
    const result = await processImage(input, 'image/jpeg');

    expect(result.width).toBe(400);
    expect(result.height).toBe(300);
  });
});
