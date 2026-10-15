# How I work with Claude agents

I'm a founder, not a developer. These are the habits that made a team of Claude agents
productive in a real company.

## Setup

- **Claude Code** sessions running on a DGX Spark in the office, one per area of the business,
  each in its own git worktree so they never edit the same files.
- **Reachable from anywhere.** Remote Control from my phone; Slack and Telegram bots for the team.
- **Shared memory in files.** Every agent has a brief (what it owns, what it doesn't, the rules
  it learned the hard way), and the workspace keeps a running handoff doc so a new session can
  pick up where the last one stopped.
- **Data where the team lives.** Agents deliver into the Google Sheet the team already uses,
  not into files nobody opens.

## Rules that came from mistakes

1. **One owner per area.** When two agents could both "fix" the catalogue, they undid each other.
2. **Lessons become guards, not reminders.** If something broke the site, it becomes an automated
   check that refuses to run, not a sentence in a doc.
3. **Verify against the source system.** An agent's report is a claim; the number that matches
   Salesforce or the warehouse to the penny is the answer. More than once the *bot* was right and
   my own query was wrong — the habit is checking, not distrust.
4. **Read-only by default.** Agents read production freely. Anything that sends, buys, deletes or
   changes production settings is drafted for a person to approve.
5. **Check the work zoomed in.** Small previews hide real defects. Look at hands, edges, totals.
6. **Measure the whole population.** One complaint is an anecdote; joining every order is how
   the real cause showed up.
