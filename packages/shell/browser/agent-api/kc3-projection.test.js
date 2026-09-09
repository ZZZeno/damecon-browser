'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { collectKc3Snapshot } = require('./kc3-projection.js')

function completeWindow() {
  const gear = { itemId: 101, masterId: 7, stars: 3, ace: 4, lock: 1, name: () => 'Test plane' }
  const ship = {
    rosterId: 11,
    masterId: 21,
    level: 80,
    items: [101, -1, -1, -1],
    ex_item: 0,
    slots: [18, 0, 0, 0],
    hp: [40, 40],
    fp: [50],
    tp: [10],
    aa: [20],
    ar: [30],
    ev: [40],
    as: [50],
    ls: [12],
    lk: [8],
    morale: 49,
    name: () => 'Test ship',
    equipment: () => [gear],
    obtainTP: (value) => {
      value.value += 3
      return value
    },
  }
  const fleet = {
    fleetId: 1,
    ships: [11],
    ship: () => [ship],
    deckParams: { seiku: 42, tp: 18, atp: { 1: 18 } },
    fighterPower: () => 40,
    fighterVeteran: () => 43,
    fighterBounds: () => [38, 46],
    eLoS: () => 22,
    eLos4: (factor) => factor * 10,
    calcTpObtain: () => ({
      value: 18,
      clear: true,
      embedded: false,
      tanktype: false,
      valueOf() {
        return this.value
      },
      valueOfRankA() {
        return 12
      },
    }),
    isStrikingForce: () => false,
  }
  const baseGear = { itemId: 102, masterId: 8, stars: 0, ace: 0, lock: 0, name: () => 'Base plane' }
  const base = {
    map: 6,
    rid: 1,
    range: 4,
    action: 2,
    level: 3,
    planes: [
      {
        api_slotid: 102,
        api_squadron_id: 1,
        api_count: 18,
        api_max_count: 18,
        api_state: 1,
        api_cond: 49,
      },
    ],
    toShipObject: () => ({
      fighterBounds: () => [10, 12],
      fighterPower: () => 11,
      fighterVeteran: () => 12,
      interceptionPower: () => 14,
    }),
  }
  return {
    PlayerManager: {
      fleets: [fleet],
      bases: [base],
      hq: { level: 120 },
      consumables: { devmats: 5 },
      combinedFleet: 0,
      baseConvertingSlots: [],
    },
    KC3ShipManager: { list: { x11: ship } },
    KC3GearManager: { list: { x101: gear, x102: baseGear } },
    KC3Master: {
      available: true,
      _raw: {
        ship: [
          { api_id: 21, api_name: 'Test ship Kai' },
          { api_id: 22, api_name: 'Test ship Kai Ni' },
        ],
        slotitem: [
          { api_id: 7, api_name: 'Test plane master' },
          { api_id: 8, api_name: 'Base plane master' },
        ],
      },
      ship: () => ({ api_name: 'Test ship' }),
      slotitem: () => ({
        api_name: 'Test plane',
        api_type: [1, 2, 6, 7],
        api_houg: 3,
        api_tais: 4,
        api_houk: 5,
        api_distance: 2,
      }),
    },
  }
}

test('projects live KC3 calculations and ownership without mutating managers', () => {
  global.window = completeWindow()
  const before = JSON.stringify(window.PlayerManager)
  const first = collectKc3Snapshot()
  const second = collectKc3Snapshot()
  assert.equal(first.ready, true)
  assert.equal(first.data.fleets.fleets[0].metrics.fighterPower, 40)
  assert.deepEqual(first.data.fleets.fleets[0].metrics.fighterBounds, { lower: 38, upper: 46 })
  assert.equal(first.data.fleets.fleets[0].metrics.transport.obtainTP.rankA, 12)
  assert.equal(first.data.landBases[0].metrics.defenseInterceptionPower, 14)
  assert.equal(first.data.equipment.instances[0].location.kind, 'ship')
  assert.equal(first.data.equipment.instances[1].location.areaId, 6)
  assert.equal(first.data.reference.shipNames['22'].name, 'Test ship Kai Ni')
  assert.deepEqual(first.data.reference.equipmentNames['7'], {
    masterId: 7,
    name: 'Test plane master',
  })
  assert.equal(JSON.stringify(window.PlayerManager), before)
  assert.deepEqual(first.data, second.data)
  const source = collectKc3Snapshot.toString()
  assert.doesNotThrow(() => Function('window', `return (${source})()`)(window))
})

test('projects equipment names from a KC3 master slotitem map without raw records', () => {
  global.window = completeWindow()
  window.KC3Master._raw.slotitem = {
    x7: { api_id: 7, api_name: 'Mapped plane' },
    8: { api_name: 'Mapped base plane' },
  }
  const snapshot = collectKc3Snapshot()
  assert.deepEqual(snapshot.data.reference.equipmentNames, {
    7: { masterId: 7, name: 'Mapped plane' },
    8: { masterId: 8, name: 'Mapped base plane' },
  })
  assert.equal(
    Object.values(snapshot.data.reference.equipmentNames).some((item) => item.raw),
    false,
  )
})

test('resolves names for unassigned ships and duplicate land-base ids by area', () => {
  const w = completeWindow()
  w.PlayerManager.bases[0].name = 'Area 6 base'
  const secondBase = Object.assign({}, w.PlayerManager.bases[0], {
    map: 7,
    name: 'Area 7 base',
    planes: [
      {
        api_slotid: 104,
        api_squadron_id: 2,
        api_count: 18,
        api_max_count: 18,
        api_state: 1,
        api_cond: 49,
      },
    ],
  })
  const unassignedGear = { itemId: 103, masterId: 7, name: () => 'Unassigned plane' }
  const unassignedShip = {
    rosterId: 12,
    masterId: 21,
    items: [103],
    slots: [5],
    name: () => 'Unassigned ship',
  }
  const secondBaseGear = { itemId: 104, masterId: 8, name: () => 'Area 7 plane' }
  w.PlayerManager.bases.push(secondBase)
  w.KC3ShipManager.list.x12 = unassignedShip
  w.KC3GearManager.list.x103 = unassignedGear
  w.KC3GearManager.list.x104 = secondBaseGear
  global.window = w

  const snapshot = collectKc3Snapshot()
  const unassigned = snapshot.data.equipment.instances.find((item) => item.itemId === 103)
  assert.equal(unassigned.location.shipId, 12)
  assert.equal(unassigned.location.shipName, 'Unassigned ship')
  const area6 = snapshot.data.equipment.instances.find((item) => item.itemId === 102)
  const area7 = snapshot.data.equipment.instances.find((item) => item.itemId === 104)
  assert.equal(area6.location.baseName, 'Area 6 base')
  assert.equal(area7.location.baseName, 'Area 7 base')
  assert.equal(snapshot.data.landBases[0].planes[0].name, 'Base plane')
  assert.equal(snapshot.data.landBases[1].planes[0].name, 'Area 7 plane')
})

test('enriches ownership conflict locations after collecting all assignments', () => {
  const w = completeWindow()
  w.PlayerManager.bases[0].name = 'Conflict base'
  w.PlayerManager.bases[0].planes[0].api_slotid = 101
  global.window = w
  const snapshot = collectKc3Snapshot()
  const conflict = snapshot.data.equipment.ownershipConflicts.find((item) => item.itemId === 101)
  assert.ok(conflict)
  assert.equal(conflict.locations[0].shipName, 'Test ship')
  assert.equal(conflict.locations[1].baseName, 'Conflict base')
})

test('does not claim KC3 ready for incomplete live objects', () => {
  global.window = { PlayerManager: { fleets: [] } }
  const snapshot = collectKc3Snapshot()
  assert.equal(snapshot.ready, false)
  assert.equal(snapshot.data.player, null)
})

test('deduplicates current quest arrays and preserves raw task facts and metadata', () => {
  global.window = completeWindow()
  window.KC3QuestManager = {
    open: [1, '1'],
    active: [2],
    list: {
      q1: {
        id: 1,
        status: 3,
        type: 1,
        label: 2,
        materials: [1, 2, 3, 4],
        tracking: [[1, 2]],
        progress: 1,
        state: 3,
      },
      q2: {
        id: 2,
        status: 2,
        type: 2,
        label: 3,
        materials: [0, 1, 0, 0],
        tracking: [[0, 1]],
        progress: 0,
        state: 2,
      },
      q3: {
        id: 3,
        status: 3,
        type: 3,
        label: 4,
        materials: [0, 0, 1, 0],
        tracking: false,
        progress: 1,
        state: 3,
      },
    },
  }
  window.KC3Meta = Object.assign(window.KC3Meta || {}, {
    quest: (id) => ({
      code: `Q${id}`,
      name: `Quest ${id}`,
      desc: 'description',
      memo: 'memo',
      trackingDesc: ['progress'],
    }),
  })
  const quests = collectKc3Snapshot().data.quests
  assert.equal(quests.items.length, 3)
  assert.equal(quests.items[0].status, 1)
  assert.deepEqual(quests.items[0].materials, [1, 2, 3, 4])
  assert.equal(quests.items[0].meta.code, 'Q1')
  assert.equal(quests.items[0].meta.desc, 'description')
  assert.equal(quests.items[2].status, 3)
})
