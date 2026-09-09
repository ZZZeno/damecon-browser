'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { createAgentToolService } = require('./service.js')

test('service discovers and calls every registered read-only tool', async () => {
  const calls = []
  const bridge = {}
  for (const method of [
    'getSnapshot',
    'getFleets',
    'getEquipment',
    'getLandBases',
    'getImprovements',
    'getQuests',
  ]) {
    bridge[method] = async (args) => {
      calls.push([method, args])
      return { data: method }
    }
  }
  bridge.getSnapshot = async () => {
    calls.push(['getSnapshot'])
    return { revision: 1, capturedAt: 'now', source: { status: 'live' }, warnings: [] }
  }
  const service = createAgentToolService({ bridge })
  const tools = service.listTools()
  assert.equal(tools.length, 8)
  assert.ok(
    tools.every(
      (tool) => tool.annotations.readOnlyHint && tool.annotations.destructiveHint === false,
    ),
  )
  for (const tool of tools) {
    const args = tool.name === 'damecon_get_quests' ? { mode: 'current' } : {}
    await service.callTool(tool.name, args)
  }
  assert.deepEqual(
    calls.map(([method]) => method),
    [
      'getSnapshot',
      'getFleets',
      'getLandBases',
      'getEquipment',
      'getImprovements',
      'getQuests',
      'getSnapshot',
    ],
  )
})

test('service rejects unknown tools and arguments', async () => {
  const service = createAgentToolService({ bridge: { getSnapshot: async () => ({}) } })
  await assert.rejects(() => service.callTool('unknown_tool'), /unknown agent tool/)
  await assert.rejects(
    () => service.callTool('damecon_get_fleets', { action: 'launch' }),
    /unknown argument/,
  )
  await assert.rejects(
    () => service.callTool('damecon_get_equipment', { category: null }),
    /positive integer/,
  )
})
