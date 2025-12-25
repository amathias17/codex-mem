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

## Worker + hooks

Start the worker:

```bash
npm run worker
```

## Compression

Observations are compressed before storage. The current compressor is heuristic-only
and truncates to a max length (default 800 chars) while inferring tags and type.
You can override the limit with `CODEX_MEM_MAX_OBSERVATION_CHARS`.

Hook scripts (run by your Codex lifecycle integration):

```bash
node dist/hooks/session-start.js
node dist/hooks/prompt-submit.js
node dist/hooks/post-tool-use.js
node dist/hooks/stop.js
node dist/hooks/session-end.js
```

Each hook accepts JSON on stdin. Fields:
- `session-start`: `codex_session_id`, `project_id`
- `prompt-submit`: `session_id`, `project_id`, `prompt_text`, `prompt_number`
- `post-tool-use`: `session_id`, `project_id`, `prompt_number`, `type`, `title`, `body`, `tags`, `files_read`, `files_modified`
- `stop`: `session_id`, `project_id`, `prompt_number`, `title`, `body`
- `session-end`: `session_id`, `status`

The worker URL defaults to `http://localhost:37777` and can be overridden with `CODEX_MEM_URL`.

## Notes

- Local data lives in `.codex-mem/`.
- The sqlite database is stored in `.codex-mem/mem.db`.
- Event logs are stored in `.codex-mem/events/events.log`.
