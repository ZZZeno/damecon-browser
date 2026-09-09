'use strict'

const output = document.getElementById('output')
const status = document.getElementById('status')
const mcpEnabled = document.getElementById('mcp-enabled')
const mcpHost = document.getElementById('mcp-host')
const mcpPort = document.getElementById('mcp-port')
const mcpToken = document.getElementById('mcp-token')
const mcpStatus = document.getElementById('mcp-status')
const mcpUrls = document.getElementById('mcp-urls')
let mcpRawToken = ''

function getAgentApi() {
  const api = window.dameconAgent
  if (!api) throw new Error('window.dameconAgent is unavailable on this page')
  return api
}

function applyMcpState(value) {
  const state = value && value.status && typeof value.status === 'object' ? value.status : value
  if (!state || typeof state !== 'object') return
  if (typeof state.token === 'string' && state.token && !state.token.includes('•'))
    mcpRawToken = state.token
  if (typeof state.enabled === 'boolean') mcpEnabled.checked = state.enabled
  if (state.host === '127.0.0.1' || state.host === '0.0.0.0') mcpHost.value = state.host
  if (Number.isInteger(state.port) && state.port > 0) mcpPort.value = String(state.port)
  mcpToken.value = mcpRawToken
  mcpToken.title = mcpRawToken ? 'Bearer token（仅本页显示）' : 'Token unavailable'

  const mode = state.running ? '运行中' : state.enabled ? '已启用，未运行' : '已停用'
  const error = state.error ? `；错误：${state.error}` : ''
  mcpStatus.textContent = `状态：${mode}（${state.host || '—'}:${state.port || '—'}）${error}`
  const urls = Array.isArray(state.urls)
    ? state.urls
    : state.urls && typeof state.urls === 'object'
      ? Object.values(state.urls)
      : state.url
        ? [state.url]
        : []
  mcpUrls.replaceChildren()
  mcpUrls.hidden = urls.length === 0
  for (const url of urls) {
    const item = document.createElement('li')
    const address = typeof url === 'string' ? url : url.url || ''
    const addressText = document.createElement('input')
    addressText.type = 'text'
    addressText.className = 'mcp-url'
    addressText.readOnly = true
    addressText.value = address
    addressText.setAttribute('aria-label', 'MCP URL')
    const copyUrl = document.createElement('button')
    copyUrl.type = 'button'
    copyUrl.textContent = '复制 URL'
    copyUrl.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(address)
        copyUrl.textContent = '已复制'
      } catch (error) {
        mcpStatus.textContent = `复制 URL 失败：${String((error && error.message) || error)}`
      }
    })
    item.append(addressText, copyUrl)
    mcpUrls.append(item)
  }
}

async function refreshMcpStatus() {
  try {
    const state = await getAgentApi().getMcpStatus()
    applyMcpState(state)
  } catch (error) {
    mcpStatus.textContent = `状态读取失败：${String((error && error.message) || error)}`
  }
}

function configuredMcpValues() {
  const port = Number(mcpPort.value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be 1–65535')
  return { enabled: mcpEnabled.checked, host: mcpHost.value, port }
}

for (const button of document.querySelectorAll('[data-operation]')) {
  button.addEventListener('click', async () => {
    const operation = button.dataset.operation
    status.textContent = `Reading ${operation}…`
    try {
      const api = getAgentApi()
      const result =
        operation === 'tools'
          ? await api.listTools()
          : await (
              operation === 'health'
                ? api.health
                : api[`get${operation[0].toUpperCase()}${operation.slice(1)}`]
            )()
      status.textContent =
        result && result.source
          ? `source: ${result.source.status}, revision: ${result.revision}`
          : 'OK'
      output.textContent = JSON.stringify(result, null, 2)
    } catch (error) {
      status.textContent = 'Read failed'
      output.textContent = String((error && error.stack) || error)
    }
  })
}

document.getElementById('mcp-reveal').addEventListener('click', () => {
  const visible = mcpToken.type === 'text'
  mcpToken.type = visible ? 'password' : 'text'
  document.getElementById('mcp-reveal').textContent = visible ? '显示' : '隐藏'
})

document.getElementById('mcp-copy').addEventListener('click', async () => {
  try {
    if (!mcpRawToken) throw new Error('当前没有可复制的 token，请先刷新状态')
    await navigator.clipboard.writeText(mcpRawToken)
    mcpStatus.textContent = '状态：token 已复制（仅可信页面可见）'
  } catch (error) {
    mcpStatus.textContent = `复制失败：${String((error && error.message) || error)}`
  }
})

document.getElementById('mcp-rotate').addEventListener('click', async () => {
  try {
    const result = await getAgentApi().rotateMcpToken()
    applyMcpState(result)
    mcpStatus.textContent = '状态：token 已轮换，请更新 MCP 客户端配置'
  } catch (error) {
    mcpStatus.textContent = `轮换失败：${String((error && error.message) || error)}`
  }
})

document.getElementById('mcp-save').addEventListener('click', async () => {
  try {
    const result = await getAgentApi().configureMcp(configuredMcpValues())
    applyMcpState(result)
    mcpStatus.textContent = '状态：配置已保存'
  } catch (error) {
    mcpStatus.textContent = `保存失败：${String((error && error.message) || error)}`
  }
})

document.getElementById('mcp-refresh').addEventListener('click', refreshMcpStatus)
void refreshMcpStatus()
