import { buildServer } from './app.js';

const host = process.env.AI_FF_HOST ?? '127.0.0.1';
const port = Number(process.env.AI_FF_PORT ?? 4318);
const app = await buildServer({ logger: true });

await app.listen({ host, port });
