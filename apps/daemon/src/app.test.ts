import { afterEach, describe, expect, it } from 'vitest';

import { buildServer } from './app.js';

const servers: Awaited<ReturnType<typeof buildServer>>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('daemon health', () => {
  it('reports a loopback-ready service', async () => {
    const app = await buildServer();
    servers.push(app);

    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'ai-fantasy-football-daemon' });
  });
});
