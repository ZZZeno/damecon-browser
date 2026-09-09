'use strict'
const $ = (id) => document.getElementById(id)
const RESULT_PREVIEW_LIMIT = 50_000
const CALL_TIMEOUT_MS = 20_000
const state = {
  tools: [],
  tool: null,
  busy: false,
  result: null,
  lastTool: null,
  requestId: 0,
  nextPage: null,
}
let mcpRawToken = ''
let nextPageButton
function api() {
  if (!window.dameconAgent) throw new Error('window.dameconAgent is unavailable')
  return window.dameconAgent
}
function pretty(value) {
  const text = JSON.stringify(value, null, 2)
  return text === undefined ? String(value) : text
}
function measuredJsonLength(value, budget, depth = 0, nodes = { count: 0 }) {
  if (budget < 0 || depth > 40 || nodes.count++ > 20_000) return budget + 1
  if (value === null) return 4
  if (typeof value === 'string')
    return value.length > budget ? budget + 1 : JSON.stringify(value).length
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value).length
  if (typeof value !== 'object') return 4
  let length = 2
  let count = 0
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const childLength = measuredJsonLength(value[index], budget - length, depth + 1, nodes)
      length += (count ? 2 : 1) + (depth + 1) * 2 + childLength
      count += 1
      if (length > budget) return budget + 1
    }
  } else {
    for (const key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) continue
      const childLength = measuredJsonLength(value[key], budget - length, depth + 1, nodes)
      length += (count ? 2 : 1) + (depth + 1) * 2 + JSON.stringify(key).length + 2 + childLength
      count += 1
      if (length > budget) return budget + 1
    }
  }
  if (count) length += 1 + depth * 2
  return length > budget ? budget + 1 : length
}
function boundedString(value, budget) {
  const suffix = '…（字符串已截断）'
  if (value.length <= budget) return value
  let end = Math.max(0, budget - suffix.length - 2)
  let candidate = `${value.slice(0, end)}${suffix}`
  while (end > 0 && JSON.stringify(candidate).length > budget) {
    end = Math.floor(end * 0.8)
    candidate = `${value.slice(0, end)}${suffix}`
  }
  return candidate
}
function boundedPreview(value, budget) {
  let truncated = false
  const seen = new WeakSet()
  function visit(item, remaining, depth) {
    if (remaining < 32 || depth > 12) {
      truncated = true
      return '…（预览已截断）'
    }
    if (item === null || typeof item !== 'object') {
      if (typeof item === 'string') {
        const result = boundedString(item, remaining)
        if (result !== item) truncated = true
        return result
      }
      return item
    }
    if (seen.has(item)) {
      truncated = true
      return '…（循环引用）'
    }
    seen.add(item)
    const output = Array.isArray(item) ? [] : {}
    const entries = Array.isArray(item) ? item : null
    let index = 0
    let used = 2
    const visitEntry = (key, child) => {
      const childValue = visit(child, Math.max(32, remaining - used - 32), depth + 1)
      const childText = pretty(childValue)
      const keyText = Array.isArray(item) ? '' : `${JSON.stringify(key)}: `
      const addition =
        keyText.length +
        childText.length +
        (output.length ? 2 : 0) +
        (childText.match(/\n/g) || []).length * 2
      if (used + addition >= remaining) {
        truncated = true
        return false
      }
      if (Array.isArray(output)) output.push(childValue)
      else output[key] = childValue
      used += addition
      return true
    }
    if (Array.isArray(item)) {
      for (const child of entries) {
        if (!visitEntry(index++, child)) break
      }
    } else {
      for (const key in item) {
        if (Object.prototype.hasOwnProperty.call(item, key) && !visitEntry(key, item[key])) break
      }
    }
    seen.delete(item)
    if (truncated && Array.isArray(output)) output.push('…（预览已截断）')
    else if (truncated && !Array.isArray(output)) output['…（预览已截断）'] = true
    return output
  }
  let text = pretty(visit(value, budget, 0))
  if (text.length >= budget) text = pretty({ '…（预览已截断）': true })
  return { text, truncated }
}
function renderResult(result) {
  const measured = measuredJsonLength(result, RESULT_PREVIEW_LIMIT)
  if (measured <= RESULT_PREVIEW_LIMIT) {
    const fullText = pretty(result)
    return { text: fullText, length: fullText.length, preview: false }
  }
  const preview = boundedPreview(result, RESULT_PREVIEW_LIMIT - 1600)
  return {
    text: `${preview.text}\n\n…结果较大，预览受限；完整长度未计算。复制或下载可获取完整结果。`,
    length: null,
    preview: true,
  }
}
function displayResult(result) {
  const rendered = renderResult(result)
  $('result-json').textContent = rendered.text
  return rendered
}
function clearNextPage() {
  state.nextPage = null
  if (nextPageButton) nextPageButton.disabled = true
}
function updateNextPage(result, tool, args) {
  const pagination =
    (result && result.pagination) || (result && result.data && result.data.pagination)
  const nextCursor = pagination && pagination.nextCursor
  if (typeof nextCursor !== 'string' || !nextCursor) return clearNextPage()
  state.nextPage = { tool: tool.name, args: JSON.parse(JSON.stringify(args)), cursor: nextCursor }
  nextPageButton.disabled = false
}
async function callNextPage() {
  if (!state.nextPage || state.busy || !state.tool || state.nextPage.tool !== state.tool.name)
    return
  let currentArgs
  try {
    currentArgs = readArgs()
  } catch (_) {
    return clearNextPage()
  }
  if (JSON.stringify(currentArgs) !== JSON.stringify(state.nextPage.args)) return clearNextPage()
  const cursor = $('tool-form').querySelector('[data-key="cursor"]')
  if (!cursor) return clearNextPage()
  cursor.value = state.nextPage.cursor
  await callSelected()
}
function withTimeout(promise, timeoutMs) {
  let timer
  const settled = Promise.resolve(promise)
  settled.catch(() => {})
  return Promise.race([
    settled,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`调用超时（${Math.round(timeoutMs / 1000)} 秒）`)
        error.code = 'DAMECON_AGENT_TIMEOUT'
        reject(error)
      }, timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}
function labelFor(key, value) {
  const map = {
    day: {
      today: '今天',
      sun: '星期日',
      mon: '星期一',
      tue: '星期二',
      wed: '星期三',
      thu: '星期四',
      fri: '星期五',
      sat: '星期六',
    },
    mode: { current: '当前任务', knowledge: '任务知识图' },
    responseFormat: { concise: '简要', detailed: '详细（完整导出）' },
  }
  return map[key] && map[key][value] ? map[key][value] : value
}
function addField(key, schema, parent = $('tool-form')) {
  const label = document.createElement('label')
  label.dataset.field = key
  label.textContent = `${key}${schema.description ? ` · ${schema.description}` : ''}`
  let input
  if (Array.isArray(schema.enum)) {
    input = document.createElement('select')
    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = '未指定'
    input.append(blank)
    schema.enum.forEach((v) => {
      const o = document.createElement('option')
      o.value = v
      o.textContent = labelFor(key, v)
      input.append(o)
    })
  } else {
    input = document.createElement('input')
    input.type = schema.type === 'integer' ? 'number' : 'text'
    if (schema.minimum != null) {
      input.min = schema.minimum
      input.step = '1'
    }
  }
  input.dataset.key = key
  if (schema.default !== undefined) input.value = schema.default
  label.append(input)
  parent.append(label)
  return input
}
function addIdRow(parent) {
  const row = document.createElement('span')
  const input = document.createElement('input')
  input.type = 'number'
  input.min = 1
  input.step = 1
  input.dataset.id = 'true'
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'secondary'
  remove.textContent = '删除'
  remove.addEventListener('click', () => row.remove())
  const label = document.createElement('span')
  label.textContent = '任务 ID '
  row.prepend(label)
  row.append(input, remove)
  parent.append(row)
  return row
}
function renderQuestId(parent) {
  const wrap = document.createElement('div')
  wrap.dataset.field = 'id'
  const mode = document.createElement('select')
  mode.dataset.key = 'id-mode'
  ;[
    ['single', '单个 ID'],
    ['array', '多个 ID'],
  ].forEach(([v, t]) => {
    const o = document.createElement('option')
    o.value = v
    o.textContent = t
    mode.append(o)
  })
  const rows = document.createElement('div')
  rows.dataset.idRows = 'true'
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'secondary'
  add.textContent = '添加 ID'
  add.addEventListener('click', () => addIdRow(rows))
  wrap.append(mode, rows, add)
  parent.append(wrap)
  addIdRow(rows).querySelector('button').hidden = true
  mode.addEventListener('change', () => {
    rows.replaceChildren()
    const row = addIdRow(rows)
    row.querySelector('button').hidden = mode.value === 'single'
    add.hidden = mode.value === 'single'
  })
  add.hidden = true
}
async function loadCategories(select) {
  try {
    const result = await api().callTool('damecon_get_equipment', {})
    const categories =
      (result && result.equipment && result.equipment.categories) ||
      (result && result.data && result.data.categories) ||
      (result && result.categories) ||
      []
    categories.forEach((cat) => {
      const option = document.createElement('option')
      option.value = cat.id
      option.textContent = `${cat.name || `类别 ${cat.id}`}（${cat.count || 0}）`
      select.append(option)
    })
  } catch (error) {
    $('status').textContent = `类别读取失败：${error.message || error}`
  }
}
function renderForm(tool) {
  const form = $('tool-form')
  form.replaceChildren()
  const properties = (tool.inputSchema && tool.inputSchema.properties) || {}
  Object.entries(properties).forEach(([key, schema]) => {
    if (key === 'id' && schema.oneOf) return renderQuestId(form)
    const input = addField(key, schema)
    if (key === 'category') {
      const select = document.createElement('select')
      select.dataset.key = key
      const blank = document.createElement('option')
      blank.value = ''
      blank.textContent = '未指定'
      select.append(blank)
      input.replaceWith(select)
      const hand = document.createElement('input')
      hand.type = 'number'
      hand.min = 1
      hand.step = 1
      hand.placeholder = '手填类别 ID'
      hand.dataset.manualCategory = 'true'
      select.addEventListener('change', () => {
        hand.value = select.value
      })
      hand.addEventListener('input', () => {
        select.value = hand.value
      })
      select.parentElement.append(hand)
      void loadCategories(select)
    }
  })
}
function selectTool(index) {
  state.tool = state.tools[index]
  document
    .querySelectorAll('.tool-button')
    .forEach((b, i) => b.classList.toggle('selected', i === index))
  $('tool-title').textContent = state.tool.name
  $('tool-description').textContent = state.tool.description || '—'
  $('schema-json').textContent = pretty(state.tool.inputSchema || {})
  $('call-tool').disabled = state.busy
  clearNextPage()
  renderForm(state.tool)
}
function renderTools() {
  const list = $('tool-list')
  list.replaceChildren()
  state.tools.forEach((tool, index) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'tool-button'
    b.dataset.toolName = tool.name
    const title = document.createElement('span')
    title.textContent = `${{ damecon_get_snapshot: '完整快照', damecon_get_fleets: '舰队', damecon_get_land_bases: '基地航空队', damecon_get_equipment: '装备', damecon_get_improvements: '改修计划', damecon_get_quests: '任务', damecon_get_schema: 'API Schema', damecon_health: '健康状态' }[tool.name] || tool.name} · ${tool.name}`
    const small = document.createElement('small')
    small.textContent = tool.description || ''
    b.append(title, small)
    b.addEventListener('click', () => selectTool(index))
    list.append(b)
  })
  if (state.tools.length) selectTool(0)
}
function readArgs() {
  const args = {}
  $('tool-form')
    .querySelectorAll('[data-key]')
    .forEach((input) => {
      const key = input.dataset.key
      if (
        key === 'id-mode' ||
        key === 'category' ||
        input.dataset.manualCategory ||
        input.dataset.id ||
        input.value === ''
      )
        return
      if (input.type === 'number') {
        if (!input.reportValidity()) throw new Error(`${key} 必须是正整数`)
        args[key] = Number(input.value)
      } else args[key] = input.value
    })
  const idMode = $('tool-form').querySelector('[data-key="id-mode"]')
  if (idMode) {
    const inputs = [...$('tool-form').querySelectorAll('[data-id]')]
    const ids = inputs
      .map((i) => {
        if (i.value === '') return null
        if (!i.reportValidity()) throw new Error('任务 ID 必须是正整数')
        return Number(i.value)
      })
      .filter((v) => v != null)
    if (ids.length) args.id = idMode.value === 'array' ? ids : ids[0]
  }
  const manual = $('tool-form').querySelector('[data-manual-category]')
  if (manual && manual.value) {
    if (!manual.reportValidity()) throw new Error('类别 ID 必须是正整数')
    args.category = Number(manual.value)
  }
  return args
}
async function callSelected() {
  if (!state.tool || state.busy) return
  const tool = state.tool
  const requestId = ++state.requestId
  clearNextPage()
  state.busy = true
  const button = $('call-tool')
  button.disabled = true
  const started = performance.now()
  let args
  if (!$('tool-form').reportValidity()) {
    state.busy = false
    button.disabled = false
    return
  }
  try {
    args = readArgs()
  } catch (error) {
    state.lastTool = tool.name
    $('status').textContent = error.message
    state.busy = false
    button.disabled = false
    return
  }
  $('status').textContent = `调用 ${tool.name}…`
  try {
    const responseStarted = performance.now()
    const result = await withTimeout(api().callTool(tool.name, args), CALL_TIMEOUT_MS)
    const responseMs = Math.round(performance.now() - responseStarted)
    if (requestId !== state.requestId) return
    state.result = result
    state.lastTool = tool.name
    updateNextPage(state.result, tool, args)
    const renderStarted = performance.now()
    const rendered = displayResult(state.result)
    const renderMs = Math.round(performance.now() - renderStarted)
    $('copy-result').disabled = false
    $('download-result').disabled = false
    $('result-meta').textContent =
      `${tool.name} · ${state.result && state.result.source ? `source=${state.result.source.status} revision=${state.result.revision} capturedAt=${state.result.capturedAt}` : '成功'} · 调用 ${responseMs} ms · 渲染 ${renderMs} ms · 响应 ${rendered.preview ? `≥${RESULT_PREVIEW_LIMIT.toLocaleString()} 字符（完整长度未计算）` : `${rendered.length.toLocaleString()} 字符`}${rendered.preview ? '（仅预览）' : ''} · 参数 ${pretty(args)}`
    $('status').textContent = '调用完成'
  } catch (error) {
    if (requestId !== state.requestId) return
    state.lastTool = tool.name
    state.result = { error: String((error && (error.stack || error.message)) || error) }
    const rendered = displayResult(state.result)
    $('copy-result').disabled = false
    $('download-result').disabled = false
    $('result-meta').textContent =
      `${tool.name} · ${error && error.code === 'DAMECON_AGENT_TIMEOUT' ? '超时' : '失败'} · 调用 ${Math.round(performance.now() - started)} ms · 渲染 0 ms · 响应 ${rendered.length.toLocaleString()} 字符`
    $('status').textContent =
      error && error.code === 'DAMECON_AGENT_TIMEOUT'
        ? '调用超时：可重试或缩小筛选；底层读取可能仍会结束'
        : '调用失败'
  } finally {
    if (requestId === state.requestId) {
      state.busy = false
      button.disabled = false
    }
  }
}
async function refreshMcpStatus() {
  try {
    const value = await api().getMcpStatus()
    const s = (value && value.status) || value
    if (s.token && !s.token.includes('•')) mcpRawToken = s.token
    $('mcp-enabled').checked = !!s.enabled
    $('mcp-host').value = s.host || '127.0.0.1'
    $('mcp-port').value = s.port || 39273
    $('mcp-token').value = mcpRawToken
    $('mcp-status').textContent =
      `状态：${s.running ? '运行中' : s.enabled ? '已启用，未运行' : '已停用'}（${s.host || '—'}:${s.port || '—'}）${s.error ? `；错误：${s.error}` : ''}`
    const urls = Array.isArray(s.urls) ? s.urls : s.url ? [s.url] : []
    $('mcp-urls').replaceChildren()
    $('mcp-urls').hidden = !urls.length
    urls.forEach((url) => {
      const address = typeof url === 'string' ? url : url.url || ''
      const li = document.createElement('li')
      const input = document.createElement('input')
      input.value = address
      input.readOnly = true
      input.className = 'mcp-url'
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'secondary'
      copy.textContent = '复制 URL'
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(address)
          copy.textContent = '已复制'
        } catch (error) {
          $('mcp-status').textContent = `复制 URL 失败：${error.message || error}`
        }
      })
      li.append(input, copy)
      $('mcp-urls').append(li)
    })
  } catch (error) {
    $('mcp-status').textContent = `状态读取失败：${error.message || error}`
  }
}
$('tool-form').addEventListener('submit', (event) => {
  event.preventDefault()
  void callSelected()
})
$('tool-form').addEventListener('input', clearNextPage)
$('tool-form').addEventListener('change', clearNextPage)
nextPageButton = document.createElement('button')
nextPageButton.id = 'next-page'
nextPageButton.type = 'button'
nextPageButton.className = 'secondary'
nextPageButton.textContent = '下一页'
nextPageButton.disabled = true
nextPageButton.addEventListener('click', callNextPage)
$('call-tool').after(nextPageButton)
$('copy-result').disabled = true
$('download-result').disabled = true
$('copy-result').addEventListener('click', async () => {
  try {
    if (state.result == null) throw new Error('当前没有结果')
    await navigator.clipboard.writeText(pretty(state.result))
  } catch (error) {
    $('status').textContent = `复制失败：${error.message || error}`
  }
})
$('download-result').addEventListener('click', () => {
  if (state.result == null) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([pretty(state.result)], { type: 'application/json' }))
  a.download = `${state.lastTool || 'result'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
})
void api()
  .listTools()
  .then((tools) => {
    state.tools = tools
    $('status').textContent = `${tools.length} 个工具已就绪`
    renderTools()
  })
  .catch((error) => {
    $('status').textContent = `工具读取失败：${error.message || error}`
  })
const mcpEnabled = $('mcp-enabled')
$('mcp-reveal').addEventListener('click', () => {
  const visible = $('mcp-token').type === 'text'
  $('mcp-token').type = visible ? 'password' : 'text'
  $('mcp-reveal').textContent = visible ? '显示' : '隐藏'
})
$('mcp-copy').addEventListener('click', async () => {
  try {
    if (!mcpRawToken) throw new Error('当前没有可复制的 token')
    await navigator.clipboard.writeText(mcpRawToken)
  } catch (error) {
    $('mcp-status').textContent = `复制失败：${error.message || error}`
  }
})
$('mcp-rotate').addEventListener('click', async () => {
  try {
    const v = await api().rotateMcpToken()
    if (v.token) mcpRawToken = v.token
    await refreshMcpStatus()
    $('mcp-status').textContent = '状态：token 已轮换，请更新客户端'
  } catch (error) {
    $('mcp-status').textContent = `轮换失败：${error.message || error}`
  }
})
$('mcp-refresh').addEventListener('click', refreshMcpStatus)
$('mcp-save').addEventListener('click', async () => {
  try {
    const port = Number($('mcp-port').value)
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须是 1–65535')
    await api().configureMcp({ enabled: mcpEnabled.checked, host: $('mcp-host').value, port })
    await refreshMcpStatus()
  } catch (error) {
    $('mcp-status').textContent = `保存失败：${error.message || error}`
  }
})
void refreshMcpStatus()
