import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

export type ServerOptions = {
  logger?: boolean;
};

export async function buildServer(options: ServerOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(cors, {
    origin: ['http://127.0.0.1:4317', 'http://localhost:4317'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  app.get('/api/health', async () => ({
    status: 'ok',
    service: 'ai-fantasy-football-daemon',
    version: '0.1.0',
  }));

  return app;
}
