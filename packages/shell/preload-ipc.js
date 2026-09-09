import { ipcRenderer, contextBridge, webFrame } from 'electron'

export const injectIpc = () => {
  const ipc = {
    send: async function (channel, message, data) {
      const result = await ipcRenderer.invoke(channel, message, data)
      return result
    },
    on: function (channel, callback) {
      ipcRenderer.on(channel, (ev, data) => callback(ev, data))
    },
    platform: process.platform,
  }

  //function mainWorldScript() {
  // Perform any component edits here
  //}

  try {
    contextBridge.exposeInMainWorld('ipc', ipc)

    // Must execute script in main world to modify custom component registry.
    //webFrame.executeJavaScript(`(${mainWorldScript}());`)
  } catch (error) {
    // When contextIsolation is disabled, contextBridge will throw an error.
    // If that's the case, we're in the main world so we can just execute our
    // function.
    //mainWorldScript()
    console.warn(
      'preload-ipc',
      'Error injecting ipc via contextBridge; probably running in main world. applying window.ipc instead.',
      error,
    )
    window.ipc = ipc
  }
}

// The agent API is deliberately exposed only on the built-in agent page.  It
// has no route to arbitrary webpages and all reads are checked again in main.
export const injectAgentApi = () => {
  const request = (operation, args = {}) =>
    ipcRenderer.invoke('agent-api-read', { operation, args })
  const callTool = (name, args = {}) =>
    ipcRenderer.invoke('agent-api-read', { operation: 'call-tool', name, args })
  const legacyArgs = (args) =>
    args === undefined
      ? { responseFormat: 'detailed' }
      : Object.assign({ responseFormat: 'detailed' }, args)
  const api = {
    listTools: () => request('list-tools'),
    callTool: (name, args) => callTool(name, args),
    getSnapshot: (args) => callTool('damecon_get_snapshot', legacyArgs(args)),
    getFleets: (args) => callTool('damecon_get_fleets', legacyArgs(args)),
    getEquipment: (filters) => callTool('damecon_get_equipment', legacyArgs(filters)),
    getLandBases: (args) => callTool('damecon_get_land_bases', legacyArgs(args)),
    getImprovements: (filters) => callTool('damecon_get_improvements', legacyArgs(filters)),
    getQuests: (filters) => callTool('damecon_get_quests', legacyArgs(filters)),
    getSchema: () => callTool('damecon_get_schema'),
    health: () => callTool('damecon_health'),
    getMcpStatus: () => ipcRenderer.invoke('agent-mcp-control', { operation: 'get-status' }),
    configureMcp: (config) =>
      ipcRenderer.invoke('agent-mcp-control', { operation: 'configure', config }),
    rotateMcpToken: () => ipcRenderer.invoke('agent-mcp-control', { operation: 'rotate-token' }),
  }
  try {
    contextBridge.exposeInMainWorld('dameconAgent', api)
  } catch (error) {
    console.warn('preload-ipc', 'Unable to expose dameconAgent.', error)
    window.dameconAgent = api
  }
}
