# Fan Network

Fan Network is the configurable orchestration layer behind Fan Desk. Each fantasy team owns one independent network definition, event log, and agent-run log. A network is a small directed graph:

```text
observations -> signals -> analysis -> voices -> approval -> publisher
                         \-> contrarian voice
mentions -----------------> reply writer -> approval
```

The graph is stored with the team, so changing one league's agents or policies cannot change another league's behavior.

## Configuration

Open a team's **Agent network** tab to edit the graph, enable or disable agents, choose a provider/model, and set safety limits. The same contract is available over HTTP:

- `GET /api/teams/:teamId/fan-network` reads the saved graph and recent event/run trace.
- `PUT /api/teams/:teamId/fan-network` replaces the graph configuration.
- `POST /api/teams/:teamId/fan-network/events` injects a team-scoped event such as `fan.mention.received`.

Agents declare their `role`, `instructions`, `model`, `listensTo`, and `emits` event types. Supported provider labels are `codex`, `openai`, `ollama`, `http`, and `none`. A provider label is configuration, not a secret: credentials stay in the local daemon environment and are never written into the network record.

The default network includes:

- `scout` for ESPN/news observations;
- `analyst` for evidence-backed analysis;
- `superfan` and `contrarian` for distinct voices;
- `commissioner` for approval and AI-label enforcement;
- `publisher` for the final publication event.

## Runtime and interaction

Every injected or scheduled event is persisted before any agent runs. Each routed agent gets a queued, executing, and terminal run record. Events include a correlation id, source agent, payload, and source evidence. Replaying the same event is idempotent per event/agent pair.

The daemon currently ships with a deterministic fallback executor so the graph can be tested offline. `FanNetworkService` accepts a `FanAgentExecutor` adapter for model-backed execution; that seam is where Codex, OpenAI, Ollama, or a local HTTP model can be connected without changing storage, routing, or the UI. Fan Desk's existing Codex writer remains the production path for generated bulletins when Codex is available.

Policy defaults require evidence, identify generated copy as AI, cap turns/replies/spend, forbid invented injuries, and forbid accepting trades. Treat these as guardrails for a lively fan environment, not as permission to mutate ESPN state. The network is commentary-only and never bypasses sign-in, MFA, browser warnings, or the explicit ESPN action confirmation flow.

## Local testing

Run the daemon and web app locally with `pnpm dev`, create two teams, and open **Agent network** on each. Use **Test fan mention** to emit a local interaction event and inspect the event/run trace. No external post or email is sent by that button.
