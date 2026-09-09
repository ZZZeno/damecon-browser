'use strict'

const http = require('http')
const { timingSafeEqual } = require('crypto')
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const {
  StreamableHTTPServerTransport,
} = require('@modelcontextprotocol/sdk/server/streamableHttp.js')
const {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js')

const MAX_BODY_BYTES = 1024 * 1024
const REQUEST_TIMEOUT_MS = 30_000
const MAX_CONCURRENT_REQUESTS = 8

function json(res, status, body) {
  if (res.writableEnded) return
  const text = body === undefined ? '' : JSON.stringify(body)
  res.statusCode = status
  if (text) {
    res.setHeader('content-type', 'application/json')
    res.setHeader('content-length', Buffer.byteLength(text))
  }
  res.end(text)
}

function unauthorized(res) {
  res.setHeader('www-authenticate', 'Bearer')
  json(res, 401, { error: 'unauthorized' })
}

function authMatches(req, token) {
  const value = req.headers.authorization
  if (typeof value !== 'string' || !/^Bearer [^\s]+$/.test(value)) return false
  const supplied = Buffer.from(value.slice(7))
  const expected = Buffer.from(token)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

function originAllowed(req, allowedOrigins) {
  const origin = req.headers.origin
  return origin === undefined || allowedOrigins.includes(origin)
}

function requestBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES && !settled) {
        settled = true
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }))
        req.resume()
        return
      }
      if (settled) return
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      if (size === 0) {
        settled = true
        return reject(Object.assign(new Error('request body is required'), { statusCode: 400 }))
      }
      try {
        settled = true
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (_) {
        settled = true
        reject(Object.assign(new Error('invalid JSON'), { statusCode: 400 }))
      }
    })
    req.on('error', (error) => {
      if (!settled) reject(error)
    })
  })
}

function resultText(value) {
  try {
    return JSON.stringify(value)
  } catch (_) {
    return JSON.stringify({ error: 'tool result is not JSON serializable' })
  }
}

function createMcpServer(service) {
  const server = new Server(
    { name: 'damecon-agent-api', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: service.listTools() }))
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const args = request.params.arguments === undefined ? {} : request.params.arguments
      const value = await service.callTool(request.params.name, args)
      const structuredContent =
        value && typeof value === 'object' && !Array.isArray(value) ? value : { value }
      return {
        content: [{ type: 'text', text: resultText(value) }],
        structuredContent,
        isError: false,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'tool execution failed'
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
        isError: true,
      }
    }
  })
  return server
}

async function startMcpHttpServer({
  service,
  host = '127.0.0.1',
  port,
  token,
  allowedOrigins = [],
  maxConcurrent = MAX_CONCURRENT_REQUESTS,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
} = {}) {
  if (!service || typeof service.listTools !== 'function' || typeof service.callTool !== 'function')
    throw new TypeError('service must provide listTools() and callTool()')
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('token is required')
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1)
    throw new TypeError('maxConcurrent is invalid')

  const sockets = new Set()
  let active = 0
  let closed = false
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/mcp') return json(res, 404, { error: 'not found' })
    if (req.method !== 'POST') return json(res, 405, { error: 'method not allowed' })
    if (!authMatches(req, token)) return unauthorized(res)
    if (!originAllowed(req, allowedOrigins)) return json(res, 403, { error: 'origin forbidden' })
    const contentType =
      typeof req.headers['content-type'] === 'string'
        ? req.headers['content-type'].split(';', 1)[0].trim().toLowerCase()
        : ''
    if (contentType !== 'application/json')
      return json(res, 415, { error: 'content type must be application/json' })
    if (closed) return json(res, 503, { error: 'server closed' })
    const run = () =>
      handleRequest(req, res).finally(() => {
        active -= 1
      })
    if (active >= maxConcurrent) return json(res, 429, { error: 'too many requests' })
    active += 1
    run()
  })
  const handleRequest = async (req, res) => {
    const timer = setTimeout(() => {
      if (!res.writableEnded && !res.destroyed) res.destroy(new Error('request timeout'))
    }, requestTimeoutMs)
    let transport
    let mcp
    try {
      const body = await requestBody(req)
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      })
      mcp = createMcpServer(service)
      await mcp.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (error) {
      if (!res.writableEnded && !res.destroyed)
        json(res, error.statusCode || 400, {
          error: error.statusCode === 413 ? 'request body too large' : 'bad request',
        })
    } finally {
      if (transport) await transport.close().catch(() => {})
      if (mcp) await mcp.close().catch(() => {})
      clearTimeout(timer)
    }
  }
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, host)
  })
  return {
    close: () =>
      new Promise((resolve, reject) => {
        closed = true
        sockets.forEach((socket) => socket.destroy())
        server.close((error) =>
          error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve(),
        )
      }),
    address: () => server.address(),
    server,
  }
}

module.exports = { startMcpHttpServer }
