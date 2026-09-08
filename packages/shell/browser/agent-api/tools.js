'use strict'

const annotations = { readOnlyHint: true, destructiveHint: false }
const noArguments = { type: 'object', properties: {}, required: [], additionalProperties: false }
const positiveInteger = { type: 'integer', minimum: 1 }

const tools = [
  {
    name: 'damecon_get_snapshot',
    description:
      '读取当前 KC3 已观察到的完整只读快照；需要同时查看提督、舰队、陆航、装备和任务时使用。',
    inputSchema: noArguments,
    method: 'getSnapshot',
  },
  {
    name: 'damecon_get_fleets',
    description: '读取当前舰队、联合舰队、远征、舰船槽位以及制空、索敌和运输指标。',
    inputSchema: noArguments,
    method: 'getFleets',
  },
  {
    name: 'damecon_get_land_bases',
    description: '读取当前基地航空队、中队、航程及出击和防空制空指标。',
    inputSchema: noArguments,
    method: 'getLandBases',
  },
  {
    name: 'damecon_get_equipment',
    description: '按 KC3 装备类别或装备图鉴 ID 读取当前持有装备实例、改修和所在位置。',
    inputSchema: {
      type: 'object',
      properties: {
        category: Object.assign({}, positiveInteger, { description: 'KC3 api_type[2] 装备类别' }),
        masterId: Object.assign({}, positiveInteger, { description: '装备图鉴 master ID' }),
      },
      required: [],
      additionalProperties: false,
    },
    method: 'getEquipment',
  },
  {
    name: 'damecon_get_improvements',
    description: '读取静态改修计划、秘书舰条件和材料；可按今天或星期、装备和秘书舰筛选。',
    inputSchema: {
      type: 'object',
      properties: {
        day: {
          type: 'string',
          enum: ['today', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
          description: '按日本时间的今天或星期',
        },
        equipmentId: Object.assign({}, positiveInteger, { description: '装备图鉴 master ID' }),
        secretaryId: Object.assign({}, positiveInteger, { description: '秘书舰图鉴 master ID' }),
      },
      required: [],
      additionalProperties: false,
    },
    method: 'getImprovements',
  },
  {
    name: 'damecon_get_quests',
    description: '读取当前已观察任务，或用 mode=knowledge 读取静态任务图和可能的解锁关系。',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['current', 'knowledge'],
          description: 'current 为已观察任务，knowledge 为静态任务图',
        },
        id: {
          oneOf: [
            Object.assign({}, positiveInteger, { description: '任务 ID' }),
            { type: 'array', items: positiveInteger, minItems: 1 },
          ],
          description: '任务 ID 或非空任务 ID 数组',
        },
      },
      required: [],
      additionalProperties: false,
    },
    method: 'getQuests',
  },
  {
    name: 'damecon_get_schema',
    description: '读取 Agent API 的 schema、返回 envelope 和 source 状态说明。',
    inputSchema: noArguments,
    method: 'getSchema',
  },
  {
    name: 'damecon_health',
    description: '检查当前 KC3 source 是否可读，并返回最近一次读取的状态和 warnings。',
    inputSchema: noArguments,
    method: 'health',
  },
].map((tool) => Object.freeze(Object.assign({}, tool, { annotations })))

const toolMap = new Map(tools.map((tool) => [tool.name, tool]))

function publicTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  }
}

function listTools() {
  return tools.map(publicTool)
}

function isPositiveInteger(value) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function validateArguments(toolName, args) {
  const tool = toolMap.get(toolName)
  if (!tool) throw new Error(`unknown agent tool: ${toolName}`)
  if (!args || typeof args !== 'object' || Array.isArray(args))
    throw new Error('tool arguments must be an object')
  const allowed = new Set(Object.keys(tool.inputSchema.properties || {}))
  for (const key of Object.keys(args))
    if (!allowed.has(key)) throw new Error(`unknown argument for ${toolName}: ${key}`)
  const has = (key) => Object.prototype.hasOwnProperty.call(args, key)
  if (toolName === 'damecon_get_equipment') {
    if (has('category') && !isPositiveInteger(args.category))
      throw new Error('category must be a positive integer')
    if (has('masterId') && !isPositiveInteger(args.masterId))
      throw new Error('masterId must be a positive integer')
  }
  if (toolName === 'damecon_get_improvements') {
    if (has('day') && !tool.inputSchema.properties.day.enum.includes(args.day))
      throw new Error('day is invalid')
    for (const key of ['equipmentId', 'secretaryId'])
      if (has(key) && !isPositiveInteger(args[key]))
        throw new Error(`${key} must be a positive integer`)
  }
  if (toolName === 'damecon_get_quests') {
    if (has('mode') && !tool.inputSchema.properties.mode.enum.includes(args.mode))
      throw new Error('mode is invalid')
    if (
      has('id') &&
      !(
        (Array.isArray(args.id) && args.id.length > 0 && args.id.every(isPositiveInteger)) ||
        isPositiveInteger(args.id)
      )
    )
      throw new Error('id must be a positive integer or non-empty integer array')
  }
  return args
}

function getTool(name) {
  return toolMap.get(name) || null
}

module.exports = { tools, listTools, getTool, validateArguments, publicTool }
