import http from "node:http";
import { Store } from "./store.js";
import { validateSequence } from "./validate.js";
import { compose, explainPixel } from "./compositor.js";
import { ApiError } from "./errors.js";
import type { ComposeReport } from "./types.js";

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(data);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) reject(new ApiError("BODY_TOO_LARGE", "请求体过大", 413));
      else chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new ApiError("BAD_JSON", "请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

function getReportOrCompose(store: Store, seqId: number, version?: number): ComposeReport {
  const cached = store.getReport(seqId, version);
  if (cached) return cached;
  const { input, version: v } = store.getInput(seqId, version);
  const report = compose(input, seqId, v);
  store.saveReport(report);
  return report;
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean); // e.g. ["api","sequences","1","frames","0"]
      const method = req.method ?? "GET";
      const vParam = url.searchParams.get("version");
      const version = vParam !== null ? Number(vParam) : undefined;
      if (vParam !== null && (!Number.isInteger(version) || (version as number) < 1)) {
        throw new ApiError("INVALID_VERSION", "version 必须是正整数");
      }

      if (method === "POST" && url.pathname === "/api/sequences") {
        const seq = validateSequence(await readBody(req));
        return json(res, 201, store.createSequence(seq));
      }
      if (method === "GET" && url.pathname === "/api/sequences") {
        return json(res, 200, { sequences: store.listSequences() });
      }
      if (parts[0] === "api" && parts[1] === "sequences" && parts[2]) {
        const seqId = Number(parts[2]);
        if (!Number.isInteger(seqId)) throw new ApiError("INVALID_ID", "序列编号必须是整数");

        if (method === "POST" && parts[3] === "frames" && parts.length === 4) {
          const body = (await readBody(req)) as Record<string, unknown>;
          const seq = validateSequence({ width: body.width, height: body.height, frames: body.frames });
          const v = store.addVersion(seqId, seq);
          return json(res, 201, { sequenceId: seqId, version: v });
        }
        if (method === "POST" && parts[3] === "compose" && parts.length === 4) {
          const { input, version: v } = store.getInput(seqId, version);
          const report = compose(input, seqId, v);
          store.saveReport(report);
          return json(res, 200, {
            sequenceId: seqId, version: v, frameCount: report.frameCount,
            totalDurationMs: report.totalDurationMs,
            frames: report.frames.map((f) => ({
              index: f.index, rect: f.rect, blend: f.blend, dispose: f.dispose,
              startMs: f.startMs, endMs: f.endMs, summary: f.summary,
            })),
          });
        }
        if (method === "GET" && parts[3] === "frames" && parts[4] !== undefined) {
          const n = Number(parts[4]);
          const report = getReportOrCompose(store, seqId, version);
          const f = report.frames[n];
          if (!f) throw new ApiError("FRAME_NOT_FOUND", `帧 ${n} 不存在（共 ${report.frameCount} 帧）`, 404);
          return json(res, 200, { sequenceId: seqId, version: report.version, width: report.width, height: report.height, frame: f });
        }
        if (method === "GET" && parts[3] === "pixel" && parts.length === 4) {
          const x = Number(url.searchParams.get("x"));
          const y = Number(url.searchParams.get("y"));
          const frame = Number(url.searchParams.get("frame") ?? "0");
          if (![x, y, frame].every(Number.isInteger)) throw new ApiError("INVALID_PIXEL", "x/y/frame 必须是整数");
          const { input, version: v } = store.getInput(seqId, version);
          if (x < 0 || y < 0 || x >= input.width || y >= input.height) {
            throw new ApiError("PIXEL_OUT_OF_BOUNDS", "像素坐标超出画布");
          }
          return json(res, 200, { sequenceId: seqId, version: v, ...explainPixel(input, x, y, frame) });
        }
        if (method === "GET" && parts[3] === "export" && parts.length === 4) {
          return json(res, 200, getReportOrCompose(store, seqId, version));
        }
        if (method === "GET" && parts[3] === "history" && parts.length === 4) {
          return json(res, 200, store.history(seqId));
        }
      }
      throw new ApiError("NOT_FOUND", `未知路由 ${method} ${url.pathname}`, 404);
    } catch (err) {
      const e = err as { code?: string; status?: number; message?: string };
      json(res, e.status ?? 500, { error: { code: e.code ?? "INTERNAL", message: e.message ?? String(err) } });
    }
  });
}

export function startServer(dbPath: string, port = 0): Promise<{ port: number; close: () => void }> {
  const store = new Store(dbPath);
  const server = createServer(store);
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      resolve({ port: p, close: () => { server.close(); store.close(); } });
    });
  });
}
