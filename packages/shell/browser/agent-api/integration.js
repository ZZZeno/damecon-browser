'use strict'

const { AgentApiBridge } = require('./bridge.js')
const { createAgentToolService, schema } = require('./service.js')
const { listTools, getTool, validateArguments } = require('./tools.js')

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
  const service = options.service || createAgentToolService({ bridge })
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
      return service.listTools()
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
      return service.callTool(tool.name, args)
  }
  if (ipc && typeof ipc.handle === 'function') ipc.handle(channel, handler)
  return {
    bridge,
    service,
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
