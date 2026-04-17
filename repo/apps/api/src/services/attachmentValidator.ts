import { execFile } from 'child_process';
import { logger } from '../logger';
import { detectMimeType } from './mimeDetect';

export type RejectionCode =
  | 'invalid_type'
  | 'oversize'
  | 'duplicate'
  | 'corrupt'
  | 'quota_exceeded'
  | 'codec_unsupported';

export interface ValidationResult {
  valid: boolean;
  kind?: 'image' | 'video' | 'pdf';
  rejectionCode?: RejectionCode;
  rejectionDetail?: string;
}

const IMAGE_MAX_BYTES = 12 * 1024 * 1024;   // 12 MB
const VIDEO_MAX_BYTES = 200 * 1024 * 1024;  // 200 MB
const PDF_MAX_BYTES   = 20 * 1024 * 1024;   // 20 MB
const MAX_ATTACHMENTS = 25;

async function defaultMimeDetector(buffer: Buffer): Promise<string | undefined> {
  return detectMimeType(buffer);
}

async function checkVideoCodecs(buffer: Buffer): Promise<{ valid: boolean; detail?: string }> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof execFile>;

    try {
      child = execFile(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-print_format', 'json', '-'],
        { maxBuffer: 10 * 1024 * 1024 },
        (error, stdout) => {
          if (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
              logger.error('ffprobe not found in PATH — rejecting video (fail-closed). Install ffmpeg to enable video uploads.');
              resolve({ valid: false, detail: 'Video codec validation unavailable (ffprobe missing)' });
            } else {
              resolve({
                valid: false,
                detail: 'Video must be H.264/AAC MP4',
              });
            }
            return;
          }

          try {
            const parsed = JSON.parse(stdout) as {
              streams?: Array<{ codec_type: string; codec_name: string }>;
            };
            const streams = parsed.streams ?? [];
            const videoStreams = streams.filter((s) => s.codec_type === 'video');
            const audioStreams = streams.filter((s) => s.codec_type === 'audio');

            const hasH264 = videoStreams.some((s) => s.codec_name === 'h264');
            if (!hasH264) {
              resolve({
                valid: false,
                detail: 'Video must be H.264/AAC MP4',
              });
              return;
            }

            if (audioStreams.length > 0) {
              const hasAac = audioStreams.some((s) => s.codec_name === 'aac');
              if (!hasAac) {
                resolve({
                  valid: false,
                  detail: 'Video must be H.264/AAC MP4',
                });
                return;
              }
            }

            resolve({ valid: true });
          } catch {
            resolve({ valid: false, detail: 'Failed to parse ffprobe output' });
          }
        },
      );

      if (child.stdin) {
        child.stdin.write(buffer);
        child.stdin.end();
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.error('ffprobe not found in PATH — rejecting video (fail-closed). Install ffmpeg to enable video uploads.');
        resolve({ valid: false, detail: 'Video codec validation unavailable (ffprobe missing)' });
      } else {
        resolve({ valid: false, detail: 'Video codec validation failed' });
      }
    }
  });
}

export async function validateAttachment(
  buffer: Buffer,
  filename: string,
  existingCount: number,
  mimeDetector?: (buffer: Buffer) => Promise<string | undefined>,
): Promise<ValidationResult> {
  // Step 1: quota check
  if (existingCount >= MAX_ATTACHMENTS) {
    return { valid: false, rejectionCode: 'quota_exceeded' };
  }

  // Step 2: detect MIME type
  const detectMime = mimeDetector ?? defaultMimeDetector;
  const detectedMime = await detectMime(buffer);

  // Step 3: determine kind
  let kind: 'image' | 'video' | 'pdf';
  let sizeLimit: number;

  if (detectedMime === 'image/jpeg' || detectedMime === 'image/png' || detectedMime === 'image/webp') {
    kind = 'image';
    sizeLimit = IMAGE_MAX_BYTES;
  } else if (detectedMime === 'video/mp4') {
    kind = 'video';
    sizeLimit = VIDEO_MAX_BYTES;
  } else if (detectedMime === 'application/pdf') {
    kind = 'pdf';
    sizeLimit = PDF_MAX_BYTES;
  } else {
    return {
      valid: false,
      rejectionCode: 'invalid_type',
      rejectionDetail: `Detected MIME: ${detectedMime ?? 'unknown'}`,
    };
  }

  // Step 4: size check
  if (buffer.length > sizeLimit) {
    return { valid: false, rejectionCode: 'oversize' };
  }

  // Step 5: PDF header check
  if (kind === 'pdf') {
    const pdfMagic = Buffer.from('%PDF');
    if (!buffer.slice(0, 4).equals(pdfMagic)) {
      return { valid: false, rejectionCode: 'corrupt' };
    }
  }

  // Step 6: video codec check
  if (kind === 'video') {
    const codecResult = await checkVideoCodecs(buffer);
    if (!codecResult.valid) {
      return {
        valid: false,
        rejectionCode: 'codec_unsupported',
        rejectionDetail: codecResult.detail,
      };
    }
  }

  return { valid: true, kind };
}
