'use strict'
const $ = (id) => document.getElementById(id)
const state = { tools: [], tool: null, busy: false, result: null, lastTool: null }
let mcpRawToken = ''
function api() {
  if (!window.dameconAgent) throw new Error('window.dameconAgent is unavailable')
  return window.dameconAgent
}
function pretty(value) {
  return JSON.stringify(value, null, 2)
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
    state.result = await api().callTool(tool.name, args)
    state.lastTool = tool.name
    $('result-json').textContent = pretty(state.result)
    $('copy-result').disabled = false
    $('download-result').disabled = false
    $('result-meta').textContent =
      `${tool.name} · ${state.result && state.result.source ? `source=${state.result.source.status} revision=${state.result.revision} capturedAt=${state.result.capturedAt}` : '成功'} · ${Math.round(performance.now() - started)} ms · 参数 ${pretty(args)}`
    $('status').textContent = '调用完成'
  } catch (error) {
    state.result = { error: String((error && (error.stack || error.message)) || error) }
    $('result-json').textContent = pretty(state.result)
    $('copy-result').disabled = false
    $('download-result').disabled = false
    $('result-meta').textContent =
      `${tool.name} · 失败 · ${Math.round(performance.now() - started)} ms`
    $('status').textContent = '调用失败'
  } finally {
    state.busy = false
    button.disabled = false
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
$('copy-result').disabled = true
$('download-result').disabled = true
$('copy-result').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('result-json').textContent)
  } catch (error) {
    $('status').textContent = `复制失败：${error.message || error}`
  }
})
$('download-result').addEventListener('click', () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(
    new Blob([$('result-json').textContent], { type: 'application/json' }),
  )
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
