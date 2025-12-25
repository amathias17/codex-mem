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

## Notes

- Local data lives in `.codex-mem/`.
- The sqlite database is stored in `.codex-mem/mem.db`.
- Event logs are stored in `.codex-mem/events/events.log`.
