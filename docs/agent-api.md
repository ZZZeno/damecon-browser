# Damecon Agent Tools (MCP)（只读）

Damecon 的首要接入方式是可选的 LAN MCP Agent Tools。只需在内置 `agent.html` 页面打开设置、复制 MCP URL 和 Bearer token，然后填入支持 MCP Streamable HTTP 的通用客户端；MCP 调用期间不需要打开工具页。KC3 数据读取仍在浏览器内部按需进行，不会主动发起游戏请求。

## LAN MCP（可选）

接入步骤：打开 `agent.html` 只做一次设置，选择 host 和端口并保存；复制页面显示的 URL 与 token 到 MCP 客户端；之后客户端直接调用 `/mcp`，无需保持工具页打开。

`agent.html` 的 LAN MCP 区域可以启动一个标准 MCP Streamable HTTP endpoint，向可信局域网客户端提供同一组八个只读工具。服务只处理按需的 HTTP `POST /mcp` 请求，不使用 SSE、后台轮询或订阅。配置初始为关闭，端口默认 `39273`；主机可选择 `127.0.0.1`（本机）或 `0.0.0.0`（局域网），选择后者才会监听局域网接口。

保存配置后，页面会显示实际 MCP URL，例如 `http://127.0.0.1:39273/mcp` 或 `http://192.168.1.20:39273/mcp`。客户端请求必须带通用 HTTP 认证头：

```http
Authorization: Bearer <token shown in agent.html>
```

把 URL 和 Bearer token 填入支持 MCP Streamable HTTP 的通用客户端即可；不需要 Codex 注册命令。token 只在可信的 `agent.html` 页面显示，工具返回值和控制台不会输出原始 token。点击轮换后，旧 token 立即失效，客户端需要更新配置。局域网明文 HTTP 只适合受信网络；跨网络使用 VPN 或 TLS reverse proxy，避免端口转发到公网。

## 浏览器内 JavaScript API（兼容路径）

如需在浏览器自动化上下文中直接读取，可使用兼容路径 `window.dameconAgent`。JS 兼容调用必须在 `agent.html` 页面上下文中执行；MCP 调用无需打开该页面。页面地址是 `chrome-extension://<Damecon 内置 UI 扩展 ID>/agent.html`；页面按钮和 JSON 输出仅用于人工检查。

所有方法都返回 Promise。每次调用都会在当前浏览器 session 中寻找 KC3 devtools 的 `pages/devtools/themes/` frame，并读取一次固定 projection；没有后台轮询或通知订阅。

```js
await window.dameconAgent.getSnapshot()
await window.dameconAgent.getFleets()
await window.dameconAgent.getLandBases()
await window.dameconAgent.getEquipment({ category: 6, masterId: 10 })
await window.dameconAgent.getImprovements({ day: 'today', equipmentId: 10, secretaryId: 1 })
await window.dameconAgent.getQuests({ mode: 'current' })
await window.dameconAgent.getQuests({ mode: 'knowledge', id: 101 })
await window.dameconAgent.getSchema()
await window.dameconAgent.health()
```

## Tools

MCP 客户端通过标准 `tools/list` 自动发现工具，再用 `tools/call` 调用工具；工具目录和参数 schema 由主进程维护，调用会拒绝未知工具和未知参数。所有工具都标记为只读（`readOnlyHint: true`、`destructiveHint: false`）。浏览器 JS 兼容路径的 `listTools()` 和 `callTool()` 只用于 `agent.html` 页面内的自动化调用。

| 工具名                     | 用途                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `damecon_get_snapshot`     | 提督、舰队、陆航、装备和任务的完整当前快照。                     |
| `damecon_get_fleets`       | 舰队、联合舰队、远征、槽位以及制空/索敌/运输指标。               |
| `damecon_get_land_bases`   | 基地航空队、中队、航程和出击/防空制空指标。                      |
| `damecon_get_equipment`    | 按 `category`（KC3 `api_type[2]`）或 `masterId` 查询装备。       |
| `damecon_get_improvements` | 查询静态改修计划、秘书舰条件和材料。                             |
| `damecon_get_quests`       | `mode: "current"` 读当前任务，`mode: "knowledge"` 读静态任务图。 |
| `damecon_get_schema`       | 读取接口 schema 和完整工具目录。                                 |
| `damecon_health`           | 检查当前 KC3 source 是否可读。                                   |

```js
const tools = await window.dameconAgent.listTools()
const fleets = await window.dameconAgent.callTool('damecon_get_fleets')
const planes = await window.dameconAgent.callTool('damecon_get_equipment', { category: 6 })
const questGraph = await window.dameconAgent.callTool('damecon_get_quests', { mode: 'knowledge' })
```

`listTools()` 返回可交给外部 harness 注册的 Tool descriptors。harness 将模型产生的工具名和 arguments 原样转发给 `callTool(name, args)`，无需额外协议转换：

```js
const descriptors = await window.dameconAgent.listTools()
const modelCall = { name: 'damecon_get_equipment', arguments: { category: 6 } }
const result = await window.dameconAgent.callTool(modelCall.name, modelCall.arguments)
```

`callTool` 的参数是 JSON object；装备和 ID 使用正整数，改修 `day` 使用 `today` 或 `sun` 到 `sat`，任务 `id` 可为正整数或非空正整数数组。工具调用不会执行游戏 action。页面上的 `getSnapshot` 等旧方法仍保留，并映射到相同工具注册表。

## 可视化调用

从 Damecon 新标签页点击 `Agent Tools · 工具调试`，即可打开内置的工具调试入口。页面列出每个工具的描述并按 `inputSchema` 生成表单；改修的 `day`、任务的 `mode` 使用枚举下拉，装备类别会读取当前类别名称和数量，任务 ID 支持单个或多个 ID。没有参数的工具会省略空参数；正整数等非法值会在提交前拦截。

调用结果会显示完整 JSON，并提供复制和下载；状态栏同时显示 `source`、`revision` 和本次调用耗时。页面调用与 browser API、LAN MCP 共用同一个只读 Tool service。LAN MCP 配置收在折叠区域，不打开或保存配置也可以使用页面内的工具。

`getEquipment` 的 `category` 是 KC3 `api_type[2]`，`masterId` 是装备图鉴 ID。`getImprovements.day` 支持 `today`、`sun` 到 `sat`（按日本时间）；秘书舰和装备筛选参数均为 master ID。`getQuests` 的 `current` 来自最近一次读取的 KC3 当前任务对象；`knowledge` 来自随 KC3 扩展提供的静态任务图和改修资料，静态资料缺失时返回 `available: false`，不会猜测任务完成或解锁状态。

改修条目和升级配方会在保留原有 ID、数组及 `raw` 值的基础上提供 `name`/`nameSource`；秘书舰条件提供 `secretaryNames` 和 `secretaryDetails`。每个改修阶段保留原 `consumedEquipment`，并增加可识别的 `consumedItems`（装备或消耗品的 ID、名称、数量）；无法确定格式的值只放入 `raw`，不会猜测类型。

## 返回值与状态

除 `health`、`getSchema` 外，方法返回统一 envelope：

```json
{
  "schemaVersion": "1.0",
  "revision": 1,
  "requestedAt": "2026-09-09T00:00:00.000Z",
  "capturedAt": "2026-09-09T00:00:00.010Z",
  "ageMs": 10,
  "source": { "status": "live", "id": "12:7", "url": "chrome-extension://..." },
  "data": {},
  "warnings": []
}
```

`capturedAt` 是这次读取完成的时间，`ageMs` 是本次读取耗时；两者都不是游戏数据距离最近更新事件的时长。`source.status` 为 `live`、`unavailable` 或 `ambiguous`。`live` 表示本次读取成功取得当前 KC3 对象的最近已观察值，并不保证每个页面（例如任务页或陆航页）都已经被访问或填充。扩展尚未就绪、frame 被销毁或读取超时时，返回 `unavailable` 和空数据；同时存在多个 ready KC3 panel 时返回 `ambiguous`/`AMBIGUOUS_SOURCE`，避免混合不同账号。只有状态为 `live` 时，数据才可按当前游戏状态使用。

`getSnapshot().data` 包含 `player`、`fleets`、`landBases`、`equipment` 和 `quests`。舰队记录包含联合舰队类型、远征状态、舰船和槽位，以及 `metrics.fighterBounds`、`metrics.fighterPower`、`metrics.fighterVeteran`、`metrics.eLos`、`metrics.eLos4` 和 `metrics.transport`；基地记录包含航程、各中队，以及 `metrics.sortieFighterBounds`、`metrics.sortieFighterPower`、`metrics.sortieFighterVeteran`、`metrics.defenseInterceptionPower`。装备记录按 KC3 `api_type[2]` 类别，并带有锁定、改修星级、熟练度、图鉴属性和所在位置。`data.reference.shipNames` 提供舰船 master ID 到完整舰名的映射，便于 harness 还原舰名。字段缺失会使用 `null`，并在 `warnings` 中保留读取问题。返回值不含 cookie、token、原始网络 payload 或 HQ 私有 ID。MCP 只转发这些只读工具结果，不提供游戏写操作。

## 安全边界

`window.dameconAgent` 只注入 Damecon 自己的 `agent.html`。IPC 主进程还会检查调用者 frame 的完整扩展 URL 和方法白名单；普通游戏网页、外部网页和用户安装的扩展不能调用它。所有方法都是 GET 风格的只读读取，不修改 KC3 on-disk 数据，也不操作游戏。可选 MCP HTTP transport 只允许受 token 保护的工具调用；关闭 MCP 时不会监听端口。

## 示例 harness

在 CDP 或浏览器自动化的 `agent.html` 页面上下文中：

```js
const snapshot = await window.dameconAgent.getSnapshot()
if (snapshot.source.status !== 'live') {
  throw new Error(`KC3 source is ${snapshot.source.status}`)
}
console.log(snapshot.data.fleets.fleets)
console.log((await window.dameconAgent.getEquipment({ category: 6 })).data.instances)
```

开发者可以运行以下验证：

```sh
node --test packages/shell/browser/agent-api/*.test.js
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/agent-api-smoke.cjs
node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/agent-ui-smoke.cjs
```

smoke 使用独立临时配置和本地 KC3 测试数据，不连接真实游戏。
