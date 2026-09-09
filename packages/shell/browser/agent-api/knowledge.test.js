'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { loadKnowledge, jstWeekday } = require('./knowledge.js')

test('loads seven-day Akashi schedule, joins names/materials, and reverses quest graph', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'damecon-knowledge-'))
  await fs.mkdir(path.join(root, 'data', 'lang', 'data', 'en'), { recursive: true })
  await fs.writeFile(
    path.join(root, 'akashi.json'),
    JSON.stringify({ sun: { 100: [1, 2] }, Mon: { 100: [3] } }),
  )
  await fs.writeFile(
    path.join(root, 'quests_meta.json'),
    JSON.stringify({
      1: { unlock: [2] },
      2: { unlock: [] },
      EoF: 'comment',
      '841SB16': { unlock: [2] },
    }),
  )
  await fs.writeFile(
    path.join(root, 'WhoCallsTheFleet_items.nedb'),
    `${JSON.stringify({
      id: 100,
      name: { en: 'Test gear' },
      improvement: {
        upgrade: [204, 0],
        req: [[[true, false, false, false, false, false, false], [1]]],
        resource: [
          [180, 0, 0, 0],
          [0, 6, 0, 0, 0],
        ],
      },
    })}\n`,
  )
  await fs.writeFile(
    path.join(root, 'WhoCallsTheFleet_ships.nedb'),
    `${JSON.stringify({ id: 1, name: { en: 'Secretary', suffix: 1 } })}\n`,
  )
  await fs.writeFile(
    path.join(root, 'data', 'lang', 'data', 'en', 'quests.json'),
    JSON.stringify({
      1: 'Quest one',
      2: 'Quest two',
      101: {
        code: 'A1',
        name: 'Have ships',
        desc: 'Have 2 ships in your main fleet.',
        memo: 'memo',
        trackingDesc: ['ships'],
        rewardConsumables: [1, 2, 3, 4],
      },
    }),
  )
  const knowledge = await loadKnowledge(root)
  assert.equal(knowledge.improvements.schedule.length, 7)
  assert.deepEqual(knowledge.improvements.entries[0].secretaryIds, [1, 2])
  const improvement = knowledge.queryImprovements({ equipmentMasterId: 100 })
  assert.deepEqual(improvement.schedule[0].entries[0].secretaryNames, [null, null])
  assert.equal(improvement.entries[0].name, 'Test gear')
  assert.equal(improvement.entries[0].recipes[0].upgrade.masterId, 204)
  assert.equal(improvement.entries[0].recipes[0].upgrade.stars, 0)
  assert.equal(improvement.entries[0].recipes[0].upgrade.name, null)
  assert.equal(improvement.entries[0].recipes[0].upgrade.nameSource, null)
  assert.deepEqual(improvement.entries[0].recipes[0].requirements[0].weekdays, [0])
  assert.equal(improvement.entries[0].recipes[0].resources.base[0], 180)
  assert.equal(improvement.entries[0].recipes[0].resources.stages[0].screws, 0)
  const liveImprovement = knowledge.queryImprovements({
    equipmentMasterId: 100,
    snapshot: {
      source: { status: 'live' },
      data: {
        reference: {
          shipNames: {
            1: { masterId: 1, name: 'Secretary Kai' },
            2: { masterId: 2, name: 'Secretary Kai Ni' },
          },
        },
        equipment: { instances: [] },
      },
    },
  })
  assert.deepEqual(
    liveImprovement.entries[0].secretaryDetails.map((item) => item.fullName),
    ['Secretary Kai', 'Secretary Kai Ni'],
  )
  const ambiguous = knowledge.queryImprovements({
    equipmentMasterId: 100,
    snapshot: { source: { status: 'ambiguous' }, data: { equipment: { instances: [] } } },
  })
  assert.equal(ambiguous.entries[0].owned, null)
  assert.deepEqual(knowledge.quests.graph['2'].potentialPrerequisites, [1, '841SB16'])
  assert.ok(knowledge.quests.items.some((quest) => quest.variant === '841SB16'))
  assert.ok(!knowledge.quests.items.some((quest) => quest.id === 'EoF'))
  const quest = knowledge.queryQuests({ id: 101 }).items[0]
  assert.equal(quest.code, 'A1')
  assert.equal(quest.desc, 'Have 2 ships in your main fleet.')
  assert.deepEqual(quest.rewardConsumables, [1, 2, 3, 4])
})

test('decorates equipment and secretary names and preserves legacy and nested consumption', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'damecon-knowledge-names-'))
  const languageRoot = path.join(root, 'data', 'lang', 'data', 'en')
  await fs.mkdir(languageRoot, { recursive: true })
  await fs.writeFile(
    path.join(root, 'akashi.json'),
    JSON.stringify({ sun: { 100: [7] } }),
  )
  await fs.writeFile(
    path.join(root, 'WhoCallsTheFleet_items.nedb'),
    `${JSON.stringify({
      id: 100,
      improvement: {
        upgrade: [200, 1],
        req: [[[true, false, false, false, false, false, false], [7]]],
        resource: [
          [180, 0, 0, 0],
          [5, 8, 3, 4, 28, 1],
          [5, 8, 3, 4, [[298, 1], ['consumable_94', 1]]],
          [5, 8, 3, 4, [298, 2]],
          [5, 8, 3, 4, ['unknown_cost', 2]],
          [5, 8, 3, 4, [[null, 0]]],
        ],
      },
    })}\n`,
  )
  await fs.writeFile(
    path.join(root, 'WhoCallsTheFleet_ships.nedb'),
    `${JSON.stringify({ id: 7, name: { en: 'Static Ship', suffix: 2 } })}\n`,
  )
  await fs.writeFile(path.join(languageRoot, 'items.json'), JSON.stringify({
    28: 'Legacy consumed gear',
    100: 'Static gear',
    200: 'Static upgrade',
  }))
  const useitems = []
  useitems[94] = 'Repair bucket'
  await fs.writeFile(path.join(languageRoot, 'useitems.json'), JSON.stringify(useitems))

  const snapshot = {
    ready: true,
    source: { status: 'live' },
    data: {
      reference: {
        equipmentNames: {
          100: { masterId: 100, name: 'Live gear' },
          200: { masterId: 200, name: 'Live upgrade' },
          298: { masterId: 298, name: 'Live consumed gear' },
        },
        shipNames: { 7: { masterId: 7, name: 'Live ship Kai' } },
      },
      equipment: { instances: [{ masterId: 100, name: 'Instance gear' }] },
    },
  }
  const knowledge = await loadKnowledge(root)
  const result = knowledge.queryImprovements({ equipmentMasterId: 100, snapshot })
  const entry = result.entries[0]
  assert.equal(entry.name, 'Live gear')
  assert.equal(entry.nameSource, 'live_master')
  assert.equal(entry.recipes[0].upgrade.masterId, 200)
  assert.equal(entry.recipes[0].upgrade.name, 'Live upgrade')
  assert.equal(entry.recipes[0].upgrade.nameSource, 'live_master')
  assert.deepEqual(entry.recipes[0].requirements[0].secretaryNames, ['Live ship Kai'])
  assert.equal(entry.recipes[0].requirements[0].secretaryDetails[0].fullName, 'Live ship Kai')
  assert.equal(entry.materials[0], entry.recipes[0].resources)
  assert.equal(entry.matchingRecipes[0], entry.recipes[0])

  const stages = entry.recipes[0].resources.stages
  assert.equal(stages[0].consumedEquipment, 28)
  assert.deepEqual(stages[0].consumedItems, [{
    kind: 'equipment',
    masterId: 28,
    name: 'Legacy consumed gear',
    count: 1,
    nameSource: 'static',
  }])
  assert.deepEqual(stages[1].consumedEquipment, [[298, 1], ['consumable_94', 1]])
  assert.deepEqual(stages[1].consumedItems, [
    { kind: 'equipment', masterId: 298, name: 'Live consumed gear', count: 1, nameSource: 'live_master' },
    { kind: 'consumable', consumableId: 94, name: 'Repair bucket', count: 1, nameSource: 'static' },
  ])
  assert.deepEqual(stages[2].consumedItems, [
    { kind: 'equipment', masterId: 298, name: 'Live consumed gear', count: 2, nameSource: 'live_master' },
  ])
  assert.deepEqual(stages[3].consumedItems, [{ kind: 'unknown', raw: ['unknown_cost', 2] }])
  assert.deepEqual(stages[4].consumedEquipment, [[null, 0]])
  assert.deepEqual(stages[4].consumedItems, [])

  const fallback = knowledge.queryImprovements({
    equipmentMasterId: 100,
    snapshot: {
      ready: true,
      source: { status: 'live' },
      data: {
        reference: { equipmentNames: {} },
        equipment: { instances: [{ masterId: 100, name: 'Instance gear' }] },
      },
    },
  }).entries[0]
  assert.equal(fallback.name, 'Instance gear')
  assert.equal(fallback.nameSource, 'live_instance')

  const staticFallback = knowledge.queryImprovements({ equipmentMasterId: 100 }).entries[0]
  assert.equal(staticFallback.name, 'Static gear')
  assert.equal(staticFallback.nameSource, 'static')
  assert.equal(staticFallback.secretaryDetails[0].fullName, null)
  assert.equal(staticFallback.secretaryDetails[0].baseName, 'Static Ship')
})

test('uses JST calendar day at the boundary', () => {
  assert.equal(jstWeekday(Date.parse('2026-09-06T14:59:59Z')), 0)
  assert.equal(jstWeekday(Date.parse('2026-09-06T15:00:00Z')), 1)
})
