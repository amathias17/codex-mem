# codex-mem

Minimal memory system scaffold for OpenAI Codex workflows.

## Quick start

```bash
npm install
npm run build
node dist/cli.js init
node dist/cli.js capture --kind decision --title "Build tool" --body "Use tsconfig + sql.js"
node dist/cli.js retrieve "build tool" --limit 5
node dist/cli.js inject --query "build tool"
```

## Retrieve formats

```bash
node dist/cli.js retrieve "query" --format index
node dist/cli.js retrieve "query" --format full
node dist/cli.js retrieve "query" --json
```

## Worker + hooks

Start the worker:

```bash
npm run worker
```

## Compression

Observations are compressed before storage. The current compressor is heuristic-only
and truncates to a max length (default 800 chars) while inferring tags and type.
You can override the limit with `CODEX_MEM_MAX_OBSERVATION_CHARS`.

## Privacy tags

Wrap sensitive content in `<private>...</private>` or `<codex-mem-context>...</codex-mem-context>`.
Hook scripts and the worker strip these tags before storing prompts, observations, and summaries.

Hook scripts (run by your Codex lifecycle integration):

```bash
node dist/hooks/session-start.js
node dist/hooks/codex-session-start.js
node dist/hooks/prompt-submit.js
node dist/hooks/post-tool-use.js
node dist/hooks/codex-post-tool-use.js
node dist/hooks/stop.js
node dist/hooks/session-end.js
```

Each hook accepts JSON on stdin. Fields:
- `session-start`: `codex_session_id`, `project_id`
- `codex-session-start`: accepts Codex session payloads (including nested `payload`/`data`) and forwards `project_id` + `codex_session_id`
- `prompt-submit`: `session_id`, `project_id`, `prompt_text`, `prompt_number`
- `post-tool-use`: `session_id`, `project_id`, `prompt_number`, `type`, `title`, `body`, `tags`, `files_read`, `files_modified`
- `codex-post-tool-use`: accepts Codex tool payloads and forwards an observation (tool name + input/output)
- `stop`: `session_id`, `project_id`, `prompt_number`, `title`, `body`
- `session-end`: `session_id`, `status`

Set `CODEX_MEM_HOOK_DEBUG=1` to log raw hook payloads to `.codex-mem/hooks.log`.

Codex CLI notify hook (agent-turn-complete):
- `codex-notify`: expects a JSON payload argument from `notify = ["node", "dist/hooks/codex-notify.js"]` and forwards a summarized observation.

The worker URL defaults to `http://localhost:37777` and can be overridden with `CODEX_MEM_URL`.

## Notes

- Local data lives in `.codex-mem/`.
- The sqlite database is stored in `.codex-mem/mem.db`.
- Event logs are stored in `.codex-mem/events/events.log`.
