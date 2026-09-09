'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('http')
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const {
  StreamableHTTPClientTransport,
} = require('@modelcontextprotocol/sdk/client/streamableHttp.js')
const { startMcpHttpServer } = require('./mcp-http-server')

function service() {
  return {
    listTools: () => [
      {
        name: 'echo',
        description: 'Echo',
        inputSchema: {
          type: 'object',
          properties: { delay: { type: 'integer', minimum: 0 } },
          additionalProperties: false,
        },
        annotations: { readOnlyHint: true },
      },
    ],
    callTool: async (name, args) => {
      if (name === 'fail') throw new Error('expected failure')
      if (args && args.delay) await new Promise((resolve) => setTimeout(resolve, args.delay))
      if (name !== 'echo') throw new Error('unknown tool')
      return { echoed: args }
    },
  }
}

async function raw(url, options = {}) {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      {
        method: options.method || 'POST',
        headers: {
          accept: 'application/json, text/event-stream',
          ...(options.headers || {}),
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
      },
      (res) => {
        const chunks = []
        res.on('data', (chunk) => chunks.push(chunk))
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        )
      },
    )
    req.on('error', reject)
    if (body) req.end(body)
    else req.end()
  })
}

async function running(options = {}) {
  const server = await startMcpHttpServer({ service: service(), token: 'secret', ...options })
  const address = server.address()
  return { server, url: `http://127.0.0.1:${address.port}/mcp` }
}

test('MCP client can handshake, list and call through stateless HTTP', async () => {
  const { server, url } = await running({ port: 0 })
  try {
    const client = new Client({ name: 'test-client', version: '1' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), {
        requestInit: { headers: { authorization: 'Bearer secret' } },
      }),
    )
    assert.equal((await client.listTools()).tools[0].name, 'echo')
    assert.deepEqual(
      (await client.callTool({ name: 'echo', arguments: { x: 1 } })).structuredContent,
      { echoed: { x: 1 } },
    )
    await client.close()
  } finally {
    await server.close()
  }
})

test('auth, origin, methods and malformed arguments are rejected', async () => {
  const { server, url } = await running({ port: 0, allowedOrigins: ['https://allowed.example'] })
  try {
    const unauthorizedResponse = await raw(url, { body: {} })
    assert.equal(unauthorizedResponse.status, 401)
    assert.equal(unauthorizedResponse.headers['www-authenticate'], 'Bearer')
    assert.equal(
      (await raw(url, { headers: { authorization: 'Bearer wrong' }, body: {} })).status,
      401,
    )
    assert.equal(
      (
        await raw(url, {
          headers: { authorization: 'Bearer secret', origin: 'https://evil.example' },
          body: {},
        })
      ).status,
      403,
    )
    assert.equal(
      (await raw(url, { method: 'GET', headers: { authorization: 'Bearer secret' } })).status,
      405,
    )
    const bad = await raw(url, {
      headers: { authorization: 'Bearer secret' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: 4 } },
    })
    assert.equal(bad.status, 200)
    assert.ok([-32602, -32603].includes(JSON.parse(bad.body).error.code))
  } finally {
    await server.close()
  }
})

test('delayed tool responses survive transport cleanup and the server remains reusable', async () => {
  const { server, url } = await running({ port: 0 })
  try {
    const response = await raw(url, {
      headers: { authorization: 'Bearer secret' },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: { delay: 20 } },
      },
    })
    assert.equal(response.status, 200)
    assert.deepEqual(JSON.parse(response.body).result.structuredContent, { echoed: { delay: 20 } })
    const reused = await raw(url, {
      headers: { authorization: 'Bearer secret' },
      body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    })
    assert.equal(reused.status, 200)
  } finally {
    await server.close()
  }
})

test('oversized bodies are rejected while still streaming and stalled bodies time out', async () => {
  const { server, url } = await running({ port: 0, requestTimeoutMs: 1000, maxConcurrent: 1 })
  try {
    const oversized = await new Promise((resolve, reject) => {
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            authorization: 'Bearer secret',
            accept: 'application/json',
            'content-type': 'application/json',
          },
        },
        (res) => {
          const chunks = []
          res.on('data', (chunk) => chunks.push(chunk))
          res.on('end', () =>
            resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }),
          )
        },
      )
      req.on('error', reject)
      req.end('x'.repeat(1024 * 1024 + 1))
    })
    assert.equal(oversized.status, 413)
    const stalled = await new Promise((resolve) => {
      const req = http.request(url, {
        method: 'POST',
        headers: {
          authorization: 'Bearer secret',
          accept: 'application/json',
          'content-type': 'application/json',
        },
      })
      req.on('close', resolve)
      req.on('error', resolve)
      req.write('{')
    })
    assert.ok(stalled)
    assert.equal(
      (
        await raw(url, {
          headers: { authorization: 'Bearer secret' },
          body: { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} },
        })
      ).status,
      200,
    )
  } finally {
    await server.close()
  }
})

test('port collision rejects startup without taking down the first server', async () => {
  const first = await running({ port: 0 })
  const port = first.server.address().port
  await assert.rejects(() => startMcpHttpServer({ service: service(), token: 'secret', port }))
  assert.equal(
    (
      await raw(`http://127.0.0.1:${port}/mcp`, {
        headers: { authorization: 'Bearer secret' },
        body: { jsonrpc: '2.0', id: 1, method: 'ping' },
      })
    ).status,
    200,
  )
  await first.server.close()
})
