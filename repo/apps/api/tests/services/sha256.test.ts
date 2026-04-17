import { sha256Hex } from '../../src/services/sha256';

/**
 * sha256Hex is used for attachment dedup + export CSV checksums. Lock the
 * contract: stable over identical inputs, different for different inputs,
 * deterministic across calls.
 */

describe('sha256Hex', () => {
  it('returns a 64-character lowercase hex string', () => {
    const hex = sha256Hex(Buffer.from('hello'));
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces the known RFC SHA-256 digest for "abc"', () => {
    // Canonical NIST SHA-256 test vector for input "abc".
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
    expect(sha256Hex(Buffer.from('abc'))).toBe(expected);
  });

  it('is deterministic across calls with the same input', () => {
    const buf = Buffer.from('some-attachment-bytes');
    expect(sha256Hex(buf)).toBe(sha256Hex(buf));
  });

  it('returns different hashes for different inputs', () => {
    expect(sha256Hex(Buffer.from('a'))).not.toBe(sha256Hex(Buffer.from('b')));
  });

  it('hashes an empty buffer to the canonical empty digest', () => {
    const expected = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    expect(sha256Hex(Buffer.from([]))).toBe(expected);
  });
});
