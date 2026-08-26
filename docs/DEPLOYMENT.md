# Deployment readiness

The production build serves the React application and Fastify API from one process. SQLite must live on a persistent volume.

## Local production smoke test

```bash
pnpm install --frozen-lockfile
pnpm run ci
pnpm start
```

The combined service runs at `http://127.0.0.1:4318` by default. `GET /api/health` is the readiness endpoint.

## Container

```bash
docker build -t league-house .
docker run --rm -p 8080:8080 -v league-house-data:/data league-house
```

## Security boundary

Do not expose the current container directly to the public internet. The local product has team isolation but does not yet have hosted authentication or authorization. Put it behind private access for preview use.

Codex and visible ESPN browser automation remain local-machine capabilities. A generic hosted container can serve the social feed, members, posts, cached news, and advanced tools, but cannot claim live ESPN or AI readiness unless the deployment provides the supported Codex runtime and visible authenticated browser session.

Public deployment requires a hosted identity layer, authenticated league membership, authorization on every team route, invite-token expiry, rate limiting, and a managed persistent database. Those are release gates, not optional hardening.
