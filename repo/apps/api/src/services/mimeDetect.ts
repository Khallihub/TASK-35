/**
 * MIME type detection wrapper.
 * file-type v19+ is ESM-only; in Jest/CommonJS environments the dynamic import
 * will fail. This module wraps the detection and falls back to magic-byte
 * sniffing when the ESM import is unavailable.
 */

/**
 * Detect the MIME type of a buffer using magic bytes.
 * Used as a fallback when file-type cannot be loaded (ESM/Jest environments).
 */
function detectMimeFallback(buffer: Buffer): string | undefined {
  if (buffer.length < 4) return undefined;

  const b0 = buffer[0];
  const b1 = buffer[1];
  const b2 = buffer[2];
  const b3 = buffer[3];

  // JPEG: FF D8 FF
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) {
    return 'image/jpeg';
  }

  // PNG: 89 50 4E 47
  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) {
    return 'image/png';
  }

  // WebP: RIFF????WEBP
  if (
    b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 &&
    buffer.length >= 12 &&
    buffer.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }

  // MP4: check ftyp box at offset 4
  if (
    buffer.length >= 8 &&
    buffer.slice(4, 8).toString('ascii') === 'ftyp'
  ) {
    return 'video/mp4';
  }

  // PDF: %PDF
  if (buffer.slice(0, 4).toString('ascii') === '%PDF') {
    return 'application/pdf';
  }

  return undefined;
}

export async function detectMimeType(buffer: Buffer): Promise<string | undefined> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = await import('file-type');
    const { fileTypeFromBuffer } = mod;
    const result = await fileTypeFromBuffer(buffer);
    return result?.mime;
  } catch {
    // ESM module not loadable in current environment (e.g., Jest CommonJS mode)
    // Fall back to magic-byte detection
    return detectMimeFallback(buffer);
  }
}
