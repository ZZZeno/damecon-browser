'use strict'

// This function intentionally has no dependencies.  The generic JSON API sends
// its source to a KC3 devtools frame and evaluates it with executeJavaScript.
function collectKc3Snapshot() {
  const w = typeof window === 'object' ? window : globalThis
  const now = Date.now()
  const warnings = []
  const pm = w.PlayerManager
  const shipManager = w.KC3ShipManager || (pm && pm.ships)
  const gearManager = w.KC3GearManager || (pm && pm.gears)
  const master = w.KC3Master || (pm && pm.master)
  const fleetsReady = !!(pm && Array.isArray(pm.fleets))
  const shipsReady = !!(shipManager && (shipManager.list || Array.isArray(shipManager)))
  const gearsReady = !!(gearManager && (gearManager.list || Array.isArray(gearManager)))
  const masterReady = !!(
    master &&
    (typeof master.ship === 'function' || master._ship || master.ships) &&
    (typeof master.slotitem === 'function' || master._slotitem || master.slotitems) &&
    master.available !== false
  )
  const hqReady = !!(pm && pm.hq && Number(pm.hq.level) > 0)
  const fleetReady = !!(
    pm &&
    pm.fleets &&
    pm.fleets.some((fleet) => fleet && Number(fleet.fleetId || fleet.api_id) > 0)
  )
  const source = {
    lastEvent: null,
    lastEventAt: null,
    observedAt: now,
    capturedAt: now,
    sessionObservedAt: null,
    domains: {},
  }
  const empty = {
    player: null,
    fleets: {
      combinedFleet: { code: 0, type: 'none', mainFleetId: null, escortFleetId: null },
      fleets: [],
    },
    landBases: [],
    equipment: { total: 0, categories: [], instances: [] },
    quests: null,
  }
  if (!(fleetsReady && shipsReady && gearsReady && masterReady && hqReady && fleetReady)) {
    warnings.push({
      code: 'kc3_unready',
      message: 'KC3 live managers or master data are not ready',
    })
    return { ready: false, source, data: empty, warnings }
  }
  const read = (fn, fallback = null) => {
    try {
      const value = fn()
      return value === undefined ? fallback : value
    } catch (error) {
      warnings.push({ code: 'read_failed', message: String((error && error.message) || error) })
      return fallback
    }
  }
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)
  const gearGet = (id) =>
    read(() => {
      const list = gearManager.list || gearManager
      if (Array.isArray(list))
        return (
          list.find(
            (gear) => gear && Number(gear.itemId ?? gear.id ?? gear.api_id) === Number(id),
          ) || null
        )
      if (list && typeof list === 'object') return list['x' + Number(id)] || list[id] || null
      return null
    }, null)
  const masterGear = (id) =>
    read(
      () =>
        typeof master.slotitem === 'function'
          ? master.slotitem(Number(id))
          : (master._slotitem && master._slotitem[id]) ||
            (master.slotitems && master.slotitems[id]),
      null,
    )
  const gearRecord = (gear, location) => {
    if (!gear) return null
    const id = number(gear.itemId != null ? gear.itemId : gear.id)
    const masterId = number(gear.masterId != null ? gear.masterId : gear.api_slotitem_id)
    const meta = masterGear(masterId)
    const apiType = meta && Array.isArray(meta.api_type) ? meta.api_type.slice() : null
    return {
      id,
      itemId: id,
      masterId,
      name: read(
        () =>
          typeof gear.name === 'function' ? gear.name() : meta && (meta.api_name || meta.name),
        null,
      ),
      apiType,
      type: apiType && apiType[2] != null ? apiType[2] : null,
      iconType: apiType && apiType[3] != null ? apiType[3] : null,
      locked: gear.lock != null ? !!gear.lock : gear.api_locked != null ? !!gear.api_locked : null,
      stars: number(gear.stars != null ? gear.stars : gear.api_level),
      ace: number(gear.ace != null ? gear.ace : gear.api_alv),
      stats: meta
        ? {
            firepower: number(meta.api_houg),
            torpedo: number(meta.api_raig),
            antiAir: number(meta.api_tyku),
            armor: number(meta.api_souk),
            evasion: number(meta.api_houk),
            los: number(meta.api_saku),
            bombing: number(meta.api_baku),
            asw: number(meta.api_tais),
            range: number(meta.api_leng),
            distance: meta.api_distance ?? null,
            hit: number(meta.api_houm),
            luck: number(meta.api_luck),
          }
        : null,
      location,
    }
  }
  const seen = new Map()
  const addGear = (id, location) => {
    if (!(Number(id) > 0)) return
    const record = gearRecord(gearGet(id), location)
    if (!record) return
    const key = record.id || String(id)
    if (seen.has(key)) {
      const old = seen.get(key)
      old.locations = old.locations || [old.location]
      old.locations.push(location)
      old.location = { kind: 'conflict' }
      return
    }
    seen.set(key, record)
  }
  const shipGet = (id) =>
    read(() => {
      const list = shipManager.list || shipManager
      if (Array.isArray(list))
        return (
          list.find(
            (ship) => ship && Number(ship.rosterId ?? ship.id ?? ship.api_id) === Number(id),
          ) || null
        )
      if (list && typeof list === 'object') return list['x' + Number(id)] || list[id] || null
      return null
    }, null)
  const shipMaster = (id) =>
    read(
      () =>
        typeof master.ship === 'function'
          ? master.ship(Number(id))
          : (master._ship && master._ship[id]) || (master.ships && master.ships[id]),
      null,
    )
  const shipRecord = (ship, fleetId, slot) => {
    if (!ship) return null
    const shipId = number(ship.rosterId != null ? ship.rosterId : ship.id)
    const masterId = number(ship.masterId != null ? ship.masterId : ship.api_ship_id)
    const meta = shipMaster(masterId)
    const items = Array.isArray(ship.items)
      ? ship.items.slice()
      : Array.isArray(ship.api_slot)
        ? ship.api_slot.slice()
        : []
    const slots = Array.isArray(ship.slots)
      ? ship.slots.slice()
      : Array.isArray(ship.api_onslot)
        ? ship.api_onslot.slice()
        : []
    const ex = ship.ex_item != null ? ship.ex_item : ship.api_slot_ex
    items.forEach((itemId, index) =>
      addGear(itemId, {
        kind: 'ship',
        shipId,
        fleetId,
        slot: index,
        slotSize: number(slots[index]),
      }),
    )
    addGear(ex, { kind: 'ship_extra', shipId, fleetId, slot: 'extra' })
    return {
      id: shipId,
      rosterId: shipId,
      masterId,
      name: read(
        () =>
          typeof ship.name === 'function' ? ship.name() : meta && (meta.api_name || meta.name),
        null,
      ),
      level: number(ship.level != null ? ship.level : ship.api_lv),
      hp: Array.isArray(ship.hp) ? ship.hp.slice() : null,
      fuel: number(ship.fuel),
      ammo: number(ship.ammo != null ? ship.ammo : ship.bull),
      morale: number(ship.morale != null ? ship.morale : ship.cond),
      absent: read(() => (typeof ship.isAbsent === 'function' ? !!ship.isAbsent() : null), null),
      taiha: read(() => (typeof ship.isTaiha === 'function' ? !!ship.isTaiha() : null), null),
      locked: ship.lock != null ? !!ship.lock : ship.api_locked != null ? !!ship.api_locked : null,
      stats: {
        firepower: number(ship.fp && ship.fp[0]),
        torpedo: number(ship.tp && ship.tp[0]),
        antiAir: number(ship.aa && ship.aa[0]),
        armor: number(ship.ar && ship.ar[0]),
        evasion: number(ship.ev && ship.ev[0]),
        asw: number(ship.as && ship.as[0]),
        los: number(ship.ls && ship.ls[0]),
        luck: number(ship.lk && ship.lk[0]),
      },
      slots: items.map((itemId, index) => ({
        index,
        itemId: number(itemId),
        masterId: number((gearGet(itemId) || {}).masterId),
        size: number(slots[index]),
        capacity: number(Array.isArray(meta && meta.api_maxeq) ? meta.api_maxeq[index] : null),
        equipment: seen.get(number(itemId)) || null,
      })),
      extra: {
        itemId: number(ex),
        masterId: number((gearGet(ex) || {}).masterId),
        equipment: seen.get(number(ex)) || null,
      },
      fleetId,
      fleetSlot: slot,
    }
  }
  const fleetPower = (fleet, method, fallback) =>
    number(read(() => (typeof fleet[method] === 'function' ? fleet[method]() : fallback), fallback))
  const obtainTransport = (fleet, ships) => {
    if (fleet && typeof fleet.calcTpObtain === 'function')
      return read(() => {
        const result = fleet.calcTpObtain(false)
        return result && typeof result === 'object'
          ? {
              value: number(result.valueOf ? result.valueOf() : result.value),
              rankS: number(result.valueOf ? result.valueOf() : result.value),
              rankA: number(
                typeof result.valueOfRankA === 'function' ? result.valueOfRankA() : null,
              ),
              clear: result.clear !== false,
              embedded: !!result.embedded,
              tanktype: !!result.tanktype,
            }
          : null
      }, null)
    const meta = w.KC3Meta
    if (!meta || typeof meta.tpObtained !== 'function') return null
    return read(() => {
      let result = meta.tpObtained()
      ships.forEach((ship) => {
        if (ship && typeof ship.obtainTP === 'function') result = ship.obtainTP(result)
      })
      return result && typeof result === 'object'
        ? {
            value: number(result.valueOf ? result.valueOf() : result.value),
            rankS: number(result.valueOf ? result.valueOf() : result.value),
            rankA: number(typeof result.valueOfRankA === 'function' ? result.valueOfRankA() : null),
            clear: result.clear !== false,
            embedded: !!result.embedded,
            tanktype: !!result.tanktype,
          }
        : null
    }, null)
  }
  const fleets = []
  const assignedShipIds = new Set()
  const combinedCode = number(pm.combinedFleet) || 0
  const sortieManager = w.KC3SortieManager
  const sortie = read(
    () =>
      !!(
        sortieManager &&
        typeof sortieManager.isOnSortie === 'function' &&
        sortieManager.isOnSortie()
      ),
    false,
  )
  const pvp = read(
    () => !!(sortieManager && typeof sortieManager.isPvP === 'function' && sortieManager.isPvP()),
    false,
  )
  const sentFleet =
    sortieManager && Number(sortieManager.fleetSent) > 0 ? Number(sortieManager.fleetSent) : null
  pm.fleets.forEach((fleet, index) => {
    if (!fleet) return
    const fleetId = number(fleet.fleetId != null ? fleet.fleetId : fleet.api_id) || index + 1
    const rawShips = Array.isArray(fleet.ships) ? fleet.ships : []
    const ships =
      read(
        () =>
          typeof fleet.ship === 'function' ? fleet.ship() : rawShips.map(shipGet).filter(Boolean),
        [],
      ) || []
    const records = ships.map((ship, slot) => shipRecord(ship, fleetId, slot)).filter(Boolean)
    records.forEach((ship) => assignedShipIds.add(ship.rosterId))
    const mission = Array.isArray(fleet.mission) ? fleet.mission.slice() : null
    const expedition = fleetId > 1 && !!(mission && mission[0] > 0)
    const bounds = read(
      () => (typeof fleet.fighterBounds === 'function' ? fleet.fighterBounds() : null),
      null,
    )
    const formulas = {}
    ;[1, 2, 3, 4].forEach((factor) => {
      formulas[factor] = number(
        read(
          () =>
            typeof fleet.eLos4 === 'function'
              ? fleet.eLos4(factor, 0.4, Number(pm.hq && pm.hq.level) || 0)
              : null,
          null,
        ),
      )
    })
    const operation = sortie ? 'sortie' : pvp ? 'pvp' : null
    const escort = combinedCode > 0 && sentFleet === 1 && fleetId === 2
    const fleetStatus = expedition
      ? 'expedition'
      : operation
        ? fleetId === sentFleet
          ? operation
          : escort
            ? 'combined_following'
            : 'unknown'
        : 'port'
    fleets.push({
      id: fleetId,
      code: fleetId,
      type: expedition ? 'expedition' : fleetId === 1 ? 'main' : 'fleet',
      active: fleet.active !== false,
      name: fleet.name || '',
      mission,
      expedition: {
        active: expedition,
        id: expedition ? fleetId : null,
        missionId: expedition ? number(mission[1]) : null,
        completionDeadline: expedition ? number(mission[2]) : null,
      },
      strikingForce: read(
        () =>
          typeof fleet.isStrikingForce === 'function'
            ? !!fleet.isStrikingForce()
            : records.length > 6,
        null,
      ),
      status: fleetStatus,
      shipsToEscape: Array.isArray(fleet.shipsToEscape) ? fleet.shipsToEscape.slice() : [],
      ships: records,
      metrics: {
        fighterPower: fleetPower(fleet, 'fighterPower', null),
        fighterVeteran: fleetPower(fleet, 'fighterVeteran', null),
        fighterBounds: Array.isArray(bounds)
          ? { lower: number(bounds[0]), upper: number(bounds[1]) }
          : null,
        eLos: number(read(() => (typeof fleet.eLoS === 'function' ? fleet.eLoS() : null), null)),
        eLos4: formulas,
        transport: {
          deck: {
            tp: number(fleet.deckParams && fleet.deckParams.tp),
            atp:
              fleet.deckParams && fleet.deckParams.atp
                ? Object.assign({}, fleet.deckParams.atp)
                : null,
          },
          obtainTP: obtainTransport(fleet, ships),
        },
      },
      deckParams: fleet.deckParams ? JSON.parse(JSON.stringify(fleet.deckParams)) : {},
    })
  })
  const shipList = shipManager.list || shipManager
  if (shipList && typeof shipList === 'object')
    Object.keys(shipList).forEach((key) => {
      const ship = shipList[key]
      const id = ship && Number(ship.rosterId != null ? ship.rosterId : ship.id)
      if (ship && id > 0 && !assignedShipIds.has(id)) shipRecord(ship, null, null)
    })
  const combined = {
    code: combinedCode,
    type:
      { 1: 'carrier_task_force', 2: 'surface_task_force', 3: 'transport_striking_force' }[
        combinedCode
      ] || (combinedCode ? 'combined' : 'none'),
    mainFleetId: combinedCode ? 1 : null,
    escortFleetId: combinedCode ? 2 : null,
  }
  const bases = []
  const ownershipConflicts = []
  ;(Array.isArray(pm.bases) ? pm.bases : []).forEach((base, index) => {
    if (!base) return
    const baseId = number(base.rid)
    const mapId = number(base.map)
    if (baseId === -1 || mapId === -1) return
    const planes = Array.isArray(base.planes)
      ? base.planes.map((plane, slot) => {
          const slotId = number(plane.api_slotid != null ? plane.api_slotid : plane.slotId)
          addGear(slotId, {
            kind: 'land_base',
            baseId: number(base.rid) || index + 1,
            areaId: mapId,
            slot,
          })
          const gear = gearGet(slotId)
          return {
            slot,
            squadronId: number(plane.api_squadron_id),
            itemId: slotId,
            masterId: number(gear && gear.masterId),
            count: number(plane.api_count),
            maxCount: number(plane.api_max_count),
            state: number(plane.api_state),
            morale: number(plane.api_cond),
            areaId: mapId,
            equipment: seen.get(slotId) || null,
          }
        })
      : []
    const pseudo = read(
      () => (typeof base.toShipObject === 'function' ? base.toShipObject() : null),
      null,
    )
    const fighterBounds = read(
      () =>
        pseudo && typeof pseudo.fighterBounds === 'function' ? pseudo.fighterBounds(true) : null,
      null,
    )
    const defense = read(
      () =>
        pseudo && typeof pseudo.interceptionPower === 'function'
          ? pseudo.interceptionPower()
          : null,
      null,
    )
    bases.push({
      id: baseId || index + 1,
      map: mapId,
      name: base.name || '',
      range: number(base.range),
      rangeBase: number(base.rangeBase),
      rangeBonus: number(base.rangeBonus),
      action: number(base.action),
      actionName: read(
        () => (typeof base.getActionTerm === 'function' ? base.getActionTerm() : null),
        null,
      ),
      level: number(base.level),
      planes,
      metrics: {
        sortieFighterBounds: Array.isArray(fighterBounds)
          ? { lower: number(fighterBounds[0]), upper: number(fighterBounds[1]) }
          : null,
        sortieFighterPower: number(
          read(
            () =>
              pseudo && typeof pseudo.fighterPower === 'function'
                ? pseudo.fighterPower(true)
                : null,
            null,
          ),
        ),
        sortieFighterVeteran: number(
          read(
            () =>
              pseudo && typeof pseudo.fighterVeteran === 'function'
                ? pseudo.fighterVeteran(true)
                : null,
            null,
          ),
        ),
        defenseInterceptionPower: number(defense),
        highAltitudeDefense: null,
      },
      converting: false,
    })
  })
  ;(Array.isArray(pm.baseConvertingSlots) ? pm.baseConvertingSlots : []).forEach((slot) =>
    addGear(slot.api_slotid || slot.slotId || slot, { kind: 'base_converting', raw: slot }),
  )
  const gearList = gearManager.list || gearManager
  if (gearList && typeof gearList === 'object')
    Object.keys(gearList).forEach((key) => {
      const gear = gearList[key]
      const id = gear && (gear.itemId != null ? gear.itemId : gear.api_id)
      if (gear && !seen.has(Number(id))) addGear(id, { kind: 'unknown' })
    })
  const instances = Array.from(seen.values())
  instances.forEach((item) => {
    if (item.location && item.location.kind === 'conflict')
      ownershipConflicts.push({ itemId: item.itemId, locations: item.locations || [] })
  })
  const categoriesMap = new Map()
  instances.forEach((item) => {
    const id = item.type == null ? null : item.type
    if (!categoriesMap.has(id))
      categoriesMap.set(id, {
        id,
        name: read(() =>
          w.KC3Meta && typeof w.KC3Meta.gearTypeName === 'function'
            ? w.KC3Meta.gearTypeName(2, id)
            : null,
        ),
        count: 0,
        items: [],
      })
    const category = categoriesMap.get(id)
    category.count += 1
    category.items.push(item)
  })
  const quests = (() => {
    const qm = w.KC3QuestManager
    if (!qm || (!qm.list && !qm.open && !qm.active)) return null
    const ids = new Set()
    const addId = (id) => {
      if (id != null && String(id).replace(/^q/, '')) ids.add(String(id).replace(/^q/, ''))
    }
    ;(Array.isArray(qm.open) ? qm.open : []).forEach(addId)
    ;(Array.isArray(qm.active) ? qm.active : []).forEach(addId)
    Object.keys(qm.list || {}).forEach(addId)
    const items = Array.from(ids).map((id) => {
      const q = qm.list && (qm.list['q' + id] || qm.list[id])
      const numericId = /^\d+$/.test(id) ? Number(id) : id
      const meta =
        read(
          () =>
            w.KC3Meta && typeof w.KC3Meta.quest === 'function' ? w.KC3Meta.quest(numericId) : null,
          null,
        ) || {}
      const status =
        Array.isArray(qm.active) && qm.active.map(String).includes(id)
          ? 2
          : Array.isArray(qm.open) && qm.open.map(String).includes(id)
            ? 1
            : number(q && (q.status ?? q.state))
      return {
        id: numericId,
        status,
        type: number(q && q.type),
        label: number(q && q.label),
        materials: Array.isArray(q && q.materials) ? q.materials.slice() : null,
        tracking: q && q.tracking != null ? JSON.parse(JSON.stringify(q.tracking)) : null,
        progress: q
          ? { progress: number(q.progress), max: number(q.max), state: number(q.state) }
          : null,
        meta: {
          available: !!(meta.name || meta.code || meta.desc),
          code: meta.code ?? null,
          name: meta.name ?? null,
          desc: meta.desc ?? null,
          memo: meta.memo ?? null,
          trackingDesc: meta.trackingDesc ?? null,
        },
      }
    })
    return {
      observed: true,
      statusMeaning: { 1: 'open', 2: 'active', 3: 'closed_or_reward_ready_as_recorded' },
      completeness: 'last_observed',
      currentAvailable: Array.isArray(qm.open) ? qm.open.map((id) => number(id) ?? id) : [],
      accepted: Array.isArray(qm.active) ? qm.active.map((id) => number(id) ?? id) : [],
      history: items,
      items,
    }
  })()
  const secretaryShip = fleets[0] && fleets[0].ships[0]
  const rawShips = master && master._raw && (master._raw.ship || master._raw.ships)
  const shipNames = {}
  if (Array.isArray(rawShips)) {
    rawShips.forEach((ship) => {
      if (ship && ship.api_id != null && ship.api_name != null)
        shipNames[String(ship.api_id)] = { masterId: Number(ship.api_id), name: ship.api_name }
    })
  } else if (rawShips && typeof rawShips === 'object') {
    Object.entries(rawShips).forEach(([id, ship]) => {
      if (ship && ship.api_name != null)
        shipNames[String(ship.api_id ?? id)] = {
          masterId: Number(ship.api_id ?? id),
          name: ship.api_name,
        }
    })
  }
  const player = {
    hq: pm.hq
      ? { level: number(pm.hq.level), exp: number(pm.hq.exp), name: pm.hq.name || null }
      : null,
    resources: pm.hq && Array.isArray(pm.hq.lastMaterial) ? pm.hq.lastMaterial.slice() : null,
    consumables: pm.consumables ? JSON.parse(JSON.stringify(pm.consumables)) : null,
    secretary: secretaryShip
      ? {
          rosterId: secretaryShip.rosterId,
          masterId: secretaryShip.masterId,
          name: secretaryShip.name,
        }
      : null,
    improvement: pm.improvement || null,
  }
  const unassigned = instances.filter((item) => item.location && item.location.kind === 'unknown')
  const equipment = {
    total: instances.length,
    categories: Array.from(categoriesMap.values()),
    instances,
    ownership: {
      basedOn: 'observed_assignments',
      unassignedCount: unassigned.length,
      unassignedMayBeIncomplete: true,
    },
    ownershipConflicts,
  }
  return {
    ready: true,
    source,
    data: {
      player,
      reference: { shipNames },
      fleets: { combinedFleet: combined, fleets },
      landBases: bases,
      equipment,
      quests,
    },
    warnings,
  }
}

module.exports = { collectKc3Snapshot }
