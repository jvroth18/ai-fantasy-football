# Local scheduling

The daemon uses [Croner](https://github.com/Hexagon/croner) with IANA timezones and overlap protection. A SQLite lease adds process-level protection, so a restarted or duplicated daemon cannot run the same team/job pair concurrently. Every attempt is recorded as queued, executing, and then verified, failed, or needing attention.

| Job           | Local schedule                            | Purpose                                                        |
| ------------- | ----------------------------------------- | -------------------------------------------------------------- |
| News refresh  | 17 minutes past each hour                 | Fetch configured feeds and attach player alerts                |
| Data refresh  | 06:15 daily                               | Refresh public player, trend, injury, roster, and model inputs |
| Daily manager | 07:00 daily                               | Recompute lineup, add/drop, waiver, and action priorities      |
| Waiver plan   | Tuesday 18:00                             | Prepare claims before common processing windows                |
| Trade market  | Wednesday 12:00                           | Search for fair outgoing proposals                             |
| Lineup watch  | Every 30 minutes, 08:00–20:59 Sun/Mon/Thu | Recheck news near common NFL game windows                      |

Schedules are evaluated independently in each team's timezone and follow daylight-saving changes. On startup, overdue jobs receive one catch-up run; high-frequency lineup checks do not. Handler errors are bounded and recorded instead of crashing the scheduler, and there are no automatic retry loops.

The process must be running for timers to fire. Catch-up makes laptop sleep and normal local downtime recoverable, but this is not a cloud availability guarantee. Scheduled analysis does not imply scheduled mutation: ESPN actions still require the separate per-team armed policy, exact action permission, and read-back verification.
