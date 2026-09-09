'use strict'

const { SCHEMA_VERSION } = require('./bridge.js')
const { listTools, getTool, validateArguments } = require('./tools.js')

const schema = {
  schemaVersion: SCHEMA_VERSION,
  readonly: true,
  transport: 'browser-native-and-mcp',
  tools: listTools(),
  envelope: {
    schemaVersion: SCHEMA_VERSION,
    revision: 'read generation',
    capturedAt: 'ISO-8601',
    source: 'status and frame identity',
    data: 'resource payload',
    warnings: 'array',
  },
  sourceStatuses: ['live', 'unavailable', 'ambiguous'],
}

function createAgentToolService(options = {}) {
  const bridge = options.bridge
  if (!bridge) throw new Error('createAgentToolService requires bridge')
  async function callTool(name, args = {}) {
    const tool = getTool(name)
    if (!tool) throw new Error(`unknown agent tool: ${name}`)
    validateArguments(name, args)
    switch (tool.method) {
      case 'getSnapshot':
        return bridge.getSnapshot()
      case 'getFleets':
        return bridge.getFleets()
      case 'getEquipment':
        return bridge.getEquipment(args)
      case 'getLandBases':
        return bridge.getLandBases()
      case 'getImprovements':
        return bridge.getImprovements(args)
      case 'getQuests':
        return bridge.getQuests(args)
      case 'getSchema':
        return schema
      case 'health': {
        const snapshot = await bridge.getSnapshot()
        return {
          schemaVersion: SCHEMA_VERSION,
          revision: snapshot.revision,
          capturedAt: snapshot.capturedAt,
          status: snapshot.source.status === 'live' ? 'ok' : snapshot.source.status,
          source: snapshot.source,
          warnings: snapshot.warnings,
        }
      }
      default:
        throw new Error(`unknown agent tool method: ${tool.method}`)
    }
  }
  return { bridge, listTools, callTool, schema }
}

module.exports = { createAgentToolService, schema }
