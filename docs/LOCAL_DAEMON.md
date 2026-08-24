# Local daemon

The daemon is the single local control plane for team configuration, data refreshes, scheduled analysis, and future ESPN Computer Use sessions. It binds to `127.0.0.1:4318` by default and stores state in `var/app.sqlite`.

## Configuration

Copy `.env.example` values into your shell or preferred local environment loader. The daemon reads:

- `AI_FF_HOST` and `AI_FF_PORT` for its listener. Keep the host on loopback unless you add a separate authentication layer.
- `AI_FF_DB_PATH` for SQLite. Use `:memory:` only for disposable development runs.
- `AI_FF_WORKSPACE_ROOT` as the directory Codex may inspect during read-only rule extraction.
- `AI_FF_NEWS_FEEDS_JSON` as an optional JSON array of `{ "name", "url" }` feed objects.

No ESPN password, session cookie, or Codex credential is stored in the database or configuration. Codex authentication remains owned by the Codex CLI, and ESPN authentication remains in the user's visible browser session.

## Onboarding contract

1. Create a team with `POST /api/teams`. New teams always begin with browser mutations disarmed.
2. Import rules with `POST /api/teams/:teamId/rules/import`. The JSON body contains `name`, a supported `mimeType`, and `contentBase64`; uploads are capped at 10 MB.
3. Review the returned draft and conflicts. Activate a specific immutable revision with `POST /api/teams/:teamId/rules/:ruleSetId/activate`.
4. Save a strategy with `PUT /api/teams/:teamId/strategy`.
5. Run public data/news jobs or management jobs with `POST /api/teams/:teamId/jobs/:jobType/run`.

JSON rule sets are parsed deterministically. CSV scoring overlays require an existing full rule version. PDF, image, Markdown, and plain-text extraction uses an ephemeral, read-only Codex turn. Binary uploads are written with owner-only permissions inside `var/rule-uploads` and removed after the turn, including on failure.

## Mutation safety

`PUT /api/teams/:teamId/automation` will not transition a team from disarmed to armed unless the request includes the exact confirmation `ARM ESPN AUTOMATION`. Individual action classes remain separately disabled, incoming trade acceptance is structurally prohibited, and the ESPN executor still applies its own policy check and read-back proof.

`GET /api/bootstrap` returns teams, schedules, latest data snapshot metadata, and a sanitized Codex readiness summary. It never returns model descriptions, skill bodies, credentials, or browser session data.
