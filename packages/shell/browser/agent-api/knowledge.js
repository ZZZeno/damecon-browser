'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

async function readFirst(root, names) {
  for (const name of names) {
    try {
      return {
        path: path.join(root, name),
        value: JSON.parse(await fs.readFile(path.join(root, name), 'utf8')),
      }
    } catch {}
  }
  return null
}

async function findFile(root, basename) {
  const candidates = [
    basename,
    path.join('src', basename),
    path.join('data', basename),
    path.join('src', 'data', basename),
  ]
  for (const name of candidates) {
    const filePath = path.join(root, name)
    try {
      const raw = await fs.readFile(filePath, 'utf8')
      return { path: filePath, value: basename.endsWith('.json') ? JSON.parse(raw) : raw }
    } catch {}
  }
  return null
}

async function readTranslation(root, language, basename) {
  const variants = [
    path.join('src', 'data', 'lang', language, basename),
    path.join('src', 'data', 'lang', 'data', language, basename),
    path.join('src', 'data', 'lang', language, 'data', basename),
    path.join('data', 'lang', 'data', language, basename),
    path.join('src', 'data', language, basename),
    path.join('data', 'lang', language, basename),
    path.join('lang', language, basename),
    path.join('src', 'lang', language, basename),
  ]
  return readFirst(root, variants)
}

function asId(value) {
  if (typeof value === 'string') {
    const weekday = {
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
    }[value.toLowerCase()]
    if (weekday != null) return weekday
  }
  const id = Number(value)
  return Number.isFinite(id) ? id : value
}

function readNedb(text) {
  if (Array.isArray(text)) return text
  if (text && typeof text === 'object') return [text]
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { raw: line }
      }
    })
}

function jstWeekday(now = Date.now()) {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    weekday: 'short',
  }).format(new Date(now))
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
}

function normalizeImprovement(raw) {
  const output = []
  const add = (weekday, equipmentMasterId, value, secretaryIds) => {
    if (Array.isArray(value)) secretaryIds = value
    const entry = value && typeof value === 'object' ? Object.assign({}, value) : { value }
    const id = entry.equipmentMasterId ?? entry.masterId ?? entry.id ?? equipmentMasterId
    const secretaries = entry.secretaryIds || entry.secretaries || secretaryIds || []
    output.push({
      weekday: asId(weekday),
      equipmentMasterId: asId(id),
      secretaryIds: Array.isArray(secretaries) ? secretaries.map(asId) : [],
      requirements: entry.requirements || entry.materials || entry.cost || null,
      upgrade: entry.upgrade || entry.to || entry.target || null,
      source: entry.source || null,
      data: Array.isArray(value) ? null : entry,
    })
  }
  const days = raw && raw.weekdays ? raw.weekdays : raw
  if (Array.isArray(days))
    days.forEach((day, weekday) => {
      const entries = (day && (day.items || day.gears || day.equipment || day.entries)) || day
      if (Array.isArray(entries))
        entries.forEach((entry) =>
          add(
            entry.weekday ?? weekday,
            entry.equipmentMasterId ?? entry.masterId ?? entry.id,
            entry,
            entry.secretaryIds,
          ),
        )
      else if (entries && typeof entries === 'object')
        Object.entries(entries).forEach(([id, value]) =>
          add(weekday, id, value, value && value.secretaryIds),
        )
    })
  else if (days && typeof days === 'object')
    Object.entries(days).forEach(([weekday, entries]) => {
      if (Array.isArray(entries))
        entries.forEach((entry) =>
          add(
            entry.weekday ?? weekday,
            entry.equipmentMasterId ?? entry.masterId ?? entry.id,
            entry,
            entry.secretaryIds,
          ),
        )
      else if (entries && typeof entries === 'object')
        Object.entries(entries).forEach(([id, value]) =>
          add(weekday, id, value, value && value.secretaryIds),
        )
    })
  return output
}

function namesFrom(raw) {
  if (!raw) return {}
  if (Array.isArray(raw))
    return raw.reduce((out, item) => {
      if (item) out[item.api_id ?? item.id] = item.api_name ?? item.name ?? item.jp
      return out
    }, {})
  return Object.fromEntries(
    Object.entries(raw).map(([id, value]) => [
      id.replace(/^q/, ''),
      typeof value === 'object'
        ? value.name || value.api_name || value.en || value.jp || null
        : value,
    ]),
  )
}

function namesFromRecords(records, language) {
  const names = {}
  for (const record of records || []) {
    if (!record || typeof record !== 'object') continue
    const id =
      record.id ?? record.masterId ?? record.api_id ?? record.api_ship_id ?? record.api_slotitem_id
    if (id == null) continue
    const name = record.name
    names[id] =
      name && typeof name === 'object'
        ? (name[language] ?? name.en ?? name.ja_jp ?? name.jp ?? null)
        : (name ?? record.api_name ?? null)
  }
  return names
}

function questDetails(raw, language) {
  if (!raw || typeof raw !== 'object')
    return {
      code: null,
      name: null,
      desc: null,
      memo: null,
      trackingDesc: null,
      rewardConsumables: null,
      raw: raw ?? null,
    }
  return {
    code: raw.code ?? null,
    name: raw.name ?? raw[language] ?? raw.en ?? raw.ja_jp ?? null,
    desc: raw.desc ?? null,
    memo: raw.memo ?? null,
    trackingDesc: raw.trackingDesc ?? null,
    rewardConsumables: raw.rewardConsumables ?? null,
    raw,
  }
}

function normalizeRecipes(records, masterId) {
  const related = (records || []).filter((record) => {
    const id =
      record &&
      (record.masterId ?? record.equipmentMasterId ?? record.api_id ?? record.id ?? record.itemId)
    return id != null && Number(id) === Number(masterId)
  })
  const recipes = []
  for (const record of related) {
    const branches =
      record.improvement || record.improvements || record.recipes || record.remodel || []
    const list = Array.isArray(branches)
      ? branches
      : branches && typeof branches === 'object'
        ? branches.upgrade !== undefined ||
          branches.target ||
          branches.to ||
          branches.resources ||
          branches.resource ||
          branches.requirements ||
          branches.req
          ? [branches]
          : Object.values(branches)
        : []
    for (const branch of list) {
      if (!branch || typeof branch !== 'object') continue
      const target = branch.upgrade ?? branch.target ?? branch.to ?? branch.output ?? null
      const upgrade =
        target === false
          ? null
          : Array.isArray(target)
            ? { masterId: target[0] ?? null, stars: target[1] ?? null }
            : target && typeof target === 'object'
              ? {
                  masterId: target.masterId ?? target.id ?? target.equipmentMasterId ?? null,
                  stars: target.stars ?? target.level ?? null,
                }
              : target == null
                ? null
                : { masterId: target, stars: null }
      const rawRequirements =
        branch.req ||
        branch.requirements ||
        branch.requirement ||
        branch.conditions ||
        branch.secretaries ||
        []
      const requirements = (Array.isArray(rawRequirements) ? rawRequirements : [rawRequirements])
        .filter(Boolean)
        .map((req) => {
          if (Array.isArray(req) && Array.isArray(req[0])) {
            return {
              weekdays: req[0].map((on, day) => (on ? day : null)).filter((day) => day !== null),
              secretaryIds: Array.isArray(req[1]) ? req[1].map(asId) : [],
              raw: req,
            }
          }
          if (Array.isArray(req)) return { weekdays: [], secretaryIds: req.map(asId), raw: req }
          const weekdays = req.weekdays || req.weekday || []
          const secretaries = req.secretaryIds || req.secretaries || req.secretary || []
          return {
            weekdays: (Array.isArray(weekdays) ? weekdays : [weekdays])
              .filter((day) => day != null)
              .map(asId),
            secretaryIds: (Array.isArray(secretaries) ? secretaries : [secretaries])
              .filter((id) => id != null)
              .map(asId),
            raw: req,
          }
        })
      const sourceResources = branch.resource || branch.resources || branch.cost || null
      const resources = Array.isArray(sourceResources)
        ? {
            base: sourceResources[0] || [],
            stages: sourceResources.slice(1).map((stage, index) => ({
              fromStars: [0, 6, 10][index] ?? null,
              toStars: [5, 9, 10][index] ?? null,
              developmentMaterials: stage?.[0] ?? null,
              guaranteedDevelopmentMaterials: stage?.[1] ?? null,
              screws: stage?.[2] ?? null,
              guaranteedScrews: stage?.[3] ?? null,
              consumedEquipment: stage?.[4] ?? null,
              raw: stage,
            })),
            extra: sourceResources.slice(4),
          }
        : sourceResources && typeof sourceResources === 'object'
          ? {
              base: sourceResources.base || sourceResources.common || sourceResources.normal || [],
              stages:
                sourceResources.stages ||
                sourceResources.levels ||
                sourceResources.improvement ||
                [],
            }
          : { base: [], stages: [] }
      recipes.push({ upgrade, requirements, resources, raw: branch })
    }
  }
  return recipes
}

function ownedCounts(snapshot) {
  const counts = new Map()
  const instances =
    (snapshot && snapshot.data && snapshot.data.equipment && snapshot.data.equipment.instances) ||
    (snapshot && snapshot.equipment && snapshot.equipment.instances) ||
    []
  for (const item of instances) {
    const id = asId(item.masterId)
    if (id != null) counts.set(id, (counts.get(id) || 0) + 1)
  }
  return counts
}

async function loadKnowledge(extensionPath, language = 'en') {
  const root = path.resolve(String(extensionPath || '.'))
  const warnings = []
  const [akashiFile, questsMetaFile, nedbFile, shipsNedbFile, itemsFile, questsFile, shipsFile] =
    await Promise.all([
      findFile(root, 'akashi.json'),
      findFile(root, 'quests_meta.json'),
      findFile(root, 'WhoCallsTheFleet_items.nedb'),
      findFile(root, 'WhoCallsTheFleet_ships.nedb'),
      readTranslation(root, language, 'items.json'),
      readTranslation(root, language, 'quests.json'),
      readTranslation(root, language, 'ships.json'),
    ])
  if (!akashiFile) warnings.push({ code: 'missing_akashi', message: 'akashi.json was not found' })
  if (!questsMetaFile)
    warnings.push({ code: 'missing_quests_meta', message: 'quests_meta.json was not found' })
  if (!nedbFile)
    warnings.push({
      code: 'missing_improvement_database',
      message: 'WhoCallsTheFleet_items.nedb was not found',
    })
  const schedule = normalizeImprovement(akashiFile && akashiFile.value)
  const byDay = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    entries: schedule.filter((entry) => Number(entry.weekday) === weekday),
  }))
  const upgradeRecords = nedbFile ? readNedb(nedbFile.value) : []
  const shipRecords = shipsNedbFile ? readNedb(shipsNedbFile.value) : []
  const itemNames = Object.assign(
    namesFromRecords(upgradeRecords, language),
    namesFrom(itemsFile && itemsFile.value),
  )
  const questNames = namesFrom(questsFile && questsFile.value)
  const questRaw =
    questsFile && questsFile.value && typeof questsFile.value === 'object' ? questsFile.value : {}
  const secretaryNames = Object.assign(
    namesFromRecords(shipRecords, language),
    namesFrom(shipsFile && shipsFile.value),
  )
  const secretaryRecords = Object.fromEntries(
    shipRecords.map((record) => [
      String(record.id ?? record.masterId ?? record.api_id ?? record.api_ship_id),
      record,
    ]),
  )
  const metaRaw = (questsMetaFile && questsMetaFile.value) || {}
  const meta = Array.isArray(metaRaw)
    ? Object.fromEntries(metaRaw.map((q) => [String(q.id ?? q.api_id), q]))
    : metaRaw
  const questMap = new Map()
  const potential = new Map()
  for (const [rawId, raw] of Object.entries(meta || {})) {
    if (!/\d/.test(String(rawId))) continue
    const cleanId = String(rawId).replace(/^q/, '')
    const id = /^\d+$/.test(cleanId) ? asId(cleanId) : cleanId
    const q = raw && typeof raw === 'object' ? Object.assign({}, raw) : { unlock: raw }
    const mayUnlock = q.unlock || q.unlocks || q.unlockQuestIds || []
    const unlockList = Array.isArray(mayUnlock) ? mayUnlock.map(asId) : []
    const details = questDetails(
      questRaw[rawId] ?? questRaw[cleanId] ?? questRaw['q' + cleanId],
      language,
    )
    questMap.set(String(id), {
      id,
      variant: /^\d+$/.test(cleanId) ? null : cleanId,
      name: details.name ?? questNames[id] ?? questNames[String(id)] ?? questNames[cleanId] ?? null,
      details,
      mayUnlock: unlockList,
      data: q,
      potentialPrerequisites: [],
    })
    for (const target of unlockList) {
      const key = String(target)
      if (!potential.has(key)) potential.set(key, [])
      potential.get(key).push(id)
    }
  }
  for (const target of potential.keys()) {
    if (!questMap.has(target))
      questMap.set(target, {
        id: asId(target),
        variant: null,
        name: null,
        details: questDetails(null, language),
        mayUnlock: [],
        data: null,
        potentialPrerequisites: [],
        unknown: true,
      })
  }
  for (const [rawId, name] of Object.entries(questNames)) {
    if (!questMap.has(String(rawId))) {
      const details = questDetails(questRaw[rawId] ?? questRaw['q' + rawId], language)
      questMap.set(String(rawId), {
        id: asId(rawId),
        name: details.name ?? name,
        details,
        mayUnlock: [],
        data: null,
        potentialPrerequisites: potential.get(String(rawId)) || [],
      })
    }
  }
  for (const [id, quest] of questMap) quest.potentialPrerequisites = potential.get(id) || []
  const improvements = {
    schedule: byDay,
    entries: schedule,
    upgrades: upgradeRecords,
    available: !!(akashiFile || nedbFile),
    sources: {
      akashi: (akashiFile && akashiFile.path) || null,
      upgrades: (nedbFile && nedbFile.path) || null,
    },
  }
  const quests = {
    available: !!questsMetaFile,
    items: Array.from(questMap.values()),
    byId: Object.fromEntries(questMap),
    graph: Object.fromEntries(
      Array.from(questMap, ([id, quest]) => [
        id,
        { mayUnlock: quest.mayUnlock, potentialPrerequisites: quest.potentialPrerequisites },
      ]),
    ),
    source: (questsMetaFile && questsMetaFile.path) || null,
  }
  const apiProvenance = {
    akashi: (akashiFile && akashiFile.path) || null,
    questsMeta: (questsMetaFile && questsMetaFile.path) || null,
    upgrades: (nedbFile && nedbFile.path) || null,
    ships: (shipsNedbFile && shipsNedbFile.path) || null,
    language: {
      items: (itemsFile && itemsFile.path) || null,
      quests: (questsFile && questsFile.path) || null,
      ships: (shipsFile && shipsFile.path) || null,
    },
  }
  const api = {
    language,
    extensionPath: root,
    warnings,
    available: improvements.available || quests.available,
    provenance: apiProvenance,
    improvements,
    quests,
    names: { equipment: itemNames, quests: questNames },
    materials: upgradeRecords,
    queryImprovements(filters = {}) {
      if (typeof filters === 'number' || typeof filters === 'string')
        filters = { equipmentMasterId: filters }
      const wantedDay = filters.today ? jstWeekday(filters.now ?? Date.now()) : filters.weekday
      const wantedId = filters.equipmentMasterId ?? filters.masterId
      const wantedSecretary = filters.secretaryMasterId ?? filters.secretaryId
      const counts = ownedCounts(filters.snapshot)
      const snapshotSource = filters.snapshot && filters.snapshot.source
      const shipNames =
        (filters.snapshot &&
          filters.snapshot.data &&
          filters.snapshot.data.reference &&
          filters.snapshot.data.reference.shipNames) ||
        {}
      const hasSnapshot = !!(
        filters.snapshot &&
        filters.snapshot.ready !== false &&
        (snapshotSource
          ? snapshotSource.status === 'live'
          : filters.snapshot.ready === true || filters.snapshot.ready == null)
      )
      const matches = schedule.filter(
        (entry) =>
          (wantedDay == null || Number(entry.weekday) === Number(wantedDay)) &&
          (wantedId == null || Number(entry.equipmentMasterId) === Number(wantedId)) &&
          (wantedSecretary == null ||
            entry.secretaryIds.some((id) => Number(id) === Number(wantedSecretary))),
      )
      const decorate = (entry) => {
        const recipes = normalizeRecipes(upgradeRecords, entry.equipmentMasterId)
        const secretaryDetails = entry.secretaryIds.map((id) => {
          const record = secretaryRecords[String(id)] || {}
          const suffix =
            record.suffix ??
            record.affix ??
            (record.name && typeof record.name === 'object' ? record.name.suffix : null)
          const baseName = secretaryNames[id] ?? secretaryNames[String(id)] ?? null
          const liveName =
            shipNames[String(id)] && (shipNames[String(id)].name || shipNames[String(id)].api_name)
          return {
            masterId: id,
            baseName,
            suffixId: suffix,
            fullName: liveName || (suffix == null ? baseName : null),
            nameSource: liveName ? 'live_master' : baseName ? 'static_base' : null,
          }
        })
        const matchingRecipes = recipes.filter(
          (recipe) =>
            recipe.requirements.length === 0 ||
            recipe.requirements.some((req) => {
              const dayMatch =
                req.weekdays.length === 0 || req.weekdays.includes(Number(entry.weekday))
              const secretaryMatch =
                wantedSecretary == null ||
                req.secretaryIds.length === 0 ||
                req.secretaryIds.includes(Number(wantedSecretary))
              return dayMatch && secretaryMatch
            }),
        )
        return Object.assign({}, entry, {
          name:
            itemNames[entry.equipmentMasterId] ??
            itemNames[String(entry.equipmentMasterId)] ??
            null,
          secretaryNames: secretaryDetails.map((item) => item.fullName),
          secretaryDetails,
          owned: hasSnapshot ? counts.get(entry.equipmentMasterId) || 0 : null,
          recipes,
          matchingRecipes,
          materials: recipes.map((recipe) => recipe.resources),
        })
      }
      const entries = matches.map(decorate)
      const filteredSchedule = Array.from({ length: 7 }, (_, weekday) => ({
        weekday,
        entries: matches.filter((entry) => Number(entry.weekday) === weekday).map(decorate),
      }))
      return {
        available: improvements.available,
        provenance: apiProvenance,
        warnings: warnings.slice(),
        weekday: wantedDay == null ? null : Number(wantedDay),
        schedule: filteredSchedule,
        entries,
        requirements: entries.map((entry) => entry.requirements),
      }
    },
    queryQuests(filters = {}) {
      if (typeof filters === 'number' || typeof filters === 'string') filters = { id: filters }
      const ids =
        filters.id == null
          ? null
          : new Set(Array.isArray(filters.id) ? filters.id.map(String) : [String(filters.id)])
      const snapshotItems =
        (filters.snapshot &&
          filters.snapshot.data &&
          filters.snapshot.data.quests &&
          filters.snapshot.data.quests.items) ||
        []
      const observed = new Map(snapshotItems.map((q) => [String(q.id), q]))
      const items = quests.items
        .filter((quest) => !ids || ids.has(String(quest.id)))
        .map((quest) =>
          Object.assign({}, quest, quest.details || {}, {
            observed: observed.get(String(quest.id)) || null,
          }),
        )
      return {
        items,
        graph: quests.graph,
        complete: false,
        metaAvailable: !!questsMetaFile,
        available: quests.available || !!questsFile,
        provenance: apiProvenance,
        warnings: warnings.slice(),
      }
    },
  }
  return api
}

module.exports = { loadKnowledge, jstWeekday }
