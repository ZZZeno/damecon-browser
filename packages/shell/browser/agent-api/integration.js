'use strict'

const { AgentApiBridge, SCHEMA_VERSION } = require('./bridge.js')
const { listTools, getTool, validateArguments } = require('./tools.js')

const schema = {
  schemaVersion: SCHEMA_VERSION,
  readonly: true,
  transport: 'browser-native',
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

function senderUrl(event) {
  try {
    if (event && event.senderFrame && typeof event.senderFrame.url === 'string')
      return event.senderFrame.url
    if (event && event.sender && typeof event.sender.getURL === 'function')
      return event.sender.getURL()
  } catch {}
  return ''
}

function allowedAgentPage(event, webuiExtensionId) {
  if (!webuiExtensionId) return false
  const expected = `chrome-extension://${webuiExtensionId}/agent.html`
  return senderUrl(event).split('?')[0].split('#')[0] === expected
}

function createAgentApiIntegration(options = {}) {
  const bridge = options.bridge || new AgentApiBridge(options)
  const ipc = options.ipcMain
  const webuiExtensionId = options.webuiExtensionId
  const channel = options.channel || 'agent-api-read'
  const handler = async (event, request = {}) => {
    if (!allowedAgentPage(event, webuiExtensionId))
      throw new Error('agent API is only available to Damecon agent.html')
    if (!request || typeof request !== 'object' || Array.isArray(request))
      throw new Error('unknown agent API operation')
    if (
      Object.prototype.hasOwnProperty.call(request, 'args') &&
      (request.args === null || typeof request.args !== 'object' || Array.isArray(request.args))
    )
      throw new Error('agent API args must be an object')
    const args = request.args || {}
    if (request.operation === 'list-tools') {
      if (Object.keys(args).length) throw new Error('list-tools does not accept arguments')
      return listTools()
    }
    const legacy = {
      snapshot: 'damecon_get_snapshot',
      fleets: 'damecon_get_fleets',
      equipment: 'damecon_get_equipment',
      landBases: 'damecon_get_land_bases',
      improvements: 'damecon_get_improvements',
      quests: 'damecon_get_quests',
      schema: 'damecon_get_schema',
      health: 'damecon_health',
    }
    const toolName = request.operation === 'call-tool' ? request.name : legacy[request.operation]
    const tool = getTool(toolName)
    if (!tool) throw new Error(`unknown agent API operation: ${request.operation}`)
    validateArguments(toolName, args)
    if (request.operation === 'call-tool' || legacy[request.operation])
      return invokeTool(tool.method, bridge, args)
  }
  function invokeTool(method, apiBridge, args) {
    switch (method) {
      case 'getSnapshot':
        return apiBridge.getSnapshot()
      case 'getFleets':
        return apiBridge.getFleets()
      case 'getEquipment':
        return apiBridge.getEquipment(args)
      case 'getLandBases':
        return apiBridge.getLandBases()
      case 'getImprovements':
        return apiBridge.getImprovements(args)
      case 'getQuests':
        return apiBridge.getQuests(args)
      case 'getSchema':
        return schema
      case 'health': {
        return apiBridge.getSnapshot().then((snapshot) => ({
          schemaVersion: SCHEMA_VERSION,
          revision: snapshot.revision,
          capturedAt: snapshot.capturedAt,
          status: snapshot.source.status === 'live' ? 'ok' : snapshot.source.status,
          source: snapshot.source,
          warnings: snapshot.warnings,
        }))
      }
      default:
        throw new Error(`unknown agent tool method: ${method}`)
    }
  }
  if (ipc && typeof ipc.handle === 'function') ipc.handle(channel, handler)
  return {
    bridge,
    schema,
    dispatch: handler,
    stop() {
      if (ipc && typeof ipc.removeHandler === 'function') ipc.removeHandler(channel)
    },
  }
}

module.exports = {
  createAgentApiIntegration,
  schema,
  listTools,
  getTool,
  validateArguments,
  allowedAgentPage,
}
