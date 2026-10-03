# 局部动画帧合成与处置回放后端

离线动画帧重建服务：输入固定画布与一组局部 RGBA 帧（JSON 描述），输出每一帧实际显示的完整像素矩阵，并解释播放到下一帧前画布如何变化。只做 API 与 CLI，不解析 GIF/PNG/视频，不含网页播放器、音频或图像压缩。

技术栈：TypeScript + Node.js（>= 22，使用内置 `node:sqlite`，无原生依赖、无外部服务）。Windows 本地直接运行。

## 快速开始

```powershell
npm install        # 仅安装 typescript / @types/node（开发依赖）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API 服务（默认自动选择空闲端口）
npm run demo       # 演示：同一组局部帧更换处置规则后的显示差异
```

端口配置：`node dist/src/cli.js serve --port 8080` 或环境变量 `PORT`；默认 `0`（操作系统分配空闲端口）。数据库路径用环境变量 `FRAME_DB` 覆盖，默认 `项目目录/data/frames.db`。

## 操作顺序（核心语义）

对每一帧严格按以下顺序执行：

1. **保留旧画布**：保存合成前画布快照（供 `previous` 处置恢复）。
2. **合成**：在指定矩形内按 `blend` 规则写入局部像素，得到**本帧显示画布**——本帧输出在此时取得（包括最后一帧）。
3. **处置**（结果作为下一帧背景）：
   - `none`：保留整张画布；
   - `background`：仅把**本帧矩形**清为透明黑，矩形外不受影响；
   - `previous`：恢复到**本帧合成前**的像素状态（不是恢复成上一张已输出的显示图，也不会清空整张画布）。

每帧记录：画布摘要（不透明/半透明/透明像素计数）、矩形、混合与处置规则、累计播放区间 `[startMs, endMs)`。时间只用于记录，不真实等待。

## 混合规则

- `source`：直接替换目标像素。源透明像素也会覆盖旧像素（忽略目标 alpha）。
- `over`：标准 source-over alpha 合成。源完全透明时保留目标；源不透明时覆盖目标。

Alpha 公式（非预乘，a 归一化到 0..1）：

```
aO = aS + aD * (1 - aS)
cO = (cS * aS + cD * aD * (1 - aS)) / aO
```

**舍入规则**：中间计算用浮点，仅在最终输出通道时四舍五入到 0..255 整数。**透明归一**：输出 alpha 为 0 时 RGB 一律归一为 0（透明黑）。不逐通道求平均，不忽略目标 alpha。

手算示例：红 `(255,0,0,128)` over 不透明蓝 `(0,0,255,255)` → `aO = 128/255 + 1*(127/255) = 1`，`R = 255*128/255 = 128`，`B = 255*127/255 = 127` → `(128,0,127,255)`。

## 输入格式

```json
{
  "width": 4, "height": 2,
  "frames": [
    { "x": 0, "y": 0, "w": 2, "h": 2,
      "pixels": [255,0,0,255, ...],
      "delayMs": 100, "blend": "source", "dispose": "none" }
  ]
}
```

`pixels` 为行主序 RGBA，长度必须等于 `w*h*4`，每通道为 0..255 整数。初始画布为透明黑 `(0,0,0,0)`。

## 资源上限

| 项 | 上限 |
|---|---|
| 画布宽/高 | 256 |
| 帧数 | 256 |
| 单矩形像素 | 65536 |
| 总像素预算 | 4194304 |
| delayMs | 0..60000 |

## API

均返回 JSON；错误返回 `{ "error": { "code", "message" } }`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/sequences` | 导入帧序列，创建序列（返回 `sequenceId`, `version=1`） |
| POST | `/api/sequences/:id/frames` | 修改帧序列，产生新版本（不污染既有报告） |
| POST | `/api/sequences/:id/compose?version=` | 合成并保存报告（返回每帧摘要与时间区间） |
| GET | `/api/sequences/:id/frames/:n?version=` | 第 n 帧显示画布与处置后状态（完整 RGBA） |
| GET | `/api/sequences/:id/pixel?x=&y=&frame=` | 解释指定帧显示中某像素的来源 |
| GET | `/api/sequences/:id/export?version=` | 导出完整像素 JSON |
| GET | `/api/sequences/:id/history` | 版本历史 |
| GET | `/api/sequences` | 所有序列列表 |

省略 `version` 时读取最新版本。报告按 `(序列, 版本)` 持久化，重启后按编号读取同一帧；返回的显示快照彼此独立，后续帧不会改写前面的结果。

### 错误码

`BAD_BODY` `BAD_JSON` `BAD_FRAME` `INVALID_WIDTH` `INVALID_HEIGHT` `NO_FRAMES` `TOO_MANY_FRAMES` `PIXEL_BUDGET` `INVALID_RECT` `RECT_TOO_LARGE` `RECT_OUT_OF_BOUNDS` `PIXEL_COUNT_MISMATCH` `INVALID_CHANNEL` `INVALID_DELAY` `INVALID_BLEND` `INVALID_DISPOSE` `INVALID_VERSION` `INVALID_ID` `INVALID_PIXEL` `PIXEL_OUT_OF_BOUNDS` `SEQ_NOT_FOUND` `VERSION_NOT_FOUND` `FRAME_NOT_FOUND` `NOT_FOUND` `BODY_TOO_LARGE`

## CLI

```
node dist/src/cli.js serve [--port N]        启动 API 服务
node dist/src/cli.js import <file.json>      导入帧序列
node dist/src/cli.js update <id> <file.json> 修改帧序列（新版本）
node dist/src/cli.js compose <id> [version]  合成并保存报告
node dist/src/cli.js frame <id> <n> [ver]    查看第 n 帧显示画布与处置后状态
node dist/src/cli.js pixel <id> <n> <x> <y>  解释像素来源
node dist/src/cli.js export <id> [version]   导出像素 JSON
node dist/src/cli.js history <id>            查询历史
node dist/src/cli.js list                    列出序列
node dist/src/cli.js demo                    处置规则差异演示
```

示例输入见 `data/sample.json`。

## 测试

`npm test` 覆盖：局部覆盖、处置后透明背景、恢复之前、三种处置交错（与独立参考实现逐帧核对）、半透明源/目标、首帧、最后一帧（输出在处置前取得）、矩形越界、像素数错误、非法通道、快照不可变、矩形外像素不变、版本化与重启后读取、HTTP 端到端。

## 限制

- 使用 Node 内置实验性 `node:sqlite`（启动时有 ExperimentalWarning，不影响功能）；需 Node >= 22。
- 仅监听 `127.0.0.1`，无鉴权，面向本地单机使用。
- 报告以 JSON 整体存储于 SQLite，适合小画布离线分析，非高吞吐场景。
