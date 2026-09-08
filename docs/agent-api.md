# Damecon Agent API（只读）

Damecon 提供一个内置的 `agent.html` 页面，供浏览器自动化 harness 读取 KC3 当前内存状态。它没有本机 HTTP 服务、端口、token 或外部网页权限，也不会主动发起游戏请求。打开内置页面后，在该页面的浏览器运行时执行：

```js
await window.dameconAgent.getSnapshot()
```

页面地址是 `chrome-extension://<Damecon 内置 UI 扩展 ID>/agent.html`。也可以从新标签页点击 `Damecon Agent API (read-only)` 进入，无需手动拼接地址。页面自身有按钮和 JSON 输出，便于人工检查。

## 方法

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

Agent 可以先发现工具，再通过统一入口调用；工具目录和参数 schema 由主进程维护，调用会拒绝未知工具和未知参数。所有工具都标记为只读（`readOnlyHint: true`、`destructiveHint: false`）。

| 工具名 | 用途 |
| --- | --- |
| `damecon_get_snapshot` | 提督、舰队、陆航、装备和任务的完整当前快照。 |
| `damecon_get_fleets` | 舰队、联合舰队、远征、槽位以及制空/索敌/运输指标。 |
| `damecon_get_land_bases` | 基地航空队、中队、航程和出击/防空制空指标。 |
| `damecon_get_equipment` | 按 `category`（KC3 `api_type[2]`）或 `masterId` 查询装备。 |
| `damecon_get_improvements` | 查询静态改修计划、秘书舰条件和材料。 |
| `damecon_get_quests` | `mode: "current"` 读当前任务，`mode: "knowledge"` 读静态任务图。 |
| `damecon_get_schema` | 读取接口 schema 和完整工具目录。 |
| `damecon_health` | 检查当前 KC3 source 是否可读。 |

```js
const tools = await window.dameconAgent.listTools()
const fleets = await window.dameconAgent.callTool('damecon_get_fleets')
const planes = await window.dameconAgent.callTool('damecon_get_equipment', { category: 6 })
const questGraph = await window.dameconAgent.callTool('damecon_get_quests', { mode: 'knowledge' })
```

`listTools()` 返回可交给外部 harness 注册的 Tool descriptors。harness 将模型产生的工具名和 arguments 原样转发给 `callTool(name, args)`，无需额外 SDK、网络服务或协议转换：

```js
const descriptors = await window.dameconAgent.listTools()
const modelCall = { name: 'damecon_get_equipment', arguments: { category: 6 } }
const result = await window.dameconAgent.callTool(modelCall.name, modelCall.arguments)
```

`callTool` 的参数是 JSON object；装备和 ID 使用正整数，改修 `day` 使用 `today` 或 `sun` 到 `sat`，任务 `id` 可为正整数或非空正整数数组。工具调用不会执行游戏 action。页面上的 `getSnapshot` 等旧方法仍保留，并映射到相同工具注册表。

`getEquipment` 的 `category` 是 KC3 `api_type[2]`，`masterId` 是装备图鉴 ID。`getImprovements.day` 支持 `today`、`sun` 到 `sat`（按日本时间）；秘书舰和装备筛选参数均为 master ID。`getQuests` 的 `current` 来自最近一次读取的 KC3 当前任务对象；`knowledge` 来自随 KC3 扩展提供的静态任务图和改修资料，静态资料缺失时返回 `available: false`，不会猜测任务完成或解锁状态。

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

`getSnapshot().data` 包含 `player`、`fleets`、`landBases`、`equipment` 和 `quests`。舰队记录包含联合舰队类型、远征状态、舰船和槽位，以及 `metrics.fighterBounds`、`metrics.fighterPower`、`metrics.fighterVeteran`、`metrics.eLos`、`metrics.eLos4` 和 `metrics.transport`；基地记录包含航程、各中队，以及 `metrics.sortieFighterBounds`、`metrics.sortieFighterPower`、`metrics.sortieFighterVeteran`、`metrics.defenseInterceptionPower`。装备记录按 KC3 `api_type[2]` 类别，并带有锁定、改修星级、熟练度、图鉴属性和所在位置。`data.reference.shipNames` 提供舰船 master ID 到完整舰名的映射，便于 harness 还原舰名。字段缺失会使用 `null`，并在 `warnings` 中保留读取问题。返回值不含 cookie、token、原始网络 payload 或 HQ 私有 ID。

## 安全边界

`window.dameconAgent` 只注入 Damecon 自己的 `agent.html`。IPC 主进程还会检查调用者 frame 的完整扩展 URL 和方法白名单；普通游戏网页、外部网页和用户安装的扩展不能调用它。所有方法都是 GET 风格的只读读取，不修改 KC3 on-disk 数据，也不操作游戏。

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
```

smoke 使用独立临时配置和本地 KC3 测试数据，不连接真实游戏。
