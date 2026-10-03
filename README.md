# frame-composer：局部动画帧合成与处置回放后端

离线动画帧重建服务。输入固定画布与一组局部 RGBA 帧（JSON 描述），输出每一帧实际显示的
完整像素矩阵，并解释播放到下一帧前画布怎样变化。只做 API 与 CLI，不解析 GIF/PNG/视频，
不包含网页播放器、音频或图像压缩。

技术栈：TypeScript + Node.js（>= 22，推荐 25）+ SQLite（Node 内置 `node:sqlite`，无原生依赖）。
Windows 本地运行，不依赖 Docker / WSL / 外部服务。

## 快速开始

```powershell
npm install        # 安装 typescript / @types/node（仅开发依赖）
npm run build      # 类型检查并编译到 dist/
npm test           # 运行全部测试（node:test，直接跑 .ts）
npm run demo       # 演示：4 帧示例 + 更换处置规则后的显示差异
npm start          # 启动 API 服务（默认自动选择空闲端口，PORT=8080 可指定）
```

CLI（无需先构建，Node 直接执行 TypeScript）：

```powershell
node src/cli.ts import examples/sequence.json   # 导入 → { sequenceId, groupId, version }
node src/cli.ts import modified.json 1          # 同组导入 → 产生 version 2（修改早期帧的场景）
node src/cli.ts compose 1                       # 合成并保存报告（幂等，重复调用返回既有报告）
node src/cli.ts frames 1                        # 每帧元数据：摘要/矩形/规则/累计播放区间
node src/cli.ts frame 1 2                       # 第 2 帧显示画布（处置前）
node src/cli.ts frame 1 2 --after               # 第 2 帧处置后画布（下一帧背景）
node src/cli.ts pixel 1 1 1 1                   # 解释帧 1 像素 (1,1) 的来源
node src/cli.ts export 1 2                      # 导出第 2 帧显示像素 JSON
node src/cli.ts history                         # 查询历史
node src/cli.ts versions 1                      # 组内版本列表
```

## HTTP API

默认监听 `127.0.0.1` 空闲端口（启动日志打印实际端口），`PORT` 环境变量可指定。
数据保存在项目内 `data/app.db`（`DB_PATH` 可覆盖），重启后按编号读取同一帧。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/sequences` | 导入帧序列；`?groupId=N` 在该组下产生新版本 |
| POST | `/api/sequences/:id/compose` | 合成并持久化报告（幂等，`cached` 标识是否复用） |
| GET | `/api/sequences/:id/frames` | 每帧元数据（摘要、矩形、规则、播放区间） |
| GET | `/api/sequences/:id/frames/:n` | 第 n 帧显示画布；`?after=1` 取处置后画布 |
| GET | `/api/sequences/:id/frames/:n/pixel?x=&y=` | 解释指定像素来源 |
| GET | `/api/sequences/:id/frames/:n/export` | 导出显示像素 JSON |
| GET | `/api/history` | 全部序列与报告历史 |
| GET | `/api/groups/:id/versions` | 组内版本列表 |

错误返回 `{ "error": { "code", "message" } }`，错误码：`E_BODY` `E_CANVAS` `E_FRAME_COUNT`
`E_FRAME` `E_RECT` `E_PIXELS` `E_CHANNEL` `E_DELAY` `E_BLEND` `E_DISPOSAL` `E_PARAM`
`E_NOT_FOUND`(404) `E_NOT_COMPOSED`(409) `E_INTERNAL`(500)。

## 输入格式

```json
{
  "canvas": { "width": 4, "height": 3 },
  "frames": [
    {
      "rect": { "x": 0, "y": 0, "width": 2, "height": 2 },
      "pixels": [255, 0, 0, 255, "..."],
      "delayMs": 100,
      "blend": "source",
      "disposal": "none"
    }
  ]
}
```

- `pixels`：行优先 RGBA 扁平数组，长度 = `rect.width * rect.height * 4`，通道为 0–255 整数。
- `blend`：`source`（直接替换，透明源也覆盖）或 `over`（标准 source-over 合成）。
- `disposal`：`none`（保留）/ `background`（本帧矩形清为透明）/ `previous`（恢复到本帧合成前）。
- `delayMs`：仅用于记录累计播放区间，不做真实等待。

## 操作顺序（核心语义）

每一帧严格按以下顺序：

1. 复制当前画布为 `before`（供 `previous` 恢复）；
2. 在副本的指定矩形内按 `blend` 合成局部像素，得到本帧**显示画布 `display`**；
3. 对 `display` 取样/输出（最后一帧同样在处置之前输出）；
4. 执行处置得到 `after`，作为下一帧背景：
   - `none`：`after = display`；
   - `background`：仅本帧矩形清为透明，矩形外不变；
   - `previous`：`after = before`（恢复到本帧**合成前**的像素，不是上一帧的显示图）。

初始画布为透明黑 `(0,0,0,0)`。

## Alpha 公式与舍入规则

`over` 使用标准 source-over（非预乘、归一化到 0..1 计算）：

```
ao = as + ad·(1 − as)
co = (cs·as + cd·ad·(1 − as)) / ao        （ao = 0 时结果为 (0,0,0,0)）
```

- 内部用浮点归一化计算，**仅在输出时** `Math.round` 到 0–255 并 clamp，绝不逐通道直接平均，
  也不会忽略目标 alpha。
- 例：红 `(255,0,0,128)` over 不透明蓝 `(0,0,255,255)` → `(128,0,127,255)`。
- 导出归一：alpha = 0 的像素 RGB 一律输出 0（透明像素不携带颜色）。

## 版本与不可变性

- 每次导入生成不可变序列版本；修改早期帧需用 `?groupId=` 导入同组新版本，
  既有版本的报告不受影响。
- 报告一次合成、永久保存；重复 `compose` 返回既有报告（`cached: true`）。
- 所有返回的显示快照均为独立拷贝，后续帧不会改写先前结果。

## 资源上限

画布单边 1–256，总像素 ≤ 65536，帧数 ≤ 256，单帧 `delayMs` ≤ 60000。

## 测试

`npm test` 运行 13 个用例，覆盖：手算 alpha 样例、透明 source/over 差异、半透明目标与源、
首帧/最后一帧语义、三种处置交错、矩形外不变、快照不可变、独立参考实现交叉核对、
越界/像素数/非法通道等参数校验、SQLite 版本隔离与重启持久化。

## 目录结构

```
src/engine.ts    合成引擎（blend / disposal / 摘要）
src/validate.ts  参数校验与错误码
src/store.ts     SQLite 持久化（序列版本、报告、帧快照）
src/explain.ts   像素来源解释
src/server.ts    HTTP API
src/cli.ts       命令行
src/demo.ts      演示脚本
examples/        示例输入
test/            node:test 测试
data/            运行时生成的 SQLite 数据目录
```

## 限制

- 仅本地单进程使用；未实现鉴权与并发写控制。
- 时间只记录区间，不做真实播放调度。
- `node:sqlite` 在 Node 25 仍标记为实验特性（会有 ExperimentalWarning，不影响功能）。
