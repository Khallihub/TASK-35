/**
 * Jest setupFiles hook (runs once per worker before module imports).
 *
 * Seeds deterministic env values so route tests can exercise the real
 * encrypted-filesystem storage pipeline without requiring an explicit
 * `jest.mock('../storage/repository')` in every suite. Each worker gets
 * its own OS temp directory under `STORAGE_PATH`, keeping test files
 * isolated from production data paths and from each other.
 */
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

if (!process.env.STORAGE_PATH) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hs-api-test-storage-'));
  process.env.STORAGE_PATH = dir;
}

if (!process.env.JWT_SECRET) {
  // Deterministic secret long enough to meet KEK derivation length invariants.
  process.env.JWT_SECRET = 'test-jwt-secret-for-deterministic-kek-derivation-32bytes!';
}
