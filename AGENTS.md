# Agent Instructions

This project uses **bd (beads)** for issue tracking. Run `bd prime` for workflow context, or install hooks (`bd hooks install`) for auto-injection.

## File Writes

You have permission to write files directly in this repo without asking first.

## Issue Tracking

**Quick reference:**
- `bd ready` - Find unblocked work
- `bd create "Title" --type task --priority 2` - Create issue
- `bd close <id>` - Complete work
- `bd sync` - Sync with git (run at session end)

For full workflow details: `bd prime`

## MCP Usage (Efficient Order)

Use these MCPs in this order for new work:
1) `list_mcp_resources` and `list_mcp_resource_templates` to confirm what is available.
2) `mcp__deepwiki__ask_question` to pull authoritative repo-specific behavior and schemas.
3) `mcp__context7__resolve-library-id` then `mcp__context7__get-library-docs` for library-specific API details.
4) `mcp__sequential-thinking__sequentialthinking` for short planning (3-5 bullets max).

How to use:
- DeepWiki: Ask for table schemas, lifecycle hooks, or architectural patterns.
- Context7: Resolve the library first, then fetch docs for the exact topic.
- Astro docs: Skipped for this project per instruction.
- Playwright: Skipped for this project per instruction.

Required MCP workflow:
- Always run `list_mcp_resources` and `list_mcp_resource_templates` first.
- Use `mcp__deepwiki__ask_question` before any schema or architecture changes.
- Use `mcp__context7__resolve-library-id` + `mcp__context7__get-library-docs` before using unfamiliar library APIs.
- Do not run `mcp__astrodocs__search_astro_docs` for this project.
- Do not run Playwright MCPs for this project.
- Use `mcp__sequential-thinking__sequentialthinking` only for short planning (3–5 bullets).

## Beads Task Completion Workflow

Every time a beads task is completed, follow this exact sequence:
1) Update code/docs/tests and `memory.jsonl`/`README.md` as needed
2) Run `npm run build` (or relevant tests)
3) `git add -A`
4) `git commit -m "..."`
5) `bd sync`
6) `git pull --rebase`
7) `git push`

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
