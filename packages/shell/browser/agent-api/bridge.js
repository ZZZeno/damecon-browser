'use strict'

const { collectKc3Snapshot } = require('./kc3-projection.js')
const { loadKnowledge } = require('./knowledge.js')

const SCHEMA_VERSION = '1.1'
const DEFAULT_TIMEOUT_MS = 3000
const EMPTY_DATA = {
  player: null,
  fleets: {
    combinedFleet: { code: 0, type: 'none', mainFleetId: null, escortFleetId: null },
    fleets: [],
  },
  landBases: [],
  equipment: { total: 0, categories: [], instances: [] },
  quests: null,
}

function clone(value) {
  if (value === undefined) return undefined
  return JSON.parse(JSON.stringify(value))
}

function emptySource(status = 'unavailable') {
  return {
    status,
    id: null,
    url: null,
    webContentsId: null,
    frameRoutingId: null,
    lastEvent: null,
    lastEventAt: null,
    observedAt: null,
    sessionObservedAt: null,
    domains: {},
  }
}

function frameList(webContents) {
  try {
    if (!webContents) return []
    const root = webContents.mainFrame
    if (!root) return []
    const descendants = root.framesInSubtree
    return Array.isArray(descendants) && descendants.length ? descendants : [root]
  } catch {
    return []
  }
}

function sourceFor(frame, webContents, projectionSource) {
  let frameRoutingId = null
  let url = null
  try {
    frameRoutingId = frame.routingId ?? frame.id ?? null
    url = frame.url || null
  } catch {}
  let webContentsId = null
  try {
    webContentsId = webContents && webContents.id != null ? webContents.id : null
  } catch {}
  return Object.assign({}, projectionSource || {}, {
    status: 'live',
    id: `${webContentsId == null ? 'wc' : webContentsId}:${frameRoutingId == null ? 'main' : frameRoutingId}`,
    url,
    webContentsId,
    frameRoutingId,
  })
}

function warning(code, error) {
  return { code, message: String((error && error.message) || error) }
}

class AgentApiBridge {
  constructor(options = {}) {
    this.getWebContents = options.getWebContents || (() => [])
    this.getKc3ExtensionId = options.getKc3ExtensionId || (() => null)
    this.getExtensionPath = options.getExtensionPath || (() => null)
    this.getExtensionVersion = options.getExtensionVersion || (() => null)
    this.collectSource = options.collectSource || collectKc3Snapshot.toString()
    this.loadKnowledge = options.loadKnowledge || loadKnowledge
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
    this.now = options.now || (() => Date.now())
    this.revision = 0
    this.inflight = null
    this.knowledge = null
    this.knowledgeKey = null
  }

  async readSnapshot() {
    if (this.inflight) return this.inflight
    this.inflight = this.collectSnapshot().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  async collectSnapshot() {
    const requestedAt = this.now()
    const extensionId = this.getKc3ExtensionId()
    const prefix = extensionId ? `chrome-extension://${extensionId}/pages/devtools/themes/` : null
    const candidates = []
    const errors = []
    for (const webContents of this.getWebContents() || []) {
      for (const frame of frameList(webContents)) {
        try {
          if (!prefix || typeof frame.url !== 'string' || !frame.url.startsWith(prefix)) continue
          candidates.push({ frame, webContents })
        } catch (error) {
          errors.push(warning('frame_unavailable', error))
        }
      }
    }
    const observations = await Promise.all(
      candidates.map(async ({ frame, webContents }) => {
        try {
          const result = await this.withTimeout(
            frame.executeJavaScript(`(${this.collectSource})()`, false),
            this.timeoutMs,
          )
          return { frame, webContents, result }
        } catch (error) {
          errors.push(warning('projection_failed', error))
          return null
        }
      }),
    )
    const ready = observations.filter(
      (observation) => observation && observation.result && observation.result.ready,
    )
    const capturedAt = this.now()
    this.revision += 1
    if (ready.length > 1) {
      return this.envelope({
        requestedAt,
        capturedAt,
        source: {
          status: 'ambiguous',
          candidates: ready.map(({ frame, webContents }) => sourceFor(frame, webContents, null)),
        },
        data: clone(EMPTY_DATA),
        warnings: [
          {
            code: 'AMBIGUOUS_SOURCE',
            message:
              'More than one ready KC3 game panel is available; source selection is ambiguous',
          },
          ...errors,
        ],
      })
    }
    if (ready.length === 1) {
      const { frame, webContents, result } = ready[0]
      return this.envelope({
        requestedAt,
        capturedAt,
        source: sourceFor(frame, webContents, result.source),
        data: result.data || clone(EMPTY_DATA),
        warnings: [...(result.warnings || []), ...errors],
      })
    }
    return this.envelope({
      requestedAt,
      capturedAt,
      source: Object.assign(emptySource('unavailable'), { candidateCount: candidates.length }),
      data: clone(EMPTY_DATA),
      warnings: errors.length
        ? errors
        : [{ code: 'kc3_unavailable', message: 'No ready KC3 game panel is available' }],
    })
  }

  envelope({ requestedAt, capturedAt, source, data, warnings }) {
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: this.revision,
      requestedAt: new Date(requestedAt).toISOString(),
      capturedAt: new Date(capturedAt).toISOString(),
      ageMs: Math.max(0, capturedAt - requestedAt),
      source: clone(source),
      data: clone(data),
      warnings: clone(warnings || []),
    }
  }

  withTimeout(promise, timeoutMs) {
    let timer
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('projection timed out')), timeoutMs)
      }),
    ]).finally(() => clearTimeout(timer))
  }

  async getKnowledge() {
    const extensionPath = this.getExtensionPath()
    if (!extensionPath) return null
    const version = this.getExtensionVersion() || ''
    const key = `${extensionPath}:${version}`
    if (!this.knowledge || this.knowledgeKey !== key) {
      this.knowledgeKey = key
      try {
        this.knowledge = await this.loadKnowledge(extensionPath)
      } catch (error) {
        this.knowledge = {
          warnings: [warning('knowledge_failed', error)],
          queryImprovements: () => ({ weekday: null, schedule: [], entries: [], requirements: [] }),
          queryQuests: () => ({ items: [], graph: {}, complete: false }),
        }
      }
    }
    return this.knowledge
  }

  async getSnapshot() {
    return this.readSnapshot()
  }

  async getFleets() {
    const snapshot = await this.getSnapshot()
    return Object.assign({}, snapshot, { data: snapshot.data.fleets })
  }

  async getLandBases() {
    const snapshot = await this.getSnapshot()
    return Object.assign({}, snapshot, { data: snapshot.data.landBases })
  }

  async getEquipment(filters = {}) {
    filters = filters || {}
    const snapshot = await this.getSnapshot()
    const equipment = snapshot.data.equipment || clone(EMPTY_DATA.equipment)
    const category = filters.category
    const masterId = filters.masterId ?? filters.equipmentId
    let instances = equipment.instances || []
    if (category != null)
      instances = instances.filter((item) => String(item.type) === String(category))
    if (masterId != null)
      instances = instances.filter((item) => Number(item.masterId) === Number(masterId))
    const ids = new Set(instances.map((item) => String(item.id)))
    const categories = (equipment.categories || [])
      .map((entry) =>
        Object.assign({}, entry, {
          count: instances.filter((item) => String(item.type) === String(entry.id)).length,
          items: (entry.items || []).filter((item) => ids.has(String(item.id))),
        }),
      )
      .filter((entry) => entry.count > 0 || category == null)
    return Object.assign({}, snapshot, {
      data: Object.assign({}, equipment, { total: instances.length, categories, instances }),
    })
  }

  async getImprovements(filters = {}) {
    filters = filters || {}
    const [snapshot, knowledge] = await Promise.all([this.getSnapshot(), this.getKnowledge()])
    if (!knowledge)
      return Object.assign({}, snapshot, {
        data: {
          available: false,
          schedule: [],
          entries: [],
          upgrades: [],
          warnings: [
            { code: 'knowledge_unavailable', message: 'KC3 static knowledge is unavailable' },
          ],
        },
      })
    const dayMap = {
      sun: 0,
      sunday: 0,
      mon: 1,
      monday: 1,
      tue: 2,
      tuesday: 2,
      wed: 3,
      wednesday: 3,
      thu: 4,
      thursday: 4,
      fri: 5,
      friday: 5,
      sat: 6,
      saturday: 6,
    }
    const query = Object.assign({}, filters, { snapshot })
    if (typeof query.day === 'string') {
      const day = query.day.toLowerCase()
      if (day === 'today') query.today = true
      else query.weekday = dayMap[day]
    }
    query.equipmentMasterId = query.equipmentMasterId ?? query.equipmentId ?? query.masterId
    query.secretaryMasterId = query.secretaryMasterId ?? query.secretaryId
    const data = knowledge.queryImprovements(query)
    return Object.assign({}, snapshot, {
      data,
      warnings: [...(snapshot.warnings || []), ...(knowledge.warnings || [])],
    })
  }

  async getQuests(filters = {}) {
    filters = filters || {}
    const snapshot = await this.getSnapshot()
    if (filters.mode !== 'knowledge' && !filters.knowledge) {
      const current = snapshot.data.quests
      if (!current || filters.id == null) return Object.assign({}, snapshot, { data: current })
      const ids = new Set((Array.isArray(filters.id) ? filters.id : [filters.id]).map(String))
      return Object.assign({}, snapshot, {
        data: Object.assign({}, current, {
          items: (current.items || []).filter((item) => ids.has(String(item.id))),
        }),
      })
    }
    const knowledge = await this.getKnowledge()
    const data = knowledge
      ? knowledge.queryQuests({ id: filters.id, snapshot })
      : { items: [], graph: {}, complete: false }
    return Object.assign({}, snapshot, {
      data,
      warnings: [...(snapshot.warnings || []), ...((knowledge && knowledge.warnings) || [])],
    })
  }
}

module.exports = { AgentApiBridge, SCHEMA_VERSION, EMPTY_DATA, frameList }
