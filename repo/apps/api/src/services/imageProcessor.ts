import sharp from 'sharp';

export interface ProcessedImage {
  buffer: Buffer;
  width: number;
  height: number;
  mime: 'image/jpeg' | 'image/webp';
  bytes: number;
}

const MAX_LONG_EDGE = 2048;

export async function processImage(
  inputBuffer: Buffer,
  originalMime: string,
): Promise<ProcessedImage> {
  // Step 1: Auto-rotate from EXIF orientation (applies rotation based on Orientation tag,
  // then discards the EXIF). In sharp, .rotate() without angle reads from EXIF.
  // By default sharp does NOT copy metadata to the output, so EXIF is stripped.
  const rotated = await sharp(inputBuffer).rotate().toBuffer();

  // Step 2: Get metadata to check dimensions of the rotated image
  const metadata = await sharp(rotated).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  // Step 3: Build pipeline for resize + output (NO withMetadata - this is the key to strip EXIF)
  let pipeline = sharp(rotated);

  // Step 4: Resize if long edge > 2048
  if (Math.max(width, height) > MAX_LONG_EDGE) {
    pipeline = pipeline.resize({
      width: MAX_LONG_EDGE,
      height: MAX_LONG_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  // Step 5: Output format — do NOT call withMetadata() so sharp strips all EXIF/metadata
  let outputBuffer: Buffer;
  let outputMime: 'image/jpeg' | 'image/webp';

  if (originalMime === 'image/webp') {
    outputBuffer = await pipeline.webp({ quality: 85 }).toBuffer();
    outputMime = 'image/webp';
  } else {
    // jpeg and png both output as JPEG
    outputBuffer = await pipeline.jpeg({ quality: 85 }).toBuffer();
    outputMime = 'image/jpeg';
  }

  // Get final dimensions
  const outMeta = await sharp(outputBuffer).metadata();

  return {
    buffer: outputBuffer,
    width: outMeta.width ?? 0,
    height: outMeta.height ?? 0,
    mime: outputMime,
    bytes: outputBuffer.length,
  };
}
