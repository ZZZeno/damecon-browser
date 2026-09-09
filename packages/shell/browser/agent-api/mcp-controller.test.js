'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { McpController, registerMcpControl } = require('./mcp-controller.js')

async function tempFile() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'damecon-mcp-controller-'))
  return { root, file: path.join(root, 'agent-mcp.json') }
}

test('persists disabled defaults and starts configured server on demand', async () => {
  const paths = await tempFile()
  const starts = []
  const closed = []
  const controller = new McpController({
    filePath: paths.file,
    startServer: async (config) => {
      starts.push(config)
      return { address: () => ({ port: config.port }), close: async () => closed.push(config.port) }
    },
  })
  const initial = await controller.startSaved()
  assert.equal(initial.enabled, false)
  assert.equal(initial.running, false)
  assert.equal(initial.error, null)
  const configured = await controller.configure({ enabled: true, host: '127.0.0.1', port: 39274 })
  assert.equal(controller.status().running, true)
  assert.deepEqual(configured.urls, ['http://127.0.0.1:39274/mcp'])
  assert.equal(starts[0].token.length >= 40, true)
  const stat = await fs.stat(paths.file)
  assert.equal(stat.mode & 0o077, 0)
  const persisted = JSON.parse(await fs.readFile(paths.file, 'utf8'))
  assert.equal(persisted.host, '127.0.0.1')
  assert.equal(persisted.enabled, true)
  const reloaded = new McpController({
    filePath: paths.file,
    startServer: async () => ({ close: async () => {} }),
  })
  const reloadedStatus = await reloaded.startSaved()
  assert.equal(reloadedStatus.host, '127.0.0.1')
  assert.equal(reloadedStatus.enabled, true)
  assert.equal(reloadedStatus.token, persisted.token)
  await reloaded.stop()
  await controller.stop()
  assert.deepEqual(closed, [39274])
  await fs.rm(paths.root, { recursive: true, force: true })
})

test('restores the old listener and settings after a failed reconfigure', async () => {
  const paths = await tempFile()
  let starts = 0
  const controller = new McpController({
    filePath: paths.file,
    startServer: async (config) => {
      starts += 1
      if (config.port === 39276) throw new Error('bind failed')
      return { close: async () => {}, address: () => ({ port: config.port }) }
    },
  })
  await controller.startSaved()
  await controller.configure({ enabled: true, port: 39275 })
  await assert.rejects(() => controller.configure({ port: 39276 }), /bind failed/)
  assert.equal(controller.config.port, 39275)
  assert.equal(controller.status().running, true)
  assert.equal(starts, 3)
  await fs.rm(paths.root, { recursive: true, force: true })
})

test('guards admin IPC and does not expose controls to other pages', async () => {
  const paths = await tempFile()
  const controller = new McpController({
    filePath: paths.file,
    startServer: async () => ({ close: async () => {} }),
  })
  await controller.startSaved()
  let registered
  const ipc = {
    handle: (_channel, handler) => {
      registered = handler
    },
    removeHandler: () => {},
  }
  registerMcpControl({ ipcMain: ipc, webuiExtensionId: 'ui', controller })
  await assert.rejects(
    () =>
      registered({ senderFrame: { url: 'https://example.test/' } }, { operation: 'get-status' }),
    /only available/,
  )
  const status = await registered(
    { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
    { operation: 'get-status' },
  )
  assert.equal(typeof status.token, 'string')
  await fs.rm(paths.root, { recursive: true, force: true })
})

test('keeps malformed persisted settings intact and disables safely', async () => {
  const paths = await tempFile()
  const original = '{ malformed settings }\n'
  await fs.writeFile(paths.file, original, { mode: 0o600 })
  const controller = new McpController({
    filePath: paths.file,
    startServer: async () => {
      throw new Error('must not start')
    },
  })
  const status = await controller.startSaved()
  assert.equal(status.enabled, false)
  assert.equal(status.running, false)
  assert.match(status.error, /invalid MCP settings/)
  assert.equal(await fs.readFile(paths.file, 'utf8'), original)
  await fs.rm(paths.root, { recursive: true, force: true })
})

test('serializes shutdown behind an in-flight configuration', async () => {
  const paths = await tempFile()
  let starts = 0
  let resolveStart
  const controller = new McpController({
    filePath: paths.file,
    startServer: async () => {
      starts += 1
      await new Promise((resolve) => {
        resolveStart = resolve
      })
      return { close: async () => {} }
    },
  })
  await controller.startSaved()
  const configuring = controller.configure({ enabled: true, port: 39277 })
  while (!resolveStart) await new Promise((resolve) => setImmediate(resolve))
  const stopping = controller.stop()
  resolveStart()
  await configuring
  await stopping
  assert.equal(starts, 1)
  assert.equal(controller.status().running, false)
  await fs.rm(paths.root, { recursive: true, force: true })
})
