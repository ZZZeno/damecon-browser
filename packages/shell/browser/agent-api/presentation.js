'use strict'

const { paginate } = require('./pagination.js')

function compactEquipment(item) {
  if (!item || typeof item !== 'object') return null
  const { raw, apiType, ...rest } = item
  return Object.assign({}, rest, { apiType: apiType || null })
}
function compactShip(ship) {
  if (!ship || typeof ship !== 'object') return ship
  return Object.assign({}, ship, {
    slots: Array.isArray(ship.slots)
      ? ship.slots.map((slot) =>
          Object.assign({}, slot, { equipment: compactEquipment(slot.equipment) }),
        )
      : [],
    extra: ship.extra
      ? Object.assign({}, ship.extra, { equipment: compactEquipment(ship.extra.equipment) })
      : ship.extra,
  })
}
function compactFleets(data) {
  return Object.assign({}, data, {
    fleets: Array.isArray(data?.fleets)
      ? data.fleets.map((fleet) =>
          Object.assign({}, fleet, {
            deckParams: undefined,
            ships: Array.isArray(fleet.ships) ? fleet.ships.map(compactShip) : [],
          }),
        )
      : [],
  })
}
function compactLandBases(data) {
  return Array.isArray(data)
    ? data.map((base) =>
        Object.assign({}, base, {
          planes: Array.isArray(base?.planes)
            ? base.planes.map((plane) =>
                Object.assign({}, plane, { equipment: compactEquipment(plane.equipment) }),
              )
            : [],
        }),
      )
    : []
}
function compactRequirement(requirement) {
  if (!requirement || typeof requirement !== 'object') return requirement
  const { raw, ...rest } = requirement
  return rest
}
function compactResourceStage(stage) {
  if (!stage || typeof stage !== 'object') return stage
  const { raw, consumedEquipment, ...rest } = stage
  return rest
}
function compactRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return recipe
  const { raw, ...rest } = recipe
  return Object.assign({}, rest, {
    upgrade: recipe.upgrade ? Object.assign({}, recipe.upgrade) : recipe.upgrade,
    requirements: Array.isArray(recipe.requirements)
      ? recipe.requirements.map(compactRequirement)
      : [],
    resources:
      recipe.resources && typeof recipe.resources === 'object'
        ? Object.assign({}, recipe.resources, {
            stages: Array.isArray(recipe.resources.stages)
              ? recipe.resources.stages.map(compactResourceStage)
              : recipe.resources.stages,
          })
        : recipe.resources,
  })
}
function compactImprovement(entry) {
  if (!entry || typeof entry !== 'object') return entry
  const { raw, data, source, matchingRecipes, materials, ...rest } = entry
  return Object.assign({}, rest, {
    recipes: Array.isArray(entry.recipes) ? entry.recipes.map(compactRecipe) : [],
  })
}
function compactCurrentQuest(item) {
  if (!item || typeof item !== 'object') return item
  const { raw, meta, ...rest } = item
  return Object.assign({}, rest, {
    meta: meta
      ? {
          name: meta.name ?? null,
          code: meta.code ?? null,
          desc: meta.desc ?? null,
          memo: meta.memo ?? null,
          trackingDesc: meta.trackingDesc ?? null,
        }
      : meta,
  })
}
function compactKnowledgeQuest(item) {
  if (!item || typeof item !== 'object') return item
  const { details, data, variant, unknown, raw, ...rest } = item
  return rest
}
function queryMatches(query, fields) {
  if (!query) return true
  const needle = String(query).toLowerCase()
  return fields.some((field) => field != null && String(field).toLowerCase().includes(needle))
}
function envelopeWithData(envelope, data, hints) {
  const result = Object.assign({}, envelope, { data })
  if (hints) {
    result.responseFormat = hints.responseFormat || 'concise'
    result.hints = hints
    if (Array.isArray(hints.omittedFields) && hints.omittedFields.length)
      result.omittedFields = hints.omittedFields
  }
  return result
}
function detailedEnvelope(envelope) {
  return Object.assign({}, envelope, { responseFormat: 'detailed' })
}

function presentSnapshot(envelope, detailed) {
  if (detailed) return detailedEnvelope(envelope)
  const data = envelope.data || {}
  return envelopeWithData(
    envelope,
    {
      player: data.player || null,
      fleets: compactFleets(data.fleets || {}),
      landBases: compactLandBases(data.landBases || []),
      equipment: {
        total: data.equipment?.total || 0,
        categories: Array.isArray(data.equipment?.categories)
          ? data.equipment.categories.map(({ id, name, count }) => ({ id, name, count }))
          : [],
      },
      quests: data.quests
        ? {
            observed: data.quests.observed ?? null,
            completeness: data.quests.completeness ?? null,
            total: Array.isArray(data.quests.items) ? data.quests.items.length : 0,
            currentAvailable: data.quests.currentAvailable || [],
            accepted: data.quests.accepted || [],
            currentAvailableDetails: data.quests.currentAvailableDetails || [],
            acceptedDetails: data.quests.acceptedDetails || [],
          }
        : null,
    },
    {
      responseFormat: 'concise',
      listTools: ['damecon_get_equipment', 'damecon_get_improvements', 'damecon_get_quests'],
      pagination: 'Use the specialized list tool with limit/cursor to retrieve complete lists.',
      omittedFields: [
        'data.reference',
        'data.equipment.instances',
        'data.equipment.categories.items',
        'data.quests.items',
      ],
    },
  )
}

function presentFleets(envelope, detailed) {
  if (detailed) return detailedEnvelope(envelope)
  return envelopeWithData(envelope, compactFleets(envelope.data || {}), {
    responseFormat: 'concise',
  })
}
function presentLandBases(envelope, detailed) {
  if (detailed) return detailedEnvelope(envelope)
  return envelopeWithData(envelope, compactLandBases(envelope.data || []), {
    responseFormat: 'concise',
  })
}
function presentEquipment(envelope, args, detailed) {
  const data = envelope.data || {}
  if (detailed && args.limit === undefined && args.cursor === undefined && args.query === undefined)
    return detailedEnvelope(envelope)
  const all = Array.isArray(data.instances) ? data.instances : []
  const query = args.query
  const filtered = query
    ? all.filter((item) => queryMatches(query, [item?.name, item?.masterId, item?.type]))
    : all
  const presented = detailed ? filtered : filtered.map(compactEquipment)
  const page = paginate(presented, {
    resource: 'equipment',
    filters: {
      category: args.category,
      masterId: args.masterId,
      query,
      responseFormat: detailed ? 'detailed' : 'concise',
    },
    detailed,
    limit: args.limit,
    cursor: args.cursor,
  })
  const categories = Array.isArray(data.categories)
    ? data.categories
        .map(({ id, name }) => ({
          id,
          name,
          count: filtered.filter((item) => String(item.type) === String(id)).length,
        }))
        .filter((entry) => entry.count > 0 || (!args.category && !args.masterId && !args.query))
    : []
  const omittedFields = []
  if (
    Array.isArray(data.categories) &&
    data.categories.some(
      (category) => category && typeof category === 'object' && 'items' in category,
    )
  )
    omittedFields.push('data.categories[].items')
  if (!detailed && filtered.some((item) => item && typeof item === 'object' && 'raw' in item))
    omittedFields.push('data.instances[].raw')
  const next = Object.assign({}, data, {
    categories,
    instances: page.items,
    total: filtered.length,
  })
  if (page.paginated) next.pagination = page.pagination
  return envelopeWithData(envelope, next, {
    responseFormat: detailed ? 'detailed' : 'concise',
    omittedFields,
  })
}
function presentImprovements(envelope, args, detailed) {
  if (detailed && args.limit === undefined && args.cursor === undefined && args.query === undefined)
    return detailedEnvelope(envelope)
  const data = envelope.data || {}
  const all = Array.isArray(data.entries) ? data.entries : []
  const query = args.query
  const filtered = query
    ? all.filter((entry) =>
        queryMatches(query, [
          entry?.name,
          ...(Array.isArray(entry?.recipes)
            ? entry.recipes.map((recipe) => recipe?.upgrade?.name)
            : []),
        ]),
      )
    : all
  const presented = detailed ? filtered : filtered.map(compactImprovement)
  const page = paginate(presented, {
    resource: 'improvements',
    filters: {
      day: args.day,
      equipmentId: args.equipmentId,
      secretaryId: args.secretaryId,
      query,
      responseFormat: detailed ? 'detailed' : 'concise',
    },
    detailed,
    limit: args.limit,
    cursor: args.cursor,
  })
  const entries = page.items
  const next = Object.assign({}, data, { entries })
  const omittedFields = []
  if (!detailed || page.paginated || args.query !== undefined) {
    delete next.schedule
    delete next.requirements
    if (data && typeof data === 'object' && 'schedule' in data) omittedFields.push('data.schedule')
    if (data && typeof data === 'object' && 'requirements' in data)
      omittedFields.push('data.requirements')
  }
  if (page.paginated) next.pagination = page.pagination
  return envelopeWithData(envelope, next, {
    responseFormat: detailed ? 'detailed' : 'concise',
    omittedFields: omittedFields.concat(
      detailed
        ? []
        : [
            ...(all.some(
              (entry) => entry && typeof entry === 'object' && 'matchingRecipes' in entry,
            )
              ? ['data.entries[].matchingRecipes']
              : []),
            ...(all.some((entry) => entry && typeof entry === 'object' && 'materials' in entry)
              ? ['data.entries[].materials']
              : []),
            ...(all.some((entry) => entry && typeof entry === 'object' && 'raw' in entry)
              ? ['data.entries[].raw']
              : []),
            ...(all.some((entry) => entry && typeof entry === 'object' && 'data' in entry)
              ? ['data.entries[].data']
              : []),
            ...(all.some((entry) => entry && typeof entry === 'object' && 'source' in entry)
              ? ['data.entries[].source']
              : []),
            ...(all.some(
              (entry) =>
                Array.isArray(entry?.recipes) &&
                entry.recipes.some(
                  (recipe) => recipe && typeof recipe === 'object' && 'raw' in recipe,
                ),
            )
              ? ['data.entries[].recipes[].raw']
              : []),
            ...(all.some(
              (entry) =>
                Array.isArray(entry?.recipes) &&
                entry.recipes.some(
                  (recipe) =>
                    Array.isArray(recipe?.requirements) &&
                    recipe.requirements.some(
                      (requirement) =>
                        requirement && typeof requirement === 'object' && 'raw' in requirement,
                    ),
                ),
            )
              ? ['data.entries[].recipes[].requirements[].raw']
              : []),
            ...(all.some(
              (entry) =>
                Array.isArray(entry?.recipes) &&
                entry.recipes.some(
                  (recipe) =>
                    Array.isArray(recipe?.resources?.stages) &&
                    recipe.resources.stages.some(
                      (stage) => stage && typeof stage === 'object' && 'raw' in stage,
                    ),
                ),
            )
              ? ['data.entries[].recipes[].resources.stages[].raw']
              : []),
            ...(all.some(
              (entry) =>
                Array.isArray(entry?.recipes) &&
                entry.recipes.some(
                  (recipe) =>
                    Array.isArray(recipe?.resources?.stages) &&
                    recipe.resources.stages.some(
                      (stage) => stage && typeof stage === 'object' && 'consumedEquipment' in stage,
                    ),
                ),
            )
              ? ['data.entries[].recipes[].resources.stages[].consumedEquipment']
              : []),
          ],
    ),
  })
}
function presentQuests(envelope, args, detailed) {
  if (detailed && args.limit === undefined && args.cursor === undefined && args.query === undefined)
    return detailedEnvelope(envelope)
  const data = envelope.data || {}
  const all = Array.isArray(data.items) ? data.items : []
  const query = args.query
  const filtered = query
    ? all.filter((item) => queryMatches(query, [item?.name, item?.meta?.name, item?.id]))
    : all
  const presented = detailed
    ? filtered
    : filtered.map(args.mode === 'knowledge' ? compactKnowledgeQuest : compactCurrentQuest)
  const page = paginate(presented, {
    resource: 'quests',
    filters: {
      mode: args.mode,
      id: args.id,
      query,
      responseFormat: detailed ? 'detailed' : 'concise',
    },
    detailed,
    limit: args.limit,
    cursor: args.cursor,
  })
  const entries = page.items
  const next = Object.assign({}, data, { items: entries })
  const omittedFields = []
  if (!detailed || page.paginated || args.query !== undefined) {
    delete next.history
    delete next.graph
    if (data && typeof data === 'object' && 'history' in data) omittedFields.push('data.history')
    if (data && typeof data === 'object' && 'graph' in data) omittedFields.push('data.graph')
  }
  if (page.paginated) next.pagination = page.pagination
  return envelopeWithData(envelope, next, {
    responseFormat: detailed ? 'detailed' : 'concise',
    omittedFields: omittedFields.concat(
      detailed || !all.some((item) => item && typeof item === 'object' && 'raw' in item)
        ? []
        : ['data.items[].raw'],
    ),
  })
}

module.exports = {
  compactEquipment,
  compactFleets,
  compactLandBases,
  compactImprovement,
  compactKnowledgeQuest,
  compactCurrentQuest,
  presentSnapshot,
  presentFleets,
  presentLandBases,
  presentEquipment,
  presentImprovements,
  presentQuests,
}
