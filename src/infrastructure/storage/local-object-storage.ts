import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ObjectStorage } from '@/domain/ports';

/**
 * V0.1 object storage: plain local files. The `ObjectStorage` port stays in the
 * domain so a cloud implementation can be added later without touching domain
 * or application code. No COS/S3/R2 SDK is present in this project.
 */
export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root?: string) {
    const configured = root ?? process.env.LLA_STORAGE_DIR ?? './data/objects';
    this.root = resolve(process.cwd(), configured);
  }

  /**
   * Resolves a key inside the storage root and rejects traversal attempts
   * (`../`, absolute paths, symlink-style escapes).
   */
  private resolveKey(key: string): string {
    const cleaned = key.replace(/\\/g, '/').replace(/^\/+/, '');
    if (cleaned.length === 0) throw new Error('Storage key must not be empty');
    const target = resolve(this.root, cleaned);
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('Invalid storage key');
    }
    return target;
  }

  async put(key: string, data: Uint8Array | string): Promise<{ key: string }> {
    const target = this.resolveKey(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, typeof data === 'string' ? data : Buffer.from(data));
    return { key };
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(this.resolveKey(key));
      return new Uint8Array(buffer);
    } catch {
      return null;
    }
  }

  async getText(key: string): Promise<string | null> {
    try {
      return await readFile(this.resolveKey(key), 'utf8');
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolveKey(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolveKey(key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = prefix.length > 0 ? this.resolveKey(prefix) : this.root;
    try {
      const entries = await readdir(base, { withFileTypes: true, recursive: true });
      return entries
        .filter((entry) => entry.isFile())
        .map((entry) => {
          const parent = (entry as unknown as { parentPath?: string; path?: string }).parentPath ??
            (entry as unknown as { path?: string }).path ??
            base;
          return relative(this.root, join(parent, entry.name)).split(sep).join('/');
        });
    } catch {
      return [];
    }
  }
}
