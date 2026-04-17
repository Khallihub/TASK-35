import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { encrypt, decrypt, loadKek } from './encryption';

export interface StorageRepository {
  write(key: string, buffer: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

export class LocalFileSystemRepository implements StorageRepository {
  constructor(private readonly basePath: string) {}

  private fullPath(key: string): string {
    return path.join(this.basePath, key);
  }

  async write(key: string, buffer: Buffer): Promise<void> {
    const fullPath = this.fullPath(key);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.writeFile(fullPath, buffer);
  }

  async read(key: string): Promise<Buffer> {
    return fs.promises.readFile(this.fullPath(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.promises.unlink(this.fullPath(key));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.promises.access(this.fullPath(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const dir = this.fullPath(prefix);
    const results: string[] = [];

    async function walk(currentDir: string, basePrefix: string): Promise<void> {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const relativePath = path.join(basePrefix, entry.name).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          await walk(path.join(currentDir, entry.name), relativePath);
        } else {
          results.push(relativePath);
        }
      }
    }

    await walk(dir, prefix);
    return results;
  }
}

export class InMemoryRepository implements StorageRepository {
  private store = new Map<string, Buffer>();

  async write(key: string, buffer: Buffer): Promise<void> {
    this.store.set(key, Buffer.from(buffer));
  }

  async read(key: string): Promise<Buffer> {
    const val = this.store.get(key);
    if (!val) throw new Error(`Key not found: ${key}`);
    return val;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async list(prefix: string): Promise<string[]> {
    const results: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        results.push(key);
      }
    }
    return results;
  }
}

/**
 * Encrypted storage wrapper: AES-256-GCM envelope encryption with per-file DEK
 * wrapped by a KEK. Transparent to callers — encrypt on write, decrypt on read.
 */
export class EncryptedStorageRepository implements StorageRepository {
  constructor(
    private readonly inner: StorageRepository,
    private readonly kek: Buffer,
  ) {}

  async write(key: string, buffer: Buffer): Promise<void> {
    const encrypted = encrypt(buffer, this.kek);
    await this.inner.write(key, encrypted);
  }

  async read(key: string): Promise<Buffer> {
    const encrypted = await this.inner.read(key);
    return decrypt(encrypted, this.kek);
  }

  async delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }

  async list(prefix: string): Promise<string[]> {
    return this.inner.list(prefix);
  }
}

const rawRepository = new LocalFileSystemRepository(config.storage.basePath);
const kek = loadKek();
export const storageRepository: StorageRepository = new EncryptedStorageRepository(rawRepository, kek);
