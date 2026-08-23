import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LocalDataCache } from './cache.js';

describe('local data cache', () => {
  it('writes atomically once and reuses the local asset', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ai-ff-cache-'));
    let requests = 0;
    const cache = new LocalDataCache(directory, async () => {
      requests += 1;
      return new Response('dataset');
    });

    const first = await cache.download('https://example.com/data', 'nflverse/data.csv');
    const second = await cache.download('https://example.com/data', 'nflverse/data.csv');

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(requests).toBe(1);
    await expect(readFile(first.path, 'utf8')).resolves.toBe('dataset');
  });
});
