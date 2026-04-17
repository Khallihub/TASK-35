import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEK_LENGTH = 32; // 256 bits

/**
 * Envelope encryption: each file gets a random DEK (Data Encryption Key).
 * The DEK is wrapped (encrypted) by the KEK (Key Encryption Key).
 * The encrypted blob is: [wrappedDEK (48 bytes)] [IV (12)] [authTag (16)] [ciphertext]
 *
 * Header layout (76 bytes fixed):
 *   Bytes 0-47:   Wrapped DEK (AES-256-GCM encrypted DEK using KEK)
 *   Bytes 48-59:  IV for data encryption
 *   Bytes 60-75:  Auth tag from data encryption
 *   Bytes 76+:    Ciphertext
 */

/** Wrap a DEK with the KEK using AES-256-GCM. Returns 48 bytes: [iv(12)][tag(16)][encDek(20..32)] */
function wrapDek(dek: Buffer, kek: Buffer): Buffer {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, kek, iv);
  const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();
  // [iv(12)][tag(16)][encryptedDek(32)] = 60 bytes
  return Buffer.concat([iv, tag, encrypted]);
}

/** Unwrap a DEK from its wrapped form using KEK. */
function unwrapDek(wrapped: Buffer, kek: Buffer): Buffer {
  const iv = wrapped.subarray(0, IV_LENGTH);
  const tag = wrapped.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encDek = wrapped.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encDek), decipher.final()]);
}

const WRAPPED_DEK_SIZE = IV_LENGTH + AUTH_TAG_LENGTH + DEK_LENGTH; // 60 bytes
const HEADER_SIZE = WRAPPED_DEK_SIZE + IV_LENGTH + AUTH_TAG_LENGTH; // 60 + 12 + 16 = 88 bytes

export function encrypt(plaintext: Buffer, kek: Buffer): Buffer {
  // Generate random DEK
  const dek = crypto.randomBytes(DEK_LENGTH);

  // Wrap DEK with KEK
  const wrappedDek = wrapDek(dek, kek);

  // Encrypt data with DEK
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Assemble: [wrappedDek][iv][authTag][ciphertext]
  return Buffer.concat([wrappedDek, iv, authTag, ciphertext]);
}

export function decrypt(blob: Buffer, kek: Buffer): Buffer {
  if (blob.length < HEADER_SIZE) {
    throw new Error('Encrypted blob too short');
  }

  // Parse header
  const wrappedDek = blob.subarray(0, WRAPPED_DEK_SIZE);
  const iv = blob.subarray(WRAPPED_DEK_SIZE, WRAPPED_DEK_SIZE + IV_LENGTH);
  const authTag = blob.subarray(WRAPPED_DEK_SIZE + IV_LENGTH, HEADER_SIZE);
  const ciphertext = blob.subarray(HEADER_SIZE);

  // Unwrap DEK
  const dek = unwrapDek(wrappedDek, kek);

  // Decrypt data
  const decipher = crypto.createDecipheriv(ALGORITHM, dek, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Derive the KEK from environment. Falls back to a key derived from JWT_SECRET
 * for backward compatibility if STORAGE_KEK is not set.
 */
export function loadKek(): Buffer {
  const kekHex = process.env.STORAGE_KEK;
  if (kekHex) {
    const buf = Buffer.from(kekHex, 'hex');
    if (buf.length !== 32) {
      throw new Error('STORAGE_KEK must be 64 hex characters (256 bits)');
    }
    return buf;
  }

  // Derive from JWT_SECRET as fallback (not ideal but ensures encryption is always on)
  const secret = process.env.JWT_SECRET ?? 'CHANGE_ME_BEFORE_GOING_LIVE_32chars';
  return crypto.createHash('sha256').update(`harborstone-kek:${secret}`).digest();
}
