# Security policy

Report vulnerabilities privately through GitHub Security Advisories.

The application binds to loopback by default. It must not expose Codex app-server, browser sessions, local datasets, or ESPN actions to a public interface. Authentication remains owned by Codex CLI and ESPN's browser session; this project must never read or copy their credential stores.
