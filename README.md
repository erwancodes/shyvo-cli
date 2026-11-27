# shyvo

Shyvo from the terminal, for you and your coding agent (Claude Code, Codex, any
agent that runs shell commands). Zero dependencies, Node 20+.

```bash
npx shyvo login          # approve the sign-in in the browser
npx shyvo link my-app    # in your repository: writes shyvo.json (commit it)
npx shyvo skills install # adds the Shyvo skills to .claude/skills and .agents/skills
```

Then ask your agent: "fix issue 2", "triage the new feedback", "add the Shyvo
feedback widget to my app".

## Commands

| Command                                                     | What it does                                     |
| ----------------------------------------------------------- | ------------------------------------------------ |
| `shyvo status`                                              | Token, linked project, visible projects          |
| `shyvo issues list [--status todo]`                         | Issues of the linked project                     |
| `shyvo issues show <ref>`                                   | One issue (`2`, `#2` or `slug#2`)                |
| `shyvo issues create --title ...`                           | New issue in Inbox                               |
| `shyvo issues approve\|revoke\|rework\|cancel\|reopen <ref>` | Product decisions (`issues:approve` scope)       |
| `shyvo fix <ref>`                                           | Issue + user feedback + project context + steps  |
| `shyvo work start\|renew\|complete\|release <ref>`           | Claim, keep alive, hand to PR Review, give up    |
| `shyvo pr link <ref> <pr>`                                  | Link the pull request to the run                 |
| `shyvo comment <ref> <text>`                                | Comment as the agent                             |
| `shyvo feedback list\|show\|triage\|accept\|dismiss\|mark`    | Feedback inbox and AI triage                     |
| `shyvo widget setup\|install [--origin <url>]`               | Feedback widget keys, then install it in the app |
| `shyvo tools` / `shyvo call <tool> --input '{...}'`         | Any Shyvo tool, directly                         |

Every command takes `--json` (machine-readable output), `--project <slug>` and
`--url <site>`.

## Files

- `~/.shyvo/config.json` (mode 0600): the agent token. Override the path with
  `SHYVO_CONFIG`, or skip it with `SHYVO_AGENT_TOKEN`.
- `shyvo.json` in the repository: which project the repository belongs to. No
  secret; commit it.
- `.shyvo/state.json`: the current run and linked PR per issue. Git-ignored.

## What it never does

Merge, deploy, or resolve an issue. Shyvo resolves an issue only when GitHub
reports the reviewed pull request as merged. `shyvo widget install` writes one
component file and the public env values; it does not run `npm install` or
edit your layout, so the change stays in your agent's reviewable diff.

## Security

`shyvo login` creates the token locally and sends only its SHA-256 hash; the
browser approval binds it to your organization with the scopes you choose.
Revoke it any time from the Agents page in Shyvo.
