import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { FetchLike } from './types.js';
import { digestBytes } from './utils.js';

export type CachedAsset = {
  path: string;
  digest: string;
  byteLength: number;
  reused: boolean;
};

export class LocalDataCache {
  constructor(
    private readonly root: string,
    private readonly fetcher: FetchLike = fetch,
  ) {}

  async download(url: string, relativePath: string): Promise<CachedAsset> {
    const target = join(this.root, relativePath);
    try {
      const existing = await readFile(target);
      return {
        path: target,
        digest: digestBytes(existing),
        byteLength: existing.byteLength,
        reused: true,
      };
    } catch {
      // A cache miss is expected on first seed.
    }

    const response = await this.fetcher(url, {
      headers: { 'user-agent': 'ai-fantasy-football/0.1' },
    });
    if (!response.ok) throw new Error(`Data download failed with HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const temporary = `${target}.partial`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    return {
      path: target,
      digest: digestBytes(bytes),
      byteLength: bytes.byteLength,
      reused: false,
    };
  }
}
