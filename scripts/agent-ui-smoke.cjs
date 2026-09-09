'use strict'

// Isolated UI smoke test. It loads the production Agent Tools page with a
// context-isolated mock bridge; it never attaches to the game or starts MCP.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { app, BrowserWindow } = require('electron')
const { listTools } = require('../packages/shell/browser/agent-api/tools.js')

const TOKEN = 'ui-smoke-secret'
const tools = listTools()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'damecon-agent-ui-'))
const preload = path.join(profile, 'preload.cjs')
const html = path.resolve(__dirname, '../packages/shell/browser/ui/agent.html')
const requests = []
let activeWindow

function writePreload() {
  const descriptors = JSON.stringify(tools)
  fs.writeFileSync(
    preload,
    `'use strict'
const { contextBridge } = require('electron')
const descriptors = ${descriptors}
const calls = []
let responseMode = 'live'
let responseTag = ''
let delayMs = 0
function response(name, args) {
  if (name === 'damecon_get_equipment' && Object.keys(args).every((key) => key === 'responseFormat')) {
    return { schemaVersion: '1.0', revision: 1, capturedAt: '2026-09-09T00:00:00.000Z', source: { status: 'live' }, data: { categories: [{ id: 2, name: '战斗机', count: 3 }, { id: 3, name: '舰攻', count: 1 }] }, warnings: [] }
  }
  if (responseMode === 'unavailable') return { schemaVersion: '1.0', revision: 2, capturedAt: '2026-09-09T00:00:01.000Z', source: { status: 'unavailable' }, data: null, warnings: ['mock unavailable'] }
  const data = { mock: true, tool: name, args, tag: responseTag }
  if (responseTag === 'page1' && name === 'damecon_get_equipment') {
    data.pagination = { total: 2, returned: 1, nextCursor: args.cursor ? null : 'next_1' }
  }
  if (responseTag === 'large') {
    data.large = 'x'.repeat(3_000_000)
    data.largeArray = Array.from({ length: 300_000 }, (_, index) => index)
  }
  return { schemaVersion: '1.0', revision: 1, capturedAt: '2026-09-09T00:00:00.000Z', source: { status: 'live' }, data, warnings: [] }
}
contextBridge.exposeInMainWorld('dameconAgent', {
  listTools: async () => descriptors,
  callTool: async (name, args) => {
    calls.push({ name, args })
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
    return response(name, args || {})
  },
  getMcpStatus: async () => ({ enabled: false, host: '127.0.0.1', port: 39273, running: false, token: ${JSON.stringify(TOKEN)}, urls: [] }),
  configureMcp: async (config) => ({ ...config, running: false }),
  rotateMcpToken: async () => ({ token: ${JSON.stringify(TOKEN)}, running: false })
})
contextBridge.exposeInMainWorld('__uiSmoke', {
  getCalls: () => calls,
  setDelay: (value) => { delayMs = Number(value) || 0 },
  setResponseMode: (value) => { responseMode = value === 'unavailable' ? 'unavailable' : 'live' },
  setResponseTag: (value) => { responseTag = String(value || '') }
})
`,
    'utf8',
  )
}

function fail(message) {
  throw new Error(message)
}

function assert(condition, message) {
  if (!condition) fail(message)
}

function defaultsFor(tool) {
  return Object.fromEntries(
    Object.entries((tool.inputSchema && tool.inputSchema.properties) || {})
      .filter(([, schema]) => schema.default !== undefined)
      .map(([key, schema]) => [key, schema.default]),
  )
}

async function waitFor(condition, message, timeout = 3000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  fail(message)
}

async function evaluate(window, source) {
  return window.webContents.executeJavaScript(`(${source})()`)
}

async function callsOf(window) {
  return evaluate(window, '() => window.__uiSmoke.getCalls()')
}

async function clickTool(window, name) {
  await evaluate(
    window,
    `() => { const button = document.querySelector('.tool-button[data-tool-name=${JSON.stringify(name)}]'); if (!button) throw new Error('missing tool ' + ${JSON.stringify(name)}); button.click() }`,
  )
  await waitFor(
    async () =>
      evaluate(
        window,
        '() => Boolean(document.querySelector("#call-tool") && !document.querySelector("#call-tool").disabled)',
      ),
    `tool did not render: ${name}`,
  )
}

async function invokeSelected(window, name) {
  const before = (await callsOf(window)).length
  await evaluate(window, '() => document.querySelector("#call-tool").click()')
  await waitFor(async () => (await callsOf(window)).length > before, `tool was not called: ${name}`)
  await waitFor(
    async () => evaluate(window, '() => !document.querySelector("#call-tool").disabled'),
    `tool remained busy: ${name}`,
  )
  const calls = await callsOf(window)
  return calls[calls.length - 1]
}

async function invoke(window, name) {
  await clickTool(window, name)
  return invokeSelected(window, name)
}

async function setSelect(window, selector, value) {
  await evaluate(
    window,
    `() => { const selector = ${JSON.stringify(selector)}; const value = ${JSON.stringify(value)}; const el = document.querySelector(selector); if (!el) throw new Error('missing select ' + selector); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })) }`,
  )
}

async function run() {
  app.setPath('userData', profile)
  app.commandLine.appendSwitch('disable-gpu')
  writePreload()
  await app.whenReady()
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: false },
  })
  activeWindow = win
  win.webContents.session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (details, callback) => {
      requests.push(details.url)
      callback({ cancel: true })
    },
  )
  await win.loadFile(html)

  // Keep clipboard and download assertions inside the test page; no user
  // clipboard is touched and no file is written to the project.
  await evaluate(
    win,
    `() => {
    window.__smokeClipboard = ''
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (value) => { window.__smokeClipboard = String(value); return Promise.resolve() } } })
    window.__smokeDownload = ''
    window.__smokeDownloadName = ''
    const NativeURL = window.URL
    NativeURL.createObjectURL = (blob) => { blob.text().then((value) => { window.__smokeDownload = value }); return 'blob:ui-smoke' }
    NativeURL.revokeObjectURL = () => {}
    HTMLAnchorElement.prototype.click = function () { window.__smokeDownloadName = this.download }
  }`,
  )
  await waitFor(
    async () =>
      (await evaluate(win, '() => document.querySelector("#status").textContent')) ===
      '8 个工具已就绪',
    'dynamic tool discovery did not complete',
  )

  const names = await evaluate(
    win,
    '() => [...document.querySelectorAll(".tool-button")].map((button) => button.dataset.toolName)',
  )
  assert(
    JSON.stringify(names) === JSON.stringify(tools.map((tool) => tool.name)),
    'tool list is not sourced from descriptors',
  )
  assert(
    await evaluate(win, '() => !document.querySelector("#mcp-setup").open'),
    'MCP setup is open by default',
  )
  assert(
    await evaluate(win, '() => document.querySelector("#mcp-token").type === "password"'),
    'MCP token is visible by default',
  )
  assert(
    !String(await evaluate(win, '() => document.body.textContent')).includes(TOKEN),
    'MCP token leaked into page text',
  )

  // Every tool with an empty schema must pass the exact empty object.
  for (const name of [
    'damecon_get_snapshot',
    'damecon_get_fleets',
    'damecon_get_land_bases',
    'damecon_get_schema',
    'damecon_health',
  ]) {
    const call = await invoke(win, name)
    const expected = defaultsFor(tools.find((tool) => tool.name === name))
    assert(
      JSON.stringify(call.args) === JSON.stringify(expected),
      `${name} did not apply only schema defaults`,
    )
  }

  // Exercise every enum with its raw schema value, rather than its localized label.
  const enumTool = tools.find((tool) => tool.inputSchema.properties.day)
  await clickTool(win, enumTool.name)
  const dayValues = enumTool.inputSchema.properties.day.enum
  for (const value of dayValues) {
    await setSelect(win, '[data-key="day"]', value)
    const call = await invokeSelected(win, enumTool.name)
    assert(call.args.day === value, `day enum was localized or altered: ${value}`)
  }
  await clickTool(win, enumTool.name)
  const blankEnumCall = await invokeSelected(win, enumTool.name)
  assert(
    JSON.stringify(blankEnumCall.args) === JSON.stringify(defaultsFor(enumTool)),
    'blank optional fields/defaults were sent incorrectly',
  )

  const modeTool = tools.find((tool) => tool.inputSchema.properties.mode)
  await clickTool(win, modeTool.name)
  for (const value of modeTool.inputSchema.properties.mode.enum) {
    await setSelect(win, '[data-key="mode"]', value)
    const call = await invokeSelected(win, modeTool.name)
    assert(call.args.mode === value, `mode enum was altered: ${value}`)
  }
  const formatTool = tools.find((tool) => tool.inputSchema.properties.responseFormat)
  if (formatTool) {
    await clickTool(win, formatTool.name)
    const formatSelect = await evaluate(
      win,
      '() => document.querySelector("[data-key=\\"responseFormat\\"]").value',
    )
    assert(
      formatSelect === formatTool.inputSchema.properties.responseFormat.default,
      'responseFormat default was not rendered',
    )
    for (const value of formatTool.inputSchema.properties.responseFormat.enum) {
      await setSelect(win, '[data-key="responseFormat"]', value)
      const call = await invokeSelected(win, formatTool.name)
      assert(call.args.responseFormat === value, `responseFormat enum was altered: ${value}`)
    }
  }

  // Equipment categories must come from the tool response, and no category
  // or masterId should be fabricated when the optional controls are blank.
  await clickTool(win, 'damecon_get_equipment')
  await waitFor(
    async () =>
      evaluate(
        win,
        '() => document.querySelectorAll("select[data-key=category] option").length >= 3',
      ),
    'equipment categories did not load from tool data',
  )
  const categoryValues = await evaluate(
    win,
    '() => [...document.querySelectorAll("select[data-key=category] option")].map((option) => option.value)',
  )
  assert(
    categoryValues.includes('2') && categoryValues.includes('3'),
    'equipment category options are not tool data',
  )
  const equipmentBlank = await invokeSelected(win, 'damecon_get_equipment')
  assert(
    JSON.stringify(equipmentBlank.args) ===
      JSON.stringify(defaultsFor(tools.find((tool) => tool.name === 'damecon_get_equipment'))),
    'blank equipment options were not omitted',
  )
  await setSelect(win, 'select[data-key="category"]', '2')
  const equipmentCategory = await invokeSelected(win, 'damecon_get_equipment')
  assert(
    equipmentCategory.args.category === 2,
    'equipment category was not sent as raw numeric data',
  )

  // Quest IDs support one positive integer or a non-empty positive array.
  await clickTool(win, 'damecon_get_quests')
  await evaluate(
    win,
    '() => { const input = document.querySelector("[data-id]"); input.value = "101" }',
  )
  const singleQuest = await invokeSelected(win, 'damecon_get_quests')
  assert(singleQuest.args.id === 101, 'single quest ID was not sent as a positive integer')
  await setSelect(win, '[data-key="id-mode"]', 'array')
  await evaluate(
    win,
    '() => { const rows = document.querySelector("[data-id-rows]"); const add = [...document.querySelectorAll("#tool-form button")].find((button) => button.textContent === "添加 ID"); add.click(); const inputs = rows.querySelectorAll("[data-id]"); inputs[0].value = "101"; inputs[1].value = "102" }',
  )
  const arrayQuest = await invokeSelected(win, 'damecon_get_quests')
  assert(
    JSON.stringify(arrayQuest.args.id) === '[101,102]',
    'quest ID array was not sent as positive integers',
  )

  // A numeric minimum is a real interaction guard: invalid input must not
  // reach the bridge.
  await clickTool(win, 'damecon_get_equipment')
  const beforeInvalid = (await callsOf(win)).length
  await evaluate(
    win,
    '() => { const input = document.querySelector("input[data-key=masterId]"); input.value = "0"; document.querySelector("#call-tool").click() }',
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert((await callsOf(win)).length === beforeInvalid, 'invalid numeric input reached callTool')
  await clickTool(win, 'damecon_get_quests')
  const beforeInvalidQuest = (await callsOf(win)).length
  await evaluate(
    win,
    '() => { const input = document.querySelector("[data-id]"); input.value = "0"; document.querySelector("#call-tool").click() }',
  )
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert((await callsOf(win)).length === beforeInvalidQuest, 'invalid quest ID reached callTool')

  // The synchronous disabled transition must make a double-click one call.
  await clickTool(win, 'damecon_get_snapshot')
  await evaluate(win, '() => window.__uiSmoke.setDelay(100)')
  const beforeDouble = (await callsOf(win)).length
  await evaluate(
    win,
    '() => { const button = document.querySelector("#call-tool"); button.click(); button.click() }',
  )
  await waitFor(
    async () => (await callsOf(win)).length > beforeDouble,
    'double-click did not call tool',
  )
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert(
    (await callsOf(win)).length === beforeDouble + 1,
    'double-click caused duplicate tool calls',
  )
  await evaluate(win, '() => window.__uiSmoke.setDelay(0)')

  // Large responses are previewed in the DOM, while copy/download use the
  // complete in-memory result rather than the truncated preview.
  await evaluate(win, '() => window.__uiSmoke.setResponseTag("large")')
  await invoke(win, 'damecon_get_snapshot')
  const largePreview = await evaluate(
    win,
    '() => document.querySelector("#result-json").textContent',
  )
  assert(
    largePreview.includes('预览受限') && largePreview.includes('完整长度未计算'),
    'large result preview marker is missing',
  )
  assert(largePreview.length < 51_000, 'large result preview exceeded its UI limit')
  await evaluate(win, '() => document.querySelector("#copy-result").click()')
  await waitFor(
    async () => await evaluate(win, '() => Boolean(window.__smokeClipboard)'),
    'large result copy did not run',
  )
  assert(
    (await evaluate(win, '() => window.__smokeClipboard.length')) > 5_000_000,
    'copy did not contain the complete large result',
  )
  await evaluate(win, '() => document.querySelector("#download-result").click()')
  await waitFor(
    async () => await evaluate(win, '() => Boolean(window.__smokeDownload)'),
    'large result download did not run',
  )
  assert(
    (await evaluate(win, '() => window.__smokeDownload.length')) > 5_000_000,
    'download did not contain the complete large result',
  )
  await evaluate(win, '() => window.__uiSmoke.setResponseTag("")')

  // Pagination is bound to the successful query arguments. The next-page
  // button fills the cursor and cannot reuse a cursor after filters change.
  await evaluate(win, '() => window.__uiSmoke.setResponseMode("live")')
  await evaluate(win, '() => window.__uiSmoke.setResponseTag("page1")')
  await clickTool(win, 'damecon_get_equipment')
  await waitFor(
    async () =>
      evaluate(
        win,
        '() => document.querySelectorAll("select[data-key=category] option").length >= 3',
      ),
    'equipment categories did not load before pagination test',
  )
  await setSelect(win, 'select[data-key="responseFormat"]', 'concise')
  await evaluate(
    win,
    '() => { const input = document.querySelector("input[data-key=limit]"); if (input) input.value = "1" }',
  )
  const pageOne = await invokeSelected(win, 'damecon_get_equipment')
  assert(pageOne.args.limit === 1, 'pagination limit was not submitted')
  assert(
    await evaluate(win, '() => !document.querySelector("#next-page").disabled'),
    'next-page button was not enabled',
  )
  await evaluate(
    win,
    '() => { const input = document.querySelector("input[data-key=\\"query\\"]"); if (input) { input.value = "changed"; input.dispatchEvent(new Event("input", { bubbles: true })) } }',
  )
  assert(
    await evaluate(win, '() => document.querySelector("#next-page").disabled'),
    'filter change left a stale next-page button enabled',
  )
  await evaluate(
    win,
    '() => { const input = document.querySelector("input[data-key=\\"query\\"]"); if (input) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })) } }',
  )
  const pageOneAgain = await invokeSelected(win, 'damecon_get_equipment')
  assert(
    pageOneAgain.args.limit === 1 && !pageOneAgain.args.cursor,
    'new pagination query did not restart without cursor',
  )
  const beforeNext = (await callsOf(win)).filter(
    (call) => call.name === 'damecon_get_equipment',
  ).length
  await evaluate(win, '() => document.querySelector("#next-page").click()')
  await waitFor(
    async () =>
      (await callsOf(win)).filter((call) => call.name === 'damecon_get_equipment').length >
      beforeNext,
    'next-page click did not call the tool',
  )
  const pageTwo = (await callsOf(win))
    .filter((call) => call.name === 'damecon_get_equipment')
    .at(-1)
  assert(pageTwo.args.cursor === 'next_1', 'next-page did not submit the returned cursor')
  assert(
    await evaluate(win, '() => document.querySelector("#next-page").disabled'),
    'next-page remained enabled after final page',
  )
  await evaluate(win, '() => window.__uiSmoke.setResponseTag("")')

  // Both source states are rendered from the live bridge response.
  await evaluate(win, '() => window.__uiSmoke.setResponseMode("live")')
  await invoke(win, 'damecon_get_snapshot')
  const liveJson = await evaluate(win, '() => document.querySelector("#result-json").textContent')
  assert(liveJson.includes('"status": "live"'), 'live result was not displayed')
  const liveMeta = await evaluate(win, '() => document.querySelector("#result-meta").textContent')
  assert(
    liveMeta.includes('source=live') && liveMeta.includes('revision=1'),
    'live source metadata was not displayed',
  )
  await evaluate(win, '() => window.__uiSmoke.setResponseMode("unavailable")')
  await invoke(win, 'damecon_health')
  const unavailableText = await evaluate(
    win,
    '() => document.querySelector("#result-json").textContent',
  )
  assert(
    unavailableText.includes('"status": "unavailable"') &&
      unavailableText.includes('mock unavailable'),
    'unavailable result was not displayed',
  )
  const unavailableMeta = await evaluate(
    win,
    '() => document.querySelector("#result-meta").textContent',
  )
  assert(
    unavailableMeta.includes('source=unavailable') && unavailableMeta.includes('revision=2'),
    'unavailable source metadata was not displayed',
  )

  // Selecting another tool without calling it must not change the download
  // name: the result belongs to the last completed call.
  await clickTool(win, 'damecon_get_snapshot')
  await evaluate(win, '() => document.querySelector("#copy-result").click()')
  await waitFor(
    async () => await evaluate(win, '() => Boolean(window.__smokeClipboard)'),
    'copy result did not run',
  )
  const clipboard = await evaluate(win, '() => window.__smokeClipboard')
  assert(!clipboard.includes(TOKEN), 'copy result included MCP token')
  await evaluate(win, '() => document.querySelector("#download-result").click()')
  await waitFor(
    async () => await evaluate(win, '() => Boolean(window.__smokeDownload)'),
    'download result did not run',
  )
  const download = await evaluate(win, '() => window.__smokeDownload')
  assert(!download.includes(TOKEN), 'download result included MCP token')
  assert(
    (await evaluate(win, '() => window.__smokeDownloadName')) === 'damecon_health.json',
    'download did not use the last called tool',
  )
  assert(requests.length === 0, `UI attempted network access (${requests.length} requests)`)

  // A timed-out request restores the controls. Its delayed bridge response
  // must not replace a later completed call.
  await evaluate(win, '() => window.__uiSmoke.setResponseMode("live")')
  await evaluate(win, '() => window.__uiSmoke.setResponseTag("timeout-old")')
  await evaluate(win, '() => window.__uiSmoke.setDelay(20500)')
  await clickTool(win, 'damecon_get_snapshot')
  const beforeTimeout = (await callsOf(win)).length
  await evaluate(win, '() => document.querySelector("#call-tool").click()')
  await waitFor(
    async () =>
      (await evaluate(win, '() => document.querySelector("#status").textContent')).startsWith(
        '调用超时',
      ),
    'call timeout did not restore the UI',
    23000,
  )
  assert((await callsOf(win)).length === beforeTimeout + 1, 'timed-out call was not recorded once')
  assert(
    await evaluate(win, '() => !document.querySelector("#call-tool").disabled'),
    'call button remained disabled after timeout',
  )
  await evaluate(
    win,
    '() => { window.__uiSmoke.setDelay(0); window.__uiSmoke.setResponseTag("after-timeout") }',
  )
  await invoke(win, 'damecon_health')
  await new Promise((resolve) => setTimeout(resolve, 700))
  const afterTimeout = await evaluate(
    win,
    '() => document.querySelector("#result-json").textContent',
  )
  assert(
    afterTimeout.includes('after-timeout') && !afterTimeout.includes('timeout-old'),
    'late timeout response replaced a later result',
  )

  return {
    toolCount: names.length,
    callCount: (await callsOf(win)).length,
    networkRequests: requests.length,
  }
}

async function main() {
  let result
  let error
  try {
    result = await run()
  } catch (caught) {
    error = caught
  } finally {
    if (activeWindow && !activeWindow.isDestroyed()) activeWindow.destroy()
  }
  if (error) {
    console.error(`agent-ui-smoke failed: ${error.message}`)
    if (app.isReady()) app.exit(1)
  } else {
    console.log(
      `agent-ui-smoke passed: tools=${result.toolCount} calls=${result.callCount} networkRequests=${result.networkRequests}`,
    )
    if (app.isReady()) app.exit(0)
  }
}

main()
