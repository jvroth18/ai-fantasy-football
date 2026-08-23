# Repository working agreements

- Keep every commit focused, independently testable, and green.
- Add or update tests in the same commit as behavior changes.
- Run `pnpm run ci` at subsystem boundaries and before pushing a release.
- Never commit credentials, Codex auth state, browser cookies, ESPN screenshots, or downloaded data.
- Never call undocumented ESPN endpoints or bypass login, MFA, CAPTCHA, or browser warnings.
- Keep deterministic scoring, roster legality, and policy checks outside the language model.
- Preserve strict `teamId` isolation in persistence, jobs, recommendations, and Codex threads.
