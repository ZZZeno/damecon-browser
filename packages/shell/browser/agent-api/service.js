'use strict'

const { SCHEMA_VERSION } = require('./bridge.js')
const { listTools, getTool, validateArguments } = require('./tools.js')
const {
  presentSnapshot,
  presentFleets,
  presentLandBases,
  presentEquipment,
  presentImprovements,
  presentQuests,
} = require('./presentation.js')

const schema = {
  schemaVersion: SCHEMA_VERSION,
  readonly: true,
  transport: 'browser-native-and-mcp',
  responseFormats: {
    default: 'concise',
    detailed: 'complete backward-compatible payload',
  },
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
    const detailed = args.responseFormat === 'detailed'
    const filters = Object.assign({}, args)
    delete filters.responseFormat
    switch (tool.method) {
      case 'getSnapshot':
        return presentSnapshot(await bridge.getSnapshot(), detailed)
      case 'getFleets':
        return presentFleets(await bridge.getFleets(), detailed)
      case 'getEquipment':
        return presentEquipment(await bridge.getEquipment(filters), filters, detailed)
      case 'getLandBases':
        return presentLandBases(await bridge.getLandBases(), detailed)
      case 'getImprovements':
        return presentImprovements(await bridge.getImprovements(filters), filters, detailed)
      case 'getQuests':
        return presentQuests(await bridge.getQuests(filters), filters, detailed)
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
