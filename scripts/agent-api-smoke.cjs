'use strict'

// Run with the repository's Electron binary, for example:
// node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/agent-api-smoke.cjs
//
// This is intentionally a standalone process. It never attaches to the running
// Damecon/KC3 app and uses a temporary profile with local extension fixtures.

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { app, BrowserWindow, ipcMain, session } = require('electron')

const TIMEOUT_MS = 15_000

let agentWindow
let attackerWindow
let gameWindow
let fixtureRoot
let fixturePaths
let kc3Extension
let webuiExtension
let bridge
let integration
let mcpServer
let mcpClient
let networkRequests = []

app.on('window-all-closed', () => {})

const PRODUCTION_PRELOAD_ENTRY = `import { injectAgentApi } from ${JSON.stringify(path.resolve(__dirname, '../packages/shell/preload-ipc.js'))}; injectAgentApi();`

const AGENT_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Agent API smoke fixture</title>
<main>trusted agent fixture</main>
`

const gameHtml = (extensionId) => `<!doctype html>
<meta charset="utf-8">
<title>KC3 game fixture host</title>
<iframe src="chrome-extension://${extensionId}/pages/devtools/themes/fixture.html" title="KC3 fixture"></iframe>
`

const KC3_HTML = `<!doctype html>
<meta charset="utf-8">
<title>KC3 devtools fixture</title>
<script src="./fixture-stubs.js"></script>
<script src="../../../assets/js/global.js"></script>
<script src="../../../library/objects.js"></script>
<script src="../../../library/managers.js"></script>
<script src="../../../library/modules/Master.js"></script>
<script src="../../../library/modules/RemodelDb.js"></script>
<script src="../../../library/modules/Translation.js"></script>
<script src="../../../library/modules/Meta.js"></script>
<script src="./fixture-init.js"></script>
`

const KC3_INIT_JS = String.raw`
const shipMaster = { api_id: 1, api_name: 'Fixture Ship', api_stype: 2, api_ctype: 1, api_taik: 30, api_houg: 25, api_raig: 30, api_tyku: 20, api_souk: 15, api_kaih: 20, api_taisen: 10, api_sakuteki: 8, api_lucky: 12, api_maxeq: [18, 0, 0, 0, 0], api_soku: 10, api_leng: 1, api_fuel_max: 10, api_bull_max: 12 }
const gearMaster = (id, name) => ({ api_id: id, api_name: name, api_type: [1, 1, 1, 0], api_houg: 3, api_tyku: 2, api_souk: 1, api_saku: 1, api_distance: 4, api_leng: 1 })
const landBaseMaster = { api_id: 83, api_name: 'Land Base Fixture', api_stype: 7, api_ctype: 1, api_taik: 1, api_houg: 1, api_raig: 1, api_tyku: 1, api_souk: 1, api_kaih: 1, api_taisen: 1, api_sakuteki: 1, api_lucky: 1, api_maxeq: [18, 18, 18, 18], api_soku: 10, api_leng: 1, api_fuel_max: 1, api_bull_max: 1 }
const landFighterMaster = { api_id: 18, api_name: 'Fixture Land Fighter', api_type: [1, 1, 6, 0], api_houg: 0, api_tyku: 18, api_houk: 2, api_souk: 0, api_saku: 1, api_distance: 4, api_leng: 1 }
KC3Master._raw = { ship: { 1: shipMaster, 83: landBaseMaster }, shipupgrade: {}, slotitem: { 1: gearMaster(1, 'Fixture Equipment 1'), 204: gearMaster(204, 'Fixture Equipment 204'), 18: landFighterMaster }, stype: {}, shipgraph: {} }
KC3Master.available = true
ConfigManager.language = 'en'
ConfigManager.info_force_ship_lang = ''
ConfigManager.info_eng_stype = false
KC3Meta.init('chrome-extension://' + location.host + '/data/', false)
RemodelDb.init()
const ship = new KC3Ship({ api_id: 101, api_ship_id: 1, api_lv: 20, api_exp: [0, 0, 0], api_nowhp: 30, api_maxhp: 30, api_karyoku: [25, 25], api_raisou: [30, 30], api_taiku: [20, 20], api_soukou: [15, 15], api_kaihi: [20, 20], api_taisen: [10, 10], api_sakuteki: [8, 8], api_lucky: [12, 12], api_leng: 1, api_slot: [201, 204, -1, -1, -1], api_slot_ex: 0, api_slotnum: 2, api_onslot: [18, 18, 0, 0, 0], api_soku: 10, api_kyouka: [0, 0, 0, 0, 0, 0], api_fuel: 10, api_bull: 12, api_ndock_time: 0, api_ndock_item: [0, 0], api_srate: 2, api_cond: 49, api_locked: 1 })
const gear1 = new KC3Gear({ api_id: 201, api_slotitem_id: 1, api_level: 2, api_alv: 1, api_locked: 1 })
const gear204 = new KC3Gear({ api_id: 204, api_slotitem_id: 204, api_level: 0, api_alv: 0, api_locked: 0 })
const landFighter = new KC3Gear({ api_id: 218, api_slotitem_id: 18, api_level: 0, api_alv: 0, api_locked: 0 })
KC3ShipManager.list = { x101: ship }
KC3GearManager.list = { x201: gear1, x204: gear204, x218: landFighter }
const fleet = new KC3Fleet({ active: true, fleetId: 1, name: 'First Fleet', ships: [101], mission: [0, 0, 0, 0], deckParams: { tp: 5, atp: { fuel: 2 } } })
PlayerManager.hq = new KC3Player()
PlayerManager.hq.id = 7
PlayerManager.hq.level = 88
PlayerManager.hq.name = 'Smoke Admiral'
PlayerManager.hq.secretary = 1
PlayerManager.hq.lastMaterial = [300, 280, 500, 400, 4, 2, 1, 0]
PlayerManager.consumables = { buckets: 4, devmats: 2, screws: 1, torch: 0 }
PlayerManager.fleets = [fleet]
PlayerManager.bases = [new KC3LandBase({
  api_area_id: 6,
  api_rid: 1,
  api_name: 'Smoke Air Base',
  api_distance: { api_base: 4, api_bonus: 0 },
  api_action_kind: 2,
  api_plane_info: [{ api_squadron_id: 1, api_slotid: 218, api_count: 18, api_max_count: 18, api_state: 1, api_cond: 49 }],
})]
PlayerManager.combinedFleet = 0
KC3QuestManager.open = [100]
KC3QuestManager.active = [101]
KC3QuestManager.list = { q100: { progress: 1, max: 5 }, q101: { progress: 2, max: 2 } }
`

const FIXTURE_STUBS_JS = String.raw`
const jq = function () {
  return { css() { return this }, html() { return this }, prop() { return '' }, text() { return this }, attr() { return this }, hide() { return this }, show() { return this }, toggle() { return this }, toggleClass() { return this }, addClass() { return this }, removeClass() { return this }, removeData() { return this }, data() { return this }, off() { return this }, on() { return this }, parent() { return this }, children() { return this }, get() { return [] }, width() { return 0 }, is() { return false } }
}
jq.extend = function (target, ...sources) { return Object.assign(target || {}, ...sources.filter(Boolean)) }
jq.each = function (value, callback) { if (Array.isArray(value)) value.forEach((item, index) => callback(index, item)); else Object.keys(value || {}).forEach((key) => callback(key, value[key])); return value }
jq.type = function (value) { return value == null ? String(value) : Array.isArray(value) ? 'array' : typeof value }
jq.ajax = function (request) {
  const url = typeof request === 'string' ? request : request.url
  const xhr = new XMLHttpRequest()
  xhr.open('GET', url, false)
  xhr.send()
  if (xhr.status !== 200 && xhr.status !== 0) throw new Error('local fixture read failed: ' + url)
  return { responseText: xhr.responseText }
}
window.$ = window.jQuery = jq
`

async function writeFixtureFiles() {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'damecon-agent-api-smoke-'))
  const agentPath = path.join(fixtureRoot, 'agent.html')
  const gamePath = path.join(fixtureRoot, 'game.html')
  const preloadPath = path.join(fixtureRoot, 'agent-preload.cjs')
  await fs.writeFile(agentPath, AGENT_HTML)
  const { buildSync } = require('esbuild')
  buildSync({
    stdin: {
      contents: PRODUCTION_PRELOAD_ENTRY,
      resolveDir: path.resolve(__dirname, '..'),
      sourcefile: 'agent-preload-entry.js',
    },
    bundle: true,
    external: ['electron'],
    format: 'cjs',
    outfile: preloadPath,
    platform: 'node',
  })

  const kc3Path = path.join(fixtureRoot, 'kc3-extension')
  const webuiPath = path.join(fixtureRoot, 'webui-extension')
  await fs.mkdir(path.join(kc3Path, 'assets', 'js'), { recursive: true })
  await fs.mkdir(path.join(kc3Path, 'library', 'modules'), { recursive: true })
  await fs.mkdir(path.join(kc3Path, 'pages', 'devtools', 'themes'), { recursive: true })
  await fs.mkdir(webuiPath, { recursive: true })
  await fs.writeFile(
    path.join(kc3Path, 'pages', 'devtools', 'themes', 'fixture-stubs.js'),
    FIXTURE_STUBS_JS,
  )
  await fs.writeFile(
    path.join(kc3Path, 'pages', 'devtools', 'themes', 'fixture-init.js'),
    KC3_INIT_JS,
  )

  const realExtension = path.resolve(__dirname, '../extensions/kc3kai-release')
  const bundled = [
    ['assets/js/global.js', 'assets/js/global.js'],
    ['library/objects.js', 'library/objects.js'],
    ['library/managers.js', 'library/managers.js'],
    ['library/modules/Master.js', 'library/modules/Master.js'],
    ['library/modules/RemodelDb.js', 'library/modules/RemodelDb.js'],
    ['library/modules/Translation.js', 'library/modules/Translation.js'],
    ['library/modules/Meta.js', 'library/modules/Meta.js'],
    ['data/icons.json', 'data/icons.json'],
    ['data/seasonal_icons.json', 'data/seasonal_icons.json'],
    ['data/exp_hq.json', 'data/exp_hq.json'],
    ['data/exp_ship.json', 'data/exp_ship.json'],
    ['data/edges.json', 'data/edges.json'],
    ['data/edges_p1.json', 'data/edges_p1.json'],
    ['data/nodes.json', 'data/nodes.json'],
    ['data/gunfit.json', 'data/gunfit.json'],
    ['data/fud_weekly.json', 'data/fud_weekly.json'],
    ['data/fud_quarterly.json', 'data/fud_quarterly.json'],
    ['data/akashi.json', 'data/akashi.json'],
    ['data/quests_meta.json', 'data/quests_meta.json'],
    ['data/WhoCallsTheFleet_items.nedb', 'data/WhoCallsTheFleet_items.nedb'],
    ['data/lang/data/troll/terms.json', 'data/lang/data/troll/terms.json'],
    ['data/lang/data/en/ships.json', 'data/lang/data/en/ships.json'],
    ['data/lang/data/en/items.json', 'data/lang/data/en/items.json'],
    ['data/lang/data/en/useitems.json', 'data/lang/data/en/useitems.json'],
    ['data/lang/data/en/ship_affix.json', 'data/lang/data/en/ship_affix.json'],
    ['data/lang/data/en/equiptype.json', 'data/lang/data/en/equiptype.json'],
    ['data/lang/data/en/quests.json', 'data/lang/data/en/quests.json'],
    ['data/lang/data/en/ranks.json', 'data/lang/data/en/ranks.json'],
    ['data/lang/data/en/stype.json', 'data/lang/data/en/stype.json'],
    ['data/lang/data/en/ctype.json', 'data/lang/data/en/ctype.json'],
    ['data/lang/data/en/servers.json', 'data/lang/data/en/servers.json'],
    ['data/lang/data/en/battle.json', 'data/lang/data/en/battle.json'],
    ['data/lang/data/en/terms.json', 'data/lang/data/en/terms.json'],
    ['data/lang/data/en/terms_extend.json', 'data/lang/data/en/terms_extend.json'],
  ]
  await Promise.all(
    bundled.map(async ([source, target]) => {
      const destination = path.join(kc3Path, target)
      await fs.mkdir(path.dirname(destination), { recursive: true })
      await fs.copyFile(path.join(realExtension, source), destination)
    }),
  )
  const questMetaPath = path.join(kc3Path, 'data', 'quests_meta.json')
  const questMeta = JSON.parse(await fs.readFile(questMetaPath, 'utf8'))
  const questMetaId = questMeta['101'] ? '101' : Object.keys(questMeta).find((id) => /\d/.test(id))
  if (questMetaId) {
    const record =
      questMeta[questMetaId] && typeof questMeta[questMetaId] === 'object'
        ? questMeta[questMetaId]
        : {}
    const unlocks = record.unlock || record.unlocks || record.unlockQuestIds || []
    record.unlock = [...(Array.isArray(unlocks) ? unlocks : []), 999999]
    questMeta[questMetaId] = record
    await fs.writeFile(questMetaPath, JSON.stringify(questMeta))
  }
  await fs.writeFile(
    path.join(kc3Path, 'manifest.json'),
    JSON.stringify({
      manifest_version: 2,
      name: 'KC3 agent smoke fixture',
      version: '1.0.0',
      web_accessible_resources: ['pages/devtools/themes/fixture.html'],
    }),
  )
  await fs.writeFile(
    path.join(webuiPath, 'manifest.json'),
    JSON.stringify({
      manifest_version: 2,
      name: 'Damecon agent smoke fixture',
      version: '1.0.0',
    }),
  )
  await fs.writeFile(path.join(webuiPath, 'agent.html'), AGENT_HTML)
  await fs.writeFile(path.join(kc3Path, 'pages', 'devtools', 'themes', 'fixture.html'), KC3_HTML)
  fixturePaths = { agentPath, gamePath, preloadPath, kc3Path, webuiPath }
  return fixturePaths
}

function extensionFrame() {
  const frames = gameWindow.webContents.mainFrame.framesInSubtree || []
  const prefix = `chrome-extension://${kc3Extension.id}/pages/devtools/themes/`
  const frame = frames.find((candidate) => candidate.url.startsWith(prefix))
  assert.ok(frame, `KC3 fixture frame ${prefix} was not loaded`)
  return frame
}

function rawMcpRequest(url, options = {}) {
  const body = JSON.stringify(options.body === undefined ? {} : options.body)
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: options.method || 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () =>
          resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }),
        )
      },
    )
    request.on('error', reject)
    request.end(body)
  })
}

async function runMcpSmoke() {
  const { createAgentToolService } = require(
    path.resolve(__dirname, '../packages/shell/browser/agent-api/service.js'),
  )
  const { startMcpHttpServer } = require(
    path.resolve(__dirname, '../packages/shell/browser/agent-api/mcp-http-server.js'),
  )
  const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
  const {
    StreamableHTTPClientTransport,
  } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
  const service = createAgentToolService({ bridge })
  const token = 'agent-api-smoke-token'
  mcpServer = await startMcpHttpServer({ service, host: '127.0.0.1', port: 0, token })
  const address = mcpServer.address()
  assert.ok(address && typeof address.port === 'number')
  const url = `http://127.0.0.1:${address.port}/mcp`
  assert.equal((await rawMcpRequest(url, { token: 'wrong-token', body: {} })).status, 401)

  mcpClient = new Client({ name: 'damecon-agent-api-smoke', version: '1.0.0' })
  await mcpClient.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  )
  const listed = await mcpClient.listTools()
  assert.equal(listed.tools.length, 8, JSON.stringify(listed.tools))
  assert.deepEqual(
    listed.tools.map((tool) => tool.name),
    [
      'damecon_get_snapshot',
      'damecon_get_fleets',
      'damecon_get_land_bases',
      'damecon_get_equipment',
      'damecon_get_improvements',
      'damecon_get_quests',
      'damecon_get_schema',
      'damecon_health',
    ],
  )
  const health = await mcpClient.callTool({ name: 'damecon_health', arguments: {} })
  assert.equal(health.structuredContent.status, 'ok', JSON.stringify(health))
  const fleets = await mcpClient.callTool({ name: 'damecon_get_fleets', arguments: {} })
  const fleet = fleets.structuredContent.data.fleets[0]
  assert.ok(fleet.ships[0].slots[0].name, JSON.stringify(fleet.ships[0].slots[0]))
  assert.ok(Number.isFinite(fleet.metrics.fighterPower), JSON.stringify(fleet))
  assert.ok(Number.isFinite(fleet.metrics.eLos), JSON.stringify(fleet))
  assert.ok(Number.isFinite(fleet.metrics.transport.obtainTP.rankS), JSON.stringify(fleet))
  const landBases = await mcpClient.callTool({ name: 'damecon_get_land_bases', arguments: {} })
  const landBase = landBases.structuredContent.data[0]
  assert.ok(landBase.planes[0].name, JSON.stringify(landBase.planes[0]))
  assert.ok(landBase.metrics.sortieFighterPower > 0, JSON.stringify(landBase))
  assert.ok(Number.isFinite(landBase.metrics.defenseInterceptionPower), JSON.stringify(landBase))

  const oldRevision = health.structuredContent.revision
  await extensionFrame().executeJavaScript(
    'window.PlayerManager.hq.level = 91; window.PlayerManager.hq.lastMaterial[0] = 298',
  )
  const refreshed = await mcpClient.callTool({ name: 'damecon_get_snapshot', arguments: {} })
  assert.ok(refreshed.structuredContent.revision > oldRevision, JSON.stringify(refreshed))
  assert.equal(refreshed.structuredContent.data.player.hq.level, 91)
  assert.equal(refreshed.structuredContent.responseFormat, 'concise')
  assert.ok(refreshed.structuredContent.data.player)
  assert.ok(refreshed.structuredContent.data.fleets.fleets[0].metrics)
  assert.equal(refreshed.structuredContent.data.equipment.instances, undefined)
  await mcpClient.close()
  mcpClient = null
  await mcpServer.close()
  mcpServer = null
  return {
    endpoint: url,
    tools: listed.tools.length,
    fleetRevision: refreshed.structuredContent.revision,
    landBaseFighterPower: landBase.metrics.sortieFighterPower,
  }
}

async function invokeAgent(method, argument) {
  return agentWindow.webContents.executeJavaScript(
    `window.dameconAgent.${method}(${argument === undefined ? '' : JSON.stringify(argument)})`,
    true,
  )
}

async function runSmoke() {
  const { agentPath, gamePath, preloadPath, kc3Path, webuiPath } = fixturePaths

  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      networkRequests.push(details.url)
      callback({ cancel: true })
    },
  )

  const { AgentApiBridge } = require(
    path.resolve(__dirname, '../packages/shell/browser/agent-api/bridge.js'),
  )
  const { createAgentApiIntegration } = require(
    path.resolve(__dirname, '../packages/shell/browser/agent-api/integration.js'),
  )
  kc3Extension = await session.defaultSession.loadExtension(kc3Path, { allowFileAccess: true })
  webuiExtension = await session.defaultSession.loadExtension(webuiPath, { allowFileAccess: true })
  await fs.writeFile(gamePath, gameHtml(kc3Extension.id))

  gameWindow = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  gameWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    if (level >= 2) console.error(`[kc3 fixture] ${message} (${sourceId}:${line})`)
  })
  const frameLoaded = new Promise((resolve) => {
    gameWindow.webContents.on(
      'did-frame-finish-load',
      (event, isMainFrame, frameProcessId, frameRoutingId) => {
        if (isMainFrame) return
        const frame = gameWindow.webContents.mainFrame.framesInSubtree.find(
          (candidate) =>
            candidate.processId === frameProcessId && candidate.routingId === frameRoutingId,
        )
        if (
          frame &&
          frame.url.startsWith(`chrome-extension://${kc3Extension.id}/pages/devtools/themes/`)
        )
          resolve()
      },
    )
  })
  await Promise.all([gameWindow.loadFile(gamePath), frameLoaded])
  extensionFrame()

  bridge = new AgentApiBridge({
    getWebContents: () => [gameWindow.webContents],
    getKc3ExtensionId: () => kc3Extension.id,
    getExtensionPath: () => kc3Path,
  })
  assert.equal(bridge.inflight, null, 'bridge must start with no pending read')

  agentWindow = new BrowserWindow({
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false },
  })
  integration = createAgentApiIntegration({
    ipcMain,
    bridge,
    webuiExtensionId: webuiExtension.id,
    channel: 'agent-api-read',
  })
  await agentWindow.loadURL(`chrome-extension://${webuiExtension.id}/agent.html`)

  const invokeAgent = (method, argument) =>
    agentWindow.webContents.executeJavaScript(
      `window.dameconAgent.${method}(${argument === undefined ? '' : JSON.stringify(argument)})`,
      true,
    )
  const listedTools = await invokeAgent('listTools')
  assert.ok(listedTools.some((tool) => tool.name === 'damecon_get_snapshot'))
  const first = await invokeAgent('getSnapshot')
  const fixtureProbe = await extensionFrame().executeJavaScript(`({
    hasMaster: !!window.KC3Master,
    hasShip: !!window.KC3Ship,
    hasPlayer: !!window.PlayerManager,
    hasFleet: !!(window.PlayerManager && window.PlayerManager.fleets && window.PlayerManager.fleets[0]),
    hasShipManager: !!window.KC3ShipManager,
    url: location.href,
  })`)
  assert.deepEqual(fixtureProbe, {
    hasMaster: true,
    hasShip: true,
    hasPlayer: true,
    hasFleet: true,
    hasShipManager: true,
    url: fixtureProbe.url,
  })
  const metricDiagnostics = await extensionFrame().executeJavaScript(`(() => {
    const fleet = window.PlayerManager.fleets[0]
    const calls = {
      fighterPower: () => fleet.fighterPower(),
      fighterVeteran: () => fleet.fighterVeteran(),
      fighterBounds: () => fleet.fighterBounds(),
      eLoS: () => fleet.eLoS(),
      eLos4: () => fleet.eLos4(),
      calcTpObtain: () => {
        const result = fleet.calcTpObtain(false)
        return { value: Number(result.valueOf()), rankA: Number(result.valueOfRankA()) }
      },
    }
    const diagnostics = {}
    for (const [name, call] of Object.entries(calls)) {
      try {
        const value = call()
        diagnostics[name] = { ok: true, value }
      } catch (error) {
        diagnostics[name] = { ok: false, stack: error && error.stack ? error.stack : String(error) }
      }
    }
    return diagnostics
  })()`)
  assert.ok(
    Object.values(metricDiagnostics).every((item) => item.ok),
    `KC3 metric diagnostics failed: ${JSON.stringify(metricDiagnostics)}`,
  )
  assert.equal(first.schemaVersion, '1.1')
  assert.equal(first.responseFormat, 'detailed')
  assert.equal(first.source.status, 'live', JSON.stringify(first))
  assert.ok(
    !first.warnings.some((item) => item.code === 'read_failed'),
    JSON.stringify(first.warnings),
  )
  assert.equal(first.data.player.hq.level, 88)
  assert.equal(first.data.fleets.fleets[0].ships[0].id, 101)
  const fleetMetrics = first.data.fleets.fleets[0].metrics
  assert.ok(Number.isFinite(fleetMetrics.fighterPower), JSON.stringify(fleetMetrics))
  assert.ok(Number.isFinite(fleetMetrics.eLos), JSON.stringify(fleetMetrics))
  assert.ok(Number.isFinite(fleetMetrics.transport.obtainTP.rankS), JSON.stringify(fleetMetrics))
  assert.ok(Number.isFinite(fleetMetrics.transport.obtainTP.rankA), JSON.stringify(fleetMetrics))
  const landBaseMetrics = first.data.landBases[0] && first.data.landBases[0].metrics
  assert.ok(landBaseMetrics, JSON.stringify(first.data.landBases))
  assert.ok(landBaseMetrics.sortieFighterPower > 0, JSON.stringify(landBaseMetrics))
  assert.ok(
    Number.isFinite(landBaseMetrics.sortieFighterBounds.lower),
    JSON.stringify(landBaseMetrics),
  )
  assert.ok(
    Number.isFinite(landBaseMetrics.sortieFighterBounds.upper),
    JSON.stringify(landBaseMetrics),
  )
  assert.ok(
    Number.isFinite(landBaseMetrics.defenseInterceptionPower),
    JSON.stringify(landBaseMetrics),
  )
  assert.deepEqual(first.data.player.resources, [300, 280, 500, 400, 4, 2, 1, 0])
  assert.equal(first.data.player.secretary.masterId, 1)
  assert.ok(first.data.player.secretary.name, JSON.stringify(first.data.player.secretary))
  assert.ok(first.data.equipment.instances.some((item) => item.masterId === 1 && item.name))
  assert.ok(first.data.equipment.instances.some((item) => item.masterId === 204 && item.name))
  assert.ok(first.data.fleets.fleets[0].ships[0].slots[0].name)
  assert.ok(first.data.landBases[0].planes[0].name)

  const frame = extensionFrame()
  await frame.executeJavaScript(
    'window.PlayerManager.hq.level = 89; window.PlayerManager.hq.lastMaterial[0] = 299',
  )
  const second = await invokeAgent('getSnapshot')
  assert.ok(second.revision > first.revision, 'on-demand calls must observe a newer revision')
  assert.ok(
    !second.warnings.some((item) => item.code === 'read_failed'),
    JSON.stringify(second.warnings),
  )
  assert.equal(second.data.player.hq.level, 89)
  assert.equal(second.data.player.resources[0], 299)

  const fleets = await invokeAgent('getFleets')
  assert.equal(fleets.data.fleets[0].name, 'First Fleet')
  const equipment = await invokeAgent('getEquipment', { masterId: 204 })
  assert.equal(equipment.data.total, 1)
  assert.ok(equipment.data.instances[0].name)
  const allImprovements = await invokeAgent('getImprovements', {})
  assert.equal(allImprovements.data.schedule.length, 7)
  assert.ok(
    allImprovements.data.schedule.every((day) => day.entries.length > 0),
    'all seven improvement days must have entries',
  )
  const improvements = await invokeAgent('getImprovements', { equipmentId: 1 })
  assert.ok(
    improvements.data.entries.every(
      (entry) =>
        entry.name &&
        entry.secretaryNames &&
        entry.recipes.some((recipe) => recipe.requirements.length > 0 && recipe.resources),
    ),
    'improvements need names, secretary names, and recipe resources',
  )
  const quests = await invokeAgent('getQuests', { mode: 'knowledge', id: 101 })
  assert.ok(
    quests.data.items.length > 0 && quests.data.items[0].name,
    'real quest names must be loaded',
  )
  const allQuests = await invokeAgent('getQuests', { mode: 'knowledge' })
  assert.ok(
    allQuests.data.items.some((item) => item.unknown === true && item.id === 999999),
    'quest graph must retain unknown unlock targets',
  )
  const schema = await invokeAgent('getSchema')
  assert.equal(schema.transport, 'browser-native-and-mcp')
  const health = await invokeAgent('health')
  assert.equal(health.status, 'ok')

  attackerWindow = new BrowserWindow({
    show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false },
  })
  await attackerWindow.loadFile(agentPath)
  await assert.rejects(
    attackerWindow.webContents.executeJavaScript('window.dameconAgent.getSnapshot()', true),
    /only available to Damecon agent\.html/,
    'untrusted file pages must not invoke the agent API',
  )

  assert.deepEqual(networkRequests, [], 'smoke fixtures must not issue HTTP(S) requests')
  assert.equal(bridge.inflight, null, 'on-demand bridge reads must settle before returning')
  const mcp = await runMcpSmoke()
  return {
    windows: 3,
    calls: 9,
    revision: second.revision,
    networkRequests,
    backgroundTimer: bridge.timer || null,
    latestHqLevel: second.data.player.hq.level,
    knowledgeQuest: quests.data.items[0].name,
    fleetMetrics: {
      fighterPower: fleetMetrics.fighterPower,
      eLos: fleetMetrics.eLos,
      obtainTP: fleetMetrics.transport.obtainTP,
    },
    landBaseMetrics,
    mcp,
  }
}

async function cleanup() {
  if (mcpClient) await mcpClient.close().catch(() => {})
  mcpClient = null
  if (mcpServer) await mcpServer.close().catch(() => {})
  mcpServer = null
  if (integration) integration.stop()
  for (const window of [agentWindow, attackerWindow, gameWindow]) {
    if (window && !window.isDestroyed()) window.destroy()
  }
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true }).catch(() => {})
}

async function main() {
  let exitCode = 0
  const watchdog = setTimeout(() => {
    console.error(`agent-api smoke timed out after ${TIMEOUT_MS}ms`)
    app.exit(1)
  }, TIMEOUT_MS)
  try {
    await writeFixtureFiles()
    app.setPath('userData', path.join(fixtureRoot, 'user-data'))
    await app.whenReady()
    const result = await runSmoke()
    console.log(JSON.stringify({ ok: true, ...result }))
  } catch (error) {
    exitCode = 1
    console.error((error && error.stack) || error)
  } finally {
    clearTimeout(watchdog)
    await cleanup()
    process.exitCode = exitCode
    app.exit(exitCode)
  }
}

void main()
