# League House implementation status

_Updated August 26, 2026 · implementation baseline `5e9e5cc`_

## Product direction

League House has been distilled into a fantasy-football fan experience: connect a league, choose an AI host, add league members, and return to a shared feed of league conversation, AI commentary, and relevant football news.

The everyday product now has four primary destinations:

1. **League feed** — the shared front page.
2. **AI setup** — the short host-configuration flow.
3. **Members** — local member profiles and participation.
4. **Archive** — the deeper manager and automation tools that remain available without crowding the core experience.

## Experience implemented

### Editorial league feed

- Reworked the feed into a light, newspaper-inspired layout with a masthead, edition line, activity strip, lead stories, league dispatches, and a trending-news rail.
- Replaced the previous dark, futuristic treatment with warm paper surfaces, ink typography, muted editorial green, square controls, restrained shadows, and tighter gutters.
- Reduced excess whitespace around headers and the former digest treatment. The roster proof is now shown as a compact **Roster snapshot**.
- Added dynamic filters for **For you**, **League talk**, and **NFL news**.
- Added truthful source freshness instead of presenting news as live when no current snapshot exists.
- Prioritized news that matches players in the latest stored ESPN roster before showing general NFL headlines.

### Simplified first-run setup

- Reduced onboarding to creating a team and then completing three understandable steps:
  1. connect ESPN league activity;
  2. choose the AI personality;
  3. add football news.
- A first news refresh is attempted automatically after team creation.
- Removed claims that a working hosted invitation link exists in the local preview.
- Moved the previous manager dashboard, player intelligence, rules, strategy, automation, and agent-network views into **Archive**.

### AI host experience

- Replaced the dense Fan Desk form with four personality presets: **Superfan**, **Contrarian**, **Analyst**, and **Commissioner**.
- Kept desk name and posting rhythm in the primary setup surface.
- Moved energy and delivery settings into a collapsed advanced section.
- Prevented bulletin generation until the host has actually been configured and saved.
- Removed the implicit ESPN browser sync from commentary generation. AI posts use stored observations and current news, so generating commentary cannot unexpectedly trigger a browser operation.
- Corrected Codex thread startup to match the advertised non-experimental protocol capability.

### Unified source refresh

`POST /api/teams/:teamId/feed/refresh` now coordinates the feed update from one action:

- read-only ESPN sync when the supported browser integration is available;
- public news refresh;
- AI commentary generation when the host is configured.

Each step reports `complete`, `skipped`, or `needs_attention`. Partial source failures no longer prevent successful steps from updating the feed.

### Durable local conversation

- Added persisted league reactions and comments in SQLite.
- Added team-scoped API routes for toggling reactions and adding replies.
- Validated that reaction and comment targets exist in the selected team.
- Added local posting identity selection when a league has multiple members.
- Added inline reply forms, reaction counts, comment counts, and persisted conversation threads.
- Verified that reactions and comments survive a full browser reload.

## Data and API changes

- Added `league_reactions` and `league_comments` tables through schema migration 9.
- Enforced one reaction per member and feed target.
- Kept all social reads and writes strictly scoped by `teamId`.
- Added `configured` to Fan Desk state so setup and empty-feed behavior reflect persisted configuration.
- Added `newsUpdatedAt` to team detail responses for honest freshness labels.
- Added feed refresh, reaction, and comment methods to the web API client.

## Safety boundaries retained

- ESPN connection remains read-only by default.
- Consequential ESPN actions remain behind the existing policy and confirmation controls.
- AI-authored posts are labeled as AI and retain their evidence references.
- Deterministic rules, roster legality, and action policy checks remain outside the language model.
- No credentials, browser cookies, ESPN screenshots, or downloaded user data were committed.

## Verification completed

- Full repository CI passed:
  - formatting;
  - ESLint and Ruff;
  - all TypeScript checks;
  - 121 automated tests across the web app, daemon, packages, and analytics service;
  - complete production build.
- Live browser QA covered:
  - the light editorial feed;
  - simplified AI setup and personality editing;
  - durable reactions and replies after reload;
  - the unified source refresh moving through its busy state and publishing a new AI dispatch.
- Production runtime smoke checks confirmed the combined web/API process and `GET /api/health`.
- Commit `5e9e5cc18f5a1d81478713f5b484556494cc326e` was pushed to `origin/main` and verified against the remote ref.

## Current limitations and release gates

- Member profiles are local. There is no hosted authentication, authorization, or invitation redemption yet.
- The local preview deliberately does not issue a fake shareable invitation URL.
- A public deployment still requires authenticated league membership, expiring invite tokens, authorization on every team route, rate limiting, and managed persistent storage.
- Codex generation and visible ESPN browser sync require their supported local runtimes. A generic hosted container cannot claim those capabilities without equivalent integrations.
- The last container smoke attempt was blocked by Docker Desktop's own storage layer returning filesystem I/O errors. Native CI, the production build, and the running service passed; the Docker failure was not an application build failure.

## Recommended next slice

Build the hosted multi-user boundary without expanding the primary navigation:

1. Add authentication and durable user identities.
2. Add expiring, single-league invitation links and redemption.
3. Authorize every read and write against league membership.
4. Move production persistence from local SQLite to a managed database.
5. Add notification preferences for important league events, replies, and AI posts.

Until that boundary exists, League House is ready as a polished local/private preview, not as a public multi-tenant service.
