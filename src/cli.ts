import fs from "node:fs";
import path from "node:path";
import { Store } from "./store.js";
import { validateSequence } from "./validate.js";
import { compose, explainPixel } from "./compositor.js";
import { startServer } from "./server.js";

const DB = process.env.FRAME_DB ?? path.join(process.cwd(), "data", "frames.db");

function usage(): never {
  console.log(`用法：
  node dist/src/cli.js serve [--port N]        启动 API 服务（默认自动选空闲端口）
  node dist/src/cli.js import <file.json>      导入帧序列（创建序列）
  node dist/src/cli.js update <id> <file.json> 修改帧序列（产生新版本）
  node dist/src/cli.js compose <id> [version]  合成并保存报告
  node dist/src/cli.js frame <id> <n> [version] 查看第 n 帧显示画布与处置后状态
  node dist/src/cli.js pixel <id> <n> <x> <y>  解释第 n 帧显示中像素 (x,y) 的来源
  node dist/src/cli.js export <id> [version]   导出完整像素 JSON
  node dist/src/cli.js history <id>            查询版本历史
  node dist/src/cli.js list                    列出所有序列
  node dist/src/cli.js demo                    运行演示（处置规则差异对比）`);
  process.exit(1);
}

function render(canvas: number[], W: number, H: number): string {
  const lines: string[] = [];
  for (let y = 0; y < H; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const [r, g, b, a] = [canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3]];
      row += a === 0 ? " . " : a === 255 ? (r > 200 ? " R " : b > 200 ? " B " : g > 200 ? " G " : " # ") : " o ";
    }
    lines.push(row);
  }
  return lines.join("\n");
}

function loadJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function getReport(store: Store, id: number, version?: number) {
  const cached = store.getReport(id, version);
  if (cached) return cached;
  const { input, version: v } = store.getInput(id, version);
  const report = compose(input, id, v);
  store.saveReport(report);
  return report;
}

const args = process.argv.slice(2);
const cmd = args[0];
if (!cmd) usage();

if (cmd === "serve") {
  const pi = args.indexOf("--port");
  const port = pi >= 0 ? Number(args[pi + 1]) : Number(process.env.PORT ?? 0);
  const { port: p } = await startServer(DB, port);
  console.log(`API 服务已启动: http://127.0.0.1:${p}  (数据库: ${DB})`);
} else if (cmd === "demo") {
  const { runDemo } = await import("./demo.js");
  runDemo();
} else {
  const store = new Store(DB);
  try {
    if (cmd === "import") {
      const seq = validateSequence(loadJson(args[1]));
      console.log(JSON.stringify(store.createSequence(seq)));
    } else if (cmd === "update") {
      const seq = validateSequence(loadJson(args[2]));
      console.log(JSON.stringify({ sequenceId: Number(args[1]), version: store.addVersion(Number(args[1]), seq) }));
    } else if (cmd === "compose") {
      const id = Number(args[1]);
      const { input, version } = store.getInput(id, args[2] ? Number(args[2]) : undefined);
      const report = compose(input, id, version);
      store.saveReport(report);
      console.log(JSON.stringify({ sequenceId: id, version, frameCount: report.frameCount, totalDurationMs: report.totalDurationMs }));
    } else if (cmd === "frame") {
      const report = getReport(store, Number(args[1]), args[3] ? Number(args[3]) : undefined);
      const f = report.frames[Number(args[2])];
      if (!f) throw new Error(`帧 ${args[2]} 不存在`);
      console.log(`帧 ${f.index}  rect=${JSON.stringify(f.rect)} blend=${f.blend} dispose=${f.dispose} 播放区间 [${f.startMs}, ${f.endMs})ms`);
      console.log("显示画布（处置前）:");
      console.log(render(f.display, report.width, report.height));
      console.log("处置后画布（下一帧背景）:");
      console.log(render(f.postDispose, report.width, report.height));
    } else if (cmd === "pixel") {
      const id = Number(args[1]);
      const { input } = store.getInput(id);
      console.log(JSON.stringify(explainPixel(input, Number(args[3]), Number(args[4]), Number(args[2])), null, 2));
    } else if (cmd === "export") {
      console.log(JSON.stringify(getReport(store, Number(args[1]), args[2] ? Number(args[2]) : undefined)));
    } else if (cmd === "history") {
      console.log(JSON.stringify(store.history(Number(args[1])), null, 2));
    } else if (cmd === "list") {
      console.log(JSON.stringify(store.listSequences(), null, 2));
    } else {
      usage();
    }
  } finally {
    store.close();
  }
}
