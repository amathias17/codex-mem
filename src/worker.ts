import http from "http";
import { loadConfig } from "./config";
import {
  openDb,
  saveDb,
  insertSession,
  insertUserPrompt,
  insertObservation,
  insertSessionSummary,
  updateSessionStatus,
  getObservation,
  listObservations,
  listProjects,
  listSessionSummaries
} from "./db";
import { redactText, stripTags } from "./redaction";
import { compressObservation } from "./compress";

const PORT = Number(process.env.CODEX_MEM_PORT || 37777);

const VIEWER_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>codex-mem viewer</title>
    <style>
      :root {
        --ink: #0b1220;
        --muted: #4a5b73;
        --accent: #f2c14e;
        --accent-2: #2bb3a3;
        --panel: rgba(255, 255, 255, 0.86);
        --panel-strong: rgba(255, 255, 255, 0.95);
        --shadow: 0 18px 50px rgba(11, 18, 32, 0.2);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 20% 20%, rgba(242, 193, 78, 0.35), transparent 55%),
          radial-gradient(circle at 80% 10%, rgba(43, 179, 163, 0.4), transparent 50%),
          linear-gradient(145deg, #f5f0e7 0%, #e9f0f6 45%, #f5f5fb 100%);
        min-height: 100vh;
      }

      header {
        padding: 32px 40px 10px;
        display: flex;
        flex-wrap: wrap;
        align-items: flex-end;
        gap: 16px 32px;
      }

      header h1 {
        margin: 0;
        font-size: clamp(1.8rem, 2vw + 1rem, 2.8rem);
        letter-spacing: -0.03em;
      }

      header p {
        margin: 6px 0 0;
        color: var(--muted);
        max-width: 420px;
      }

      .controls {
        margin-left: auto;
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        align-items: center;
      }

      .controls select,
      .controls button {
        border-radius: 999px;
        border: 1px solid rgba(11, 18, 32, 0.1);
        padding: 8px 14px;
        font-size: 0.95rem;
        background: var(--panel-strong);
        cursor: pointer;
      }

      .controls button {
        background: var(--ink);
        color: #fff;
        border: none;
      }

      .controls button.secondary {
        background: transparent;
        color: var(--ink);
        border: 1px solid rgba(11, 18, 32, 0.2);
      }

      main {
        display: grid;
        grid-template-columns: minmax(260px, 1fr) minmax(320px, 1.4fr);
        gap: 24px;
        padding: 20px 40px 50px;
      }

      .panel {
        background: var(--panel);
        backdrop-filter: blur(12px);
        border-radius: 24px;
        box-shadow: var(--shadow);
        padding: 22px;
        min-height: 60vh;
      }

      .panel h2 {
        margin-top: 0;
        font-size: 1.2rem;
      }

      .list {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-top: 16px;
      }

      .card {
        border-radius: 18px;
        padding: 14px 16px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(11, 18, 32, 0.08);
        cursor: pointer;
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }

      .card:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 30px rgba(11, 18, 32, 0.18);
      }

      .card.active {
        border-color: var(--accent-2);
        box-shadow: 0 0 0 2px rgba(43, 179, 163, 0.2);
      }

      .card .meta {
        font-size: 0.8rem;
        color: var(--muted);
      }

      .card .title {
        font-weight: 600;
        margin: 6px 0 4px;
      }

      .tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-top: 8px;
      }

      .tag {
        background: rgba(242, 193, 78, 0.2);
        color: #624300;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: 0.75rem;
      }

      .detail pre {
        white-space: pre-wrap;
        font-family: "IBM Plex Mono", "Segoe UI", monospace;
        font-size: 0.9rem;
        line-height: 1.5;
        background: rgba(11, 18, 32, 0.06);
        padding: 16px;
        border-radius: 16px;
      }

      .empty {
        color: var(--muted);
        margin-top: 24px;
      }

      .footer-actions {
        display: flex;
        gap: 10px;
        margin-top: 16px;
      }

      @media (max-width: 920px) {
        main {
          grid-template-columns: 1fr;
        }
        .panel {
          min-height: auto;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div>
        <h1>codex-mem viewer</h1>
        <p>Peek into what the worker is storing: tool observations and session summaries.</p>
      </div>
      <div class="controls">
        <select id="projectSelect">
          <option value="">All projects</option>
        </select>
        <button id="refreshBtn">Refresh</button>
        <button id="toggleBtn" class="secondary">Show summaries</button>
      </div>
    </header>
    <main>
      <section class="panel">
        <h2 id="listTitle">Observations</h2>
        <div class="list" id="list"></div>
        <div class="empty" id="emptyState">No entries yet.</div>
        <div class="footer-actions">
          <button id="loadMoreBtn" class="secondary">Load more</button>
        </div>
      </section>
      <section class="panel detail">
        <h2>Detail</h2>
        <div id="detail">
          <p class="empty">Select a memory to inspect the full payload.</p>
        </div>
      </section>
    </main>
    <script>
      const state = {
        kind: 'observations',
        project: '',
        offset: 0,
        limit: 25,
        items: [],
        activeId: null
      };

      const listEl = document.getElementById('list');
      const detailEl = document.getElementById('detail');
      const emptyEl = document.getElementById('emptyState');
      const listTitle = document.getElementById('listTitle');
      const projectSelect = document.getElementById('projectSelect');
      const toggleBtn = document.getElementById('toggleBtn');
      const refreshBtn = document.getElementById('refreshBtn');
      const loadMoreBtn = document.getElementById('loadMoreBtn');

      function formatTime(epoch) {
        if (!epoch) return 'unknown time';
        const date = new Date(epoch);
        return date.toLocaleString();
      }

      function createTag(label) {
        const span = document.createElement('span');
        span.className = 'tag';
        span.textContent = label;
        return span;
      }

      function renderList() {
        listEl.innerHTML = '';
        emptyEl.style.display = state.items.length ? 'none' : 'block';
        state.items.forEach((item) => {
          const card = document.createElement('div');
          card.className = 'card' + (item.id === state.activeId ? ' active' : '');
          card.addEventListener('click', () => selectItem(item.id));

          const meta = document.createElement('div');
          meta.className = 'meta';
          meta.textContent = formatTime(item.created_at_epoch) + ' · ' + (item.project_id || 'unknown project');
          card.appendChild(meta);

          const title = document.createElement('div');
          title.className = 'title';
          title.textContent = item.title || '(untitled)';
          card.appendChild(title);

          if (item.preview) {
            const preview = document.createElement('div');
            preview.className = 'meta';
            preview.textContent = item.preview;
            card.appendChild(preview);
          }

          if (item.tags && item.tags.length) {
            const tags = document.createElement('div');
            tags.className = 'tags';
            item.tags.slice(0, 5).forEach((tag) => tags.appendChild(createTag(tag)));
            card.appendChild(tags);
          }

          listEl.appendChild(card);
        });
      }

      function renderDetail(item) {
        if (!item) {
          detailEl.innerHTML = '<p class="empty">Select a memory to inspect the full payload.</p>';
          return;
        }
        const html = [
          '<h3>' + item.title + '</h3>',
          '<p class="meta">' + formatTime(item.created_at_epoch) + ' · ' + (item.project_id || 'unknown project') + '</p>',
          '<pre>' + (item.body || '') + '</pre>'
        ];
        if (item.files_read && item.files_read.length) {
          html.push('<p class="meta">Files read: ' + item.files_read.join(', ') + '</p>');
        }
        if (item.files_modified && item.files_modified.length) {
          html.push('<p class="meta">Files modified: ' + item.files_modified.join(', ') + '</p>');
        }
        detailEl.innerHTML = html.join('');
      }

      function selectItem(id) {
        state.activeId = id;
        const item = state.items.find((entry) => entry.id === id);
        renderList();
        renderDetail(item);
      }

      function buildUrl(kind, offset, limit) {
        const url = new URL('/api/' + kind, window.location.origin);
        url.searchParams.set('offset', String(offset));
        url.searchParams.set('limit', String(limit));
        if (state.project) {
          url.searchParams.set('project', state.project);
        }
        return url.toString();
      }

      function refresh(reset) {
        const nextOffset = reset ? 0 : state.offset;
        fetch(buildUrl(state.kind, nextOffset, state.limit))
          .then((res) => res.json())
          .then((data) => {
            const items = data.items || [];
            if (reset) {
              state.items = items;
              state.offset = items.length;
            } else {
              state.items = state.items.concat(items);
              state.offset += items.length;
            }
            listTitle.textContent = state.kind === 'observations' ? 'Observations' : 'Summaries';
            renderList();
            if (!state.activeId && state.items.length) {
              selectItem(state.items[0].id);
            }
          })
          .catch(() => {
            emptyEl.textContent = 'Failed to load data.';
            emptyEl.style.display = 'block';
          });
      }

      function loadProjects() {
        fetch('/api/projects')
          .then((res) => res.json())
          .then((data) => {
            const projects = data.projects || [];
            projects.forEach((project) => {
              const option = document.createElement('option');
              option.value = project;
              option.textContent = project;
              projectSelect.appendChild(option);
            });
          })
          .catch(() => {});
      }

      projectSelect.addEventListener('change', (event) => {
        state.project = event.target.value;
        state.activeId = null;
        refresh(true);
      });

      toggleBtn.addEventListener('click', () => {
        state.kind = state.kind === 'observations' ? 'summaries' : 'observations';
        state.offset = 0;
        state.items = [];
        state.activeId = null;
        toggleBtn.textContent = state.kind === 'observations' ? 'Show summaries' : 'Show observations';
        refresh(true);
      });

      refreshBtn.addEventListener('click', () => {
        state.activeId = null;
        refresh(true);
      });

      loadMoreBtn.addEventListener('click', () => {
        refresh(false);
      });

      loadProjects();
      refresh(true);
    </script>
  </body>
</html>`;

type QueueItem = {
  kind: "observation";
  payload: {
    sessionId: string;
    projectId: string;
    type: string;
    title: string;
    body: string;
    tags: string[];
    filesRead: string[];
    filesModified: string[];
    promptNumber: number;
  };
};

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendJson(res: http.ServerResponse, code: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, code: number, body: string): void {
  res.writeHead(code, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === "string") as string[];
    }
  } catch {
    return [];
  }
  return [];
}

function parseLimit(value: string | null, fallback: number): number {
  const parsed = value ? Number(value) : fallback;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.min(Math.max(1, Math.floor(parsed)), 200);
}

function parseOffset(value: string | null): number {
  const parsed = value ? Number(value) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

async function main(): Promise<void> {
  const config = loadConfig(process.cwd());
  const dbCtx = await openDb(config.dataDir);
  const queue: QueueItem[] = [];
  let processing = false;

  async function processQueue(): Promise<void> {
    if (processing) {
      return;
    }
    processing = true;
    try {
      while (queue.length) {
        const item = queue.shift();
        if (!item) {
          continue;
        }
        if (item.kind === "observation") {
          const payload = item.payload;
          insertObservation(dbCtx, {
            sessionId: payload.sessionId,
            projectId: payload.projectId,
            type: payload.type,
            title: payload.title,
            body: payload.body,
            tags: payload.tags,
            filesRead: payload.filesRead,
            filesModified: payload.filesModified,
            promptNumber: payload.promptNumber
          });
          saveDb(dbCtx);
        }
      }
    } finally {
      processing = false;
    }
  }

  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      sendJson(res, 400, { error: "missing url" });
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (req.method === "GET" && url.pathname === "/") {
      sendHtml(res, 200, VIEWER_HTML);
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/projects") {
      const projects = listProjects(dbCtx);
      sendJson(res, 200, { projects });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/observations") {
      const projectId = url.searchParams.get("project") || undefined;
      const limit = parseLimit(url.searchParams.get("limit"), 25);
      const offset = parseOffset(url.searchParams.get("offset"));
      const rows = listObservations(dbCtx, { projectId, limit, offset }).map((row) => ({
        ...row,
        tags: parseJsonArray(row.tags),
        files_read: parseJsonArray(row.files_read),
        files_modified: parseJsonArray(row.files_modified),
        preview: row.body.slice(0, 160)
      }));
      sendJson(res, 200, { items: rows, limit, offset });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/summaries") {
      const projectId = url.searchParams.get("project") || undefined;
      const limit = parseLimit(url.searchParams.get("limit"), 25);
      const offset = parseOffset(url.searchParams.get("offset"));
      const rows = listSessionSummaries(dbCtx, { projectId, limit, offset }).map((row) => ({
        ...row,
        preview: row.body.slice(0, 160)
      }));
      sendJson(res, 200, { items: rows, limit, offset });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/observation/")) {
      const id = url.pathname.replace("/api/observation/", "");
      const row = getObservation(dbCtx, id);
      if (!row) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      sendJson(res, 200, {
        ...row,
        tags: parseJsonArray(row.tags),
        files_read: parseJsonArray(row.files_read),
        files_modified: parseJsonArray(row.files_modified)
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/init") {
      const body = (await readJson(req)) as { codex_session_id?: string; project_id?: string };
      const sessionId = insertSession(dbCtx, {
        codexSessionId: body.codex_session_id,
        projectId: body.project_id || config.projectId
      });
      saveDb(dbCtx);
      sendJson(res, 200, { session_id: sessionId });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/prompt") {
      const body = (await readJson(req)) as {
        session_id: string;
        project_id?: string;
        prompt_text: string;
        prompt_number: number;
      };
      const stripped = stripTags(body.prompt_text || "");
      const redacted = redactText(stripped, config);
      if (!redacted) {
        sendJson(res, 200, { skipped: true, reason: "prompt empty after privacy stripping" });
        return;
      }
      const id = insertUserPrompt(dbCtx, {
        sessionId: body.session_id,
        projectId: body.project_id || config.projectId,
        promptText: redacted,
        promptNumber: body.prompt_number
      });
      saveDb(dbCtx);
      sendJson(res, 200, { prompt_id: id });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/observations") {
      const body = (await readJson(req)) as {
        session_id: string;
        project_id?: string;
        type: string;
        title: string;
        body: string;
        tags?: string[];
        files_read?: string[];
        files_modified?: string[];
        prompt_number: number;
      };

      const stripped = stripTags(body.body || "");
      const redacted = redactText(stripped, config);
      const compressed = compressObservation({
        type: body.type,
        title: body.title,
        body: redacted,
        tags: body.tags,
        filesRead: body.files_read,
        filesModified: body.files_modified
      }, config);

      queue.push({
        kind: "observation",
        payload: {
          sessionId: body.session_id,
          projectId: body.project_id || config.projectId,
          type: compressed.type,
          title: compressed.title,
          body: compressed.body,
          tags: compressed.tags,
          filesRead: compressed.filesRead,
          filesModified: compressed.filesModified,
          promptNumber: body.prompt_number
        }
      });

      processQueue().catch((err) => {
        console.error("Error processing observation queue:", err);
      });
      sendJson(res, 200, { queued: true, queue_depth: queue.length });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/summary") {
      const body = (await readJson(req)) as {
        session_id: string;
        project_id?: string;
        title: string;
        body: string;
        prompt_number: number;
      };
      const stripped = stripTags(body.body || "");
      const redacted = redactText(stripped, config);
      if (!redacted) {
        sendJson(res, 200, { skipped: true, reason: "summary empty after privacy stripping" });
        return;
      }
      const id = insertSessionSummary(dbCtx, {
        sessionId: body.session_id,
        projectId: body.project_id || config.projectId,
        title: body.title,
        body: redacted,
        promptNumber: body.prompt_number
      });
      saveDb(dbCtx);
      sendJson(res, 200, { summary_id: id });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sessions/complete") {
      const body = (await readJson(req)) as { session_id: string; status?: string };
      updateSessionStatus(dbCtx, {
        sessionId: body.session_id,
        status: body.status || "completed"
      });
      saveDb(dbCtx);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { error: "not found" });
  });

  server.listen(PORT, () => {
    console.log(`codex-mem worker listening on ${PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
