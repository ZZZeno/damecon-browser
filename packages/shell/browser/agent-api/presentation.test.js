'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { presentEquipment, presentImprovements, presentQuests } = require('./presentation.js')

function envelope(data) {
  return {
    schemaVersion: '1.1',
    revision: 1,
    capturedAt: 'now',
    source: { status: 'live' },
    data,
    warnings: [],
  }
}

test('concise equipment preserves named metrics while paginating and dropping category item copies', () => {
  const full = envelope({
    total: 3,
    categories: [
      { id: 6, name: 'Aircraft', count: 2, items: [{ id: 1 }, { id: 2 }] },
      { id: 1, name: 'Gun', count: 1, items: [{ id: 3 }] },
    ],
    instances: [
      {
        id: 1,
        masterId: 10,
        type: 6,
        name: 'A',
        stars: 2,
        ace: 3,
        stats: { antiAir: 9 },
        location: { kind: 'ship', shipId: 4, fleetId: 1 },
      },
      {
        id: 2,
        masterId: 11,
        type: 6,
        name: 'B',
        stars: 0,
        ace: 0,
        stats: {},
        location: { kind: 'base', baseId: 1 },
      },
      {
        id: 3,
        masterId: 12,
        type: 1,
        name: 'C',
        stars: 1,
        ace: 0,
        stats: {},
        location: { kind: 'unknown' },
      },
    ],
  })
  const first = presentEquipment(full, { limit: 2 }, false)
  assert.equal(first.responseFormat, 'concise')
  assert.equal(first.data.instances.length, 2)
  assert.deepEqual(first.data.pagination, {
    total: 3,
    returned: 2,
    nextCursor: first.data.pagination.nextCursor,
  })
  assert.equal(first.data.categories[0].count, 2)
  assert.equal('items' in first.data.categories[0], false)
  assert.equal(first.data.instances[0].stats.antiAir, 9)
  assert.equal(first.omittedFields.includes('data.categories[].items'), true)
  const second = presentEquipment(
    full,
    { limit: 2, cursor: first.data.pagination.nextCursor },
    false,
  )
  assert.deepEqual(
    second.data.instances.map((item) => item.id),
    [3],
  )
  assert.equal(second.data.pagination.nextCursor, null)
  assert.equal('raw' in second.data.instances[0], false)
  const detailed = presentEquipment(full, { responseFormat: 'detailed' }, true)
  assert.equal(detailed.data.categories[0].items.length, 2)
})

test('concise improvements and quests page complete lists while detailed keeps raw duplicate fields', () => {
  const improvements = envelope({
    entries: [
      {
        equipmentMasterId: 1,
        name: 'Gear',
        raw: { original: true },
        recipes: [
          {
            upgrade: { masterId: 2, name: 'Upgrade', stars: 1 },
            requirements: [{ secretaryIds: [3], secretaryNames: ['Ship'], raw: ['keep detailed'] }],
            resources: {
              stages: [
                {
                  consumedEquipment: [[4, 1]],
                  consumedItems: [{ kind: 'equipment', masterId: 4, name: 'Part', count: 1 }],
                  raw: ['stage'],
                },
              ],
            },
          },
        ],
        matchingRecipes: ['duplicate'],
        materials: ['duplicate'],
        schedule: ['duplicate'],
      },
      { equipmentMasterId: 2, name: 'Other', recipes: [] },
    ],
    schedule: [{ weekday: 0, entries: [] }],
    requirements: [['duplicate']],
  })
  const concise = presentImprovements(improvements, { limit: 1 }, false)
  assert.equal(concise.data.entries.length, 1)
  assert.equal(concise.data.pagination.total, 2)
  assert.equal('schedule' in concise.data, false)
  assert.equal('matchingRecipes' in concise.data.entries[0], false)
  assert.equal('materials' in concise.data.entries[0], false)
  assert.equal('raw' in concise.data.entries[0], false)
  assert.equal('raw' in concise.data.entries[0].recipes[0].requirements[0], false)
  assert.equal('consumedEquipment' in concise.data.entries[0].recipes[0].resources.stages[0], false)
  assert.equal(
    presentImprovements(improvements, { responseFormat: 'detailed' }, true).data.schedule.length,
    1,
  )

  const quests = envelope({
    items: [
      {
        id: 1,
        name: 'One',
        desc: 'condition',
        raw: { private: true },
        mayUnlock: [2],
        mayUnlockDetails: [{ id: 2, name: 'Two' }],
      },
      {
        id: 2,
        name: 'Two',
        desc: 'condition',
        raw: { private: true },
        mayUnlock: [],
        mayUnlockDetails: [],
      },
    ],
    graph: { 1: { mayUnlock: [2] } },
    history: [{ id: 1 }],
  })
  const q = presentQuests(quests, { mode: 'knowledge', limit: 1 }, false)
  assert.equal(q.data.items.length, 1)
  assert.equal(q.data.items[0].name, 'One')
  assert.equal(q.data.items[0].desc, 'condition')
  assert.equal('raw' in q.data.items[0], false)
  assert.equal('graph' in q.data, false)
  assert.equal(
    presentQuests(quests, { mode: 'knowledge', responseFormat: 'detailed' }, true).data.graph[1]
      .mayUnlock[0],
    2,
  )
})

test('pagination rejects a cursor after source data changes', () => {
  const full = envelope({
    total: 2,
    categories: [{ id: 1, name: 'One', count: 2, items: [] }],
    instances: [
      { id: 1, masterId: 1, type: 1, name: 'A', location: {} },
      { id: 2, masterId: 2, type: 1, name: 'B', location: {} },
    ],
  })
  const first = presentEquipment(full, { limit: 1 }, false)
  const changed = JSON.parse(JSON.stringify(full))
  changed.data.instances[1].name = 'Changed'
  assert.throws(
    () => presentEquipment(changed, { limit: 1, cursor: first.data.pagination.nextCursor }, false),
    /stale/,
  )
  assert.throws(
    () =>
      presentEquipment(
        full,
        { limit: 1, cursor: first.data.pagination.nextCursor, query: 'A' },
        false,
      ),
    /same filters/,
  )
  assert.throws(
    () => presentEquipment(full, { limit: 1, cursor: first.data.pagination.nextCursor }, true),
    /same filters/,
  )
  const revisionOnly = JSON.parse(JSON.stringify(full))
  revisionOnly.revision = 2
  assert.doesNotThrow(() =>
    presentEquipment(revisionOnly, { limit: 1, cursor: first.data.pagination.nextCursor }, false),
  )
})

test('concise pagination returns every item in order when master ids repeat', () => {
  const full = envelope({
    total: 5,
    categories: [{ id: 6, name: 'Aircraft', count: 5, items: [] }],
    instances: [1, 2, 3, 4, 5].map((id) => ({
      id,
      masterId: id < 4 ? 10 : 11,
      type: 6,
      name: `Plane ${id}`,
      location: { kind: 'unknown' },
    })),
  })
  const ids = []
  let cursor
  do {
    const page = presentEquipment(full, cursor ? { limit: 2, cursor } : { limit: 2 }, false)
    ids.push(...page.data.instances.map((item) => item.id))
    assert.equal(page.data.pagination.total, 5)
    cursor = page.data.pagination.nextCursor
  } while (cursor)
  assert.deepEqual(ids, [1, 2, 3, 4, 5])
  assert.equal(new Set(ids).size, 5)
})
