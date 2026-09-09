'use strict'

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const DEFAULTS = { enabled: false, host: '0.0.0.0', port: 39273 }

function newToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function validateConfig(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('MCP config must be an object')
  const config = {}
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new Error('MCP enabled must be boolean')
    config.enabled = input.enabled
  }
  if (input.host !== undefined) {
    if (
      typeof input.host !== 'string' ||
      !input.host ||
      input.host.includes('/') ||
      (input.host.includes(':') && input.host !== '::1')
    )
      throw new Error('MCP host must be a hostname or IPv4 address')
    const ipv4 = /^(\d{1,3})(\.\d{1,3}){3}$/.exec(input.host)
    if (
      input.host !== 'localhost' &&
      input.host !== '::1' &&
      (!ipv4 || input.host.split('.').some((part) => Number(part) > 255))
    )
      throw new Error('MCP host must be localhost, ::1, or an IPv4 address')
    config.host = input.host
  }
  if (input.port !== undefined) {
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
      throw new Error('MCP port must be an integer from 1 to 65535')
    config.port = input.port
  }
  for (const key of Object.keys(input))
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key))
      throw new Error(`unknown MCP config key: ${key}`)
  return config
}

async function atomicWrite(filePath, value) {
  const directory = path.dirname(filePath)
  await fs.mkdir(directory, { recursive: true, mode: 0o700 })
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`,
  )
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, filePath)
    await fs.chmod(filePath, 0o600)
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

async function readConfig(filePath) {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8'))
    const { token, ...settings } = value
    const config = Object.assign({}, DEFAULTS, validateConfig(settings))
    if (typeof token !== 'string' || token.length < 40) throw new Error('invalid MCP token')
    config.token = token
    return config
  } catch (error) {
    throw error
  }
}

function addressUrls(host, port) {
  const localhost = `http://127.0.0.1:${port}/mcp`
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
  const format = (address) =>
    address === '::1' ? `http://[::1]:${port}/mcp` : `http://${address}:${port}/mcp`
  const urls =
    host === '0.0.0.0'
      ? [localhost, ...addresses.map(format)]
      : [format(host === 'localhost' ? '127.0.0.1' : host)]
  const lanIPv4 = host === '0.0.0.0' && addresses.length ? format(addresses[0]) : null
  return {
    localhost,
    lanIPv4,
    urls: [...new Set(urls)],
  }
}

class McpController {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(options.userDataPath || '.', 'agent-mcp.json')
    this.startServer =
      options.startServer || ((args) => require('./mcp-http-server.js').startMcpHttpServer(args))
    this.service = options.service
    this.logger = options.logger || (() => {})
    this.config = null
    this.server = null
    this.error = null
    this.queue = Promise.resolve()
  }

  async startSaved() {
    if (!this.config) {
      let exists = true
      try {
        await fs.stat(this.filePath)
      } catch (error) {
        if (error.code === 'ENOENT') exists = false
        else throw error
      }
      try {
        this.config = await readConfig(this.filePath)
      } catch (error) {
        this.config = Object.assign({}, DEFAULTS, { token: newToken() })
        if (exists)
          this.error = `invalid MCP settings: ${String((error && error.message) || error)}`
      }
      if (!exists) await atomicWrite(this.filePath, this.config)
    }
    if (this.config.enabled) await this.startCurrent()
    return this.status(true)
  }

  async startCurrent() {
    if (!this.config.enabled) return
    try {
      this.server = await this.startServer({
        service: this.service,
        host: this.config.host,
        port: this.config.port,
        token: this.config.token,
        allowedOrigins: [],
      })
      this.error = null
    } catch (error) {
      this.server = null
      this.error = String((error && error.message) || error)
      this.logger('MCP server failed to start:', this.error)
      throw error
    }
  }

  async closeServer() {
    const server = this.server
    this.server = null
    if (server && typeof server.close === 'function') await server.close()
  }

  stop() {
    return this.enqueue(() => this.closeServer())
  }

  status(includeToken = false) {
    const config = this.config || Object.assign({}, DEFAULTS, { token: null })
    const port =
      (this.server && typeof this.server.address === 'function' && this.server.address()?.port) ||
      config.port
    const addresses = addressUrls(config.host, port)
    const result = {
      enabled: config.enabled,
      host: config.host,
      port,
      running: !!this.server,
      error: this.error,
      urls: addresses.urls,
      localhost: addresses.localhost,
      lanIPv4: addresses.lanIPv4,
    }
    if (includeToken) result.token = config.token
    return result
  }

  configure(input) {
    return this.enqueue(() => this._configure(input))
  }

  async _configure(input) {
    const patch = validateConfig(input)
    if (!this.config) await this.startSaved()
    const previous = Object.assign({}, this.config)
    const next = Object.assign({}, previous, patch)
    if (next.enabled && !next.token) next.token = newToken()
    try {
      await this.closeServer()
      this.config = next
      if (next.enabled) await this.startCurrent()
      await atomicWrite(this.filePath, this.config)
      return this.status(true)
    } catch (error) {
      await this.closeServer()
      this.config = previous
      try {
        if (previous.enabled) await this.startCurrent()
      } catch (restoreError) {
        this.error = String((restoreError && restoreError.message) || restoreError)
      }
      throw error
    }
  }

  rotateToken() {
    return this.enqueue(() => this._rotateToken())
  }

  async _rotateToken() {
    if (!this.config) await this.startSaved()
    const previous = Object.assign({}, this.config)
    const next = Object.assign({}, previous, { token: newToken() })
    try {
      await this.closeServer()
      this.config = next
      if (next.enabled) await this.startCurrent()
      await atomicWrite(this.filePath, this.config)
      return this.status(true)
    } catch (error) {
      await this.closeServer()
      this.config = previous
      try {
        if (previous.enabled) await this.startCurrent()
      } catch (restoreError) {
        this.error = String((restoreError && restoreError.message) || restoreError)
      }
      throw error
    }
  }

  enqueue(operation) {
    const result = this.queue.then(operation, operation)
    this.queue = result.catch(() => {})
    return result
  }
}

function senderIsAgent(event, webuiExtensionId) {
  let url = ''
  try {
    url = (event && event.senderFrame?.url) || (event && event.sender?.getURL?.()) || ''
  } catch {}
  const expected = `chrome-extension://${webuiExtensionId}/agent.html`
  return url.split('?')[0].split('#')[0] === expected
}

function registerMcpControl({
  ipcMain,
  webuiExtensionId,
  controller,
  channel = 'agent-mcp-control',
}) {
  const handler = async (event, request = {}) => {
    if (!senderIsAgent(event, webuiExtensionId))
      throw new Error('MCP control is only available to Damecon agent.html')
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw new Error('invalid MCP control request')
    switch (request.operation) {
      case 'get-status':
        return controller.status(true)
      case 'configure':
        return controller.configure(request.config)
      case 'rotate-token':
        return controller.rotateToken()
      default:
        throw new Error('unknown MCP control operation')
    }
  }
  ipcMain.handle(channel, handler)
  return { handler, stop: () => ipcMain.removeHandler?.(channel) }
}

module.exports = {
  McpController,
  registerMcpControl,
  validateConfig,
  atomicWrite,
  readConfig,
  DEFAULTS,
  newToken,
  addressUrls,
}
