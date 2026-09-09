'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const {
  createAgentApiIntegration,
  allowedAgentPage,
  validateArguments,
} = require('./integration.js')

test('accepts only the built-in agent page sender', () => {
  const event = { senderFrame: { url: 'chrome-extension://ui/agent.html' } }
  assert.equal(allowedAgentPage(event, 'ui'), true)
  assert.equal(
    allowedAgentPage({ senderFrame: { url: 'https://example.test/agent.html' } }, 'ui'),
    false,
  )
  assert.equal(
    allowedAgentPage({ senderFrame: { url: 'chrome-extension://ui/settings.html' } }, 'ui'),
    false,
  )
})

test('validates filters before dispatch', () => {
  assert.doesNotThrow(() =>
    validateArguments('damecon_get_improvements', { day: 'today', equipmentId: 10 }),
  )
  assert.throws(
    () => validateArguments('damecon_get_improvements', { day: 'noday' }),
    /day is invalid/,
  )
  assert.throws(
    () => validateArguments('damecon_get_equipment', { masterId: -1 }),
    /positive integer/,
  )
  assert.throws(
    () => validateArguments('damecon_get_quests', { id: [1, 'bad'] }),
    /positive integer/,
  )
  assert.throws(
    () => validateArguments('damecon_get_equipment', { category: null }),
    /positive integer/,
  )
  assert.throws(() => validateArguments('damecon_get_quests', { mode: null }), /mode is invalid/)
  assert.throws(() => validateArguments('damecon_get_fleets', { extra: true }), /unknown argument/)
})

test('dispatches a whitelisted operation through guarded IPC', async () => {
  const calls = []
  const ipc = {
    handle(channel, handler) {
      calls.push({ channel, handler })
    },
    removeHandler() {},
  }
  const bridge = {}
  for (const method of [
    'getSnapshot',
    'getFleets',
    'getEquipment',
    'getLandBases',
    'getImprovements',
    'getQuests',
  ])
    bridge[method] = async () => ({ data: method })
  bridge.getFleets = async (args) => {
    calls.push(['getFleets'])
    return { data: { fleets: [{ deckParams: { raw: true }, ships: [] }] } }
  }
  bridge.getSnapshot = async () => ({
    source: { status: 'live' },
    revision: 1,
    capturedAt: 'now',
    warnings: [],
  })
  const integration = createAgentApiIntegration({ ipcMain: ipc, webuiExtensionId: 'ui', bridge })
  assert.equal(calls[0].channel, 'agent-api-read')
  await assert.rejects(
    () =>
      calls[0].handler(
        { senderFrame: { url: 'https://evil.test/' } },
        { operation: 'call-tool', name: 'damecon_get_fleets' },
      ),
    /only available/,
  )
  const listed = await calls[0].handler(
    { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
    { operation: 'list-tools' },
  )
  assert.equal(listed.length, 8)
  assert.deepEqual(
    listed.map((tool) => tool.name),
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
  await assert.rejects(
    () =>
      calls[0].handler(
        { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
        { operation: 'list-tools', args: { extra: true } },
      ),
    /does not accept/,
  )
  for (const tool of listed.filter(
    (entry) => entry.name !== 'damecon_get_schema' && entry.name !== 'damecon_health',
  )) {
    const result = await calls[0].handler(
      { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
      {
        operation: 'call-tool',
        name: tool.name,
        args: tool.name === 'damecon_get_quests' ? { mode: 'current' } : {},
      },
    )
    assert.ok(result)
  }
  await assert.rejects(
    () =>
      calls[0].handler(
        { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
        { operation: 'call-tool', name: 'nope' },
      ),
    /unknown agent API operation/,
  )
  await assert.rejects(
    () =>
      calls[0].handler(
        { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
        { operation: 'call-tool', name: 'damecon_get_fleets', args: { extra: true } },
      ),
    /unknown argument/,
  )
  assert.deepEqual(
    await calls[0].handler(
      { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
      { operation: 'fleets' },
    ),
    {
      data: { fleets: [{ deckParams: { raw: true }, ships: [] }] },
      responseFormat: 'detailed',
    },
  )
  const concise = await calls[0].handler(
    { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
    { operation: 'fleets', args: { responseFormat: 'concise' } },
  )
  assert.equal(concise.responseFormat, 'concise')
  assert.equal(concise.data.fleets[0].deckParams, undefined)
  assert.deepEqual(
    await calls[0].handler(
      { senderFrame: { url: 'chrome-extension://ui/agent.html' } },
      { operation: 'health' },
    ),
    {
      schemaVersion: '1.1',
      revision: 1,
      capturedAt: 'now',
      status: 'ok',
      source: { status: 'live' },
      warnings: [],
    },
  )
  integration.stop()
})
