import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.ts';
import { validateSequence } from './validate.ts';
import { composeSequence, normalizeForExport } from './engine.ts';
import { explainPixel } from './explain.ts';
import { ApiError } from './types.ts';

const root = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH ?? path.join(root, '..', 'data', 'app.db');
const store = new Store(dbPath);

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(json);
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError('E_BODY', '请求体不是合法 JSON');
  }
}

function num(v: string | null, name: string): number {
  const n = Number(v);
  if (v === null || !Number.isInteger(n)) throw new ApiError('E_PARAM', `参数 ${name} 必须是整数`);
  return n;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    const method = req.method ?? 'GET';

    if (method === 'POST' && url.pathname === '/api/sequences') {
      const input = validateSequence(await readBody(req));
      const groupId = url.searchParams.get('groupId');
      const result = store.importSequence(input, groupId === null ? undefined : num(groupId, 'groupId'));
      return send(res, 201, result);
    }
    if (method === 'GET' && url.pathname === '/api/history') {
      return send(res, 200, store.history());
    }
    if (parts[0] === 'api' && parts[1] === 'groups' && parts[3] === 'versions' && method === 'GET') {
      return send(res, 200, store.versions(num(parts[2], 'groupId')));
    }
    if (parts[0] === 'api' && parts[1] === 'sequences' && parts.length >= 3) {
      const seqId = num(parts[2], 'sequenceId');
      if (method === 'POST' && parts[3] === 'compose') {
        return send(res, 200, store.compose(seqId));
      }
      if (method === 'GET' && parts[3] === 'frames' && parts.length === 4) {
        return send(res, 200, store.listFrames(seqId));
      }
      if (method === 'GET' && parts[3] === 'frames' && parts.length >= 5) {
        const frameIndex = num(parts[4], 'frameIndex');
        const stored = store.getFrame(seqId, frameIndex);
        const input = store.getSequenceInput(seqId);
        if (parts.length === 5) {
          const which = url.searchParams.get('after') === '1' ? 'after' : 'display';
          return send(res, 200, {
            meta: stored.meta,
            canvas: which,
            width: input.canvas.width,
            height: input.canvas.height,
            pixels: normalizeForExport(which === 'after' ? stored.after : stored.display),
          });
        }
        if (parts[5] === 'pixel') {
          const x = num(url.searchParams.get('x'), 'x');
          const y = num(url.searchParams.get('y'), 'y');
          if (x < 0 || y < 0 || x >= input.canvas.width || y >= input.canvas.height) {
            throw new ApiError('E_PARAM', '像素坐标越界');
          }
          const all = composeSequence(input);
          return send(res, 200, explainPixel(input, all, frameIndex, x, y));
        }
        if (parts[5] === 'export') {
          return send(res, 200, {
            frame: frameIndex,
            width: input.canvas.width,
            height: input.canvas.height,
            pixels: normalizeForExport(stored.display),
          });
        }
      }
    }
    throw new ApiError('E_NOT_FOUND', `路由不存在：${method} ${url.pathname}`, 404);
  } catch (err) {
    if (err instanceof ApiError) {
      send(res, err.status, { error: { code: err.code, message: err.message } });
    } else {
      send(res, 500, { error: { code: 'E_INTERNAL', message: String(err) } });
    }
  }
});

const requested = process.env.PORT ? Number(process.env.PORT) : 0; // 默认选择空闲端口
server.listen(requested, '127.0.0.1', () => {
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : requested;
  console.log(`frame-composer 已启动: http://127.0.0.1:${port} (db: ${dbPath})`);
});
