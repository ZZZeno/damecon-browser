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
  assert.deepEqual(improvement.entries[0].recipes[0].upgrade, { masterId: 204, stars: 0 })
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

test('uses JST calendar day at the boundary', () => {
  assert.equal(jstWeekday(Date.parse('2026-09-06T14:59:59Z')), 0)
  assert.equal(jstWeekday(Date.parse('2026-09-06T15:00:00Z')), 1)
})
