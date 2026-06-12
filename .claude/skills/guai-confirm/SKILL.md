---
name: guai-confirm
description: Review and approve the outward actions Guai has drafted (emails, PR comments, etc.). Nothing leaves Guai without going through here.
---

# /guai-confirm

This is the propose-and-confirm choke point — the ONLY path by which Guai takes an outward
action. Work from `D:/Google AI/guai`.

1. **List.** Run `node scripts/list-actions.mjs` to get the pending queue (it auto-expires
   stale items). If empty, say so and stop.

2. **Present each action** clearly to the user: the `kind`, the drafted `payload` verbatim
   (e.g. the full email to/subject/body), the `rationale`, and the finding that triggered it.
   Ask the user to **approve, edit, or reject** — one at a time.

3. **On approve** (using the latest edited payload if the user changed it), execute exactly
   the one outward action:
   - `send_email` → the Gmail MCP send tool.
   - `github_comment` / `push_commit` → the GitHub REST API (or `git`) with the user's token.
   - `calendar_event` → the Calendar MCP tool.
   Then record it: `node scripts/decide-action.mjs --id=<N> --status=executed --result='<json>'`.

4. **On reject** → `node scripts/decide-action.mjs --id=<N> --status=rejected`.

5. **Summarize** what was executed vs rejected.

Execute outward actions only after explicit approval. Never batch-approve without showing
each payload. If an execution fails, record `--status=failed` with the error and tell the user.
