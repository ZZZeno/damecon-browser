'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { AgentApiBridge, EMPTY_DATA } = require('./bridge.js')

function fixture(result, url = 'chrome-extension://kc3/pages/devtools/themes/game.html') {
  let calls = 0
  const frame = {
    url,
    routingId: 4,
    executeJavaScript: async () => {
      calls += 1
      return result
    },
    get calls() {
      return calls
    },
  }
  const contents = { id: 12, mainFrame: { framesInSubtree: [frame] } }
  return { frame, contents }
}

function bridgeFor(contents, options = {}) {
  return new AgentApiBridge(
    Object.assign(
      {
        getWebContents: () => contents,
        getKc3ExtensionId: () => 'kc3',
        collectSource: 'function collect () {}',
      },
      options,
    ),
  )
}

test('reads the current unique KC3 frame and deduplicates concurrent calls', async () => {
  const data = Object.assign({}, EMPTY_DATA, { player: { hq: { level: 88 } } })
  const item = fixture({ ready: true, source: { observedAt: 100 }, data, warnings: [] })
  const bridge = bridgeFor([item.contents], {
    now: (() => {
      let n = 100
      return () => ++n
    })(),
  })
  const [first, second] = await Promise.all([bridge.getSnapshot(), bridge.getSnapshot()])
  assert.equal(first.source.status, 'live')
  assert.equal(first.data.player.hq.level, 88)
  assert.equal(first.revision, second.revision)
  assert.equal(item.frame.calls, 1)
})

test('returns unavailable when no matching frame is present', async () => {
  const item = fixture({ ready: true }, 'chrome-extension://other/pages/devtools/themes/game.html')
  const result = await bridgeFor([item.contents]).getSnapshot()
  assert.equal(result.source.status, 'unavailable')
  assert.equal(result.data.player, null)
  assert.match(result.warnings[0].code, /kc3_unavailable/)
})

test('does not mix multiple ready sources', async () => {
  const first = fixture({ ready: true, data: EMPTY_DATA })
  const second = fixture(
    { ready: true, data: EMPTY_DATA },
    'chrome-extension://kc3/pages/devtools/themes/other.html',
  )
  const result = await bridgeFor([first.contents, second.contents]).getSnapshot()
  assert.equal(result.source.status, 'ambiguous')
  assert.equal(result.warnings[0].code, 'AMBIGUOUS_SOURCE')
  assert.equal(result.source.candidates.length, 2)
})

test('reports projection timeout as unavailable', async () => {
  const item = fixture({ ready: true })
  item.frame.executeJavaScript = () => new Promise(() => {})
  const result = await bridgeFor([item.contents], { timeoutMs: 5 }).getSnapshot()
  assert.equal(result.source.status, 'unavailable')
  assert.equal(result.warnings[0].code, 'projection_failed')
})

test('equipment category uses KC3 api_type[2] only', async () => {
  const equipment = {
    total: 2,
    categories: [
      { id: 6, count: 1, items: [{ id: 1 }] },
      { id: 7, count: 1, items: [{ id: 2 }] },
    ],
    instances: [
      { id: 1, masterId: 10, type: 6, iconType: 7 },
      { id: 2, masterId: 11, type: 7, iconType: 6 },
    ],
  }
  const data = Object.assign({}, EMPTY_DATA, { equipment })
  const item = fixture({ ready: true, data })
  const result = await bridgeFor([item.contents]).getEquipment({ category: 6 })
  assert.deepEqual(
    result.data.instances.map((entry) => entry.id),
    [1],
  )
  assert.equal(result.data.categories[0].count, 1)
})

test('filters current quest items by an explicit id', async () => {
  const data = Object.assign({}, EMPTY_DATA, {
    quests: { items: [{ id: 100 }, { id: 101 }], observed: true },
  })
  const item = fixture({ ready: true, data })
  const result = await bridgeFor([item.contents]).getQuests({ mode: 'current', id: 101 })
  assert.deepEqual(
    result.data.items.map((quest) => quest.id),
    [101],
  )
})
