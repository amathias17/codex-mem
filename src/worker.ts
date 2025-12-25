import http from "http";
import { loadConfig } from "./config";
import { openDb, saveDb, insertSession, insertUserPrompt, insertObservation, insertSessionSummary, updateSessionStatus } from "./db";
import { redactText, stripTags } from "./redaction";
import { compressObservation } from "./compress";

const PORT = Number(process.env.CODEX_MEM_PORT || 37777);

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

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true });
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

      processQueue().catch(() => undefined);
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
