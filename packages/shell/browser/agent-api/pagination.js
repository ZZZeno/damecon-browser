'use strict'

const crypto = require('node:crypto')

const DEFAULT_LIMITS = Object.freeze({ equipment: 50, improvements: 20, quests: 50 })
const MAX_LIMIT = 100

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('base64url')
}

function encodeCursor(value) {
  return Buffer.from(JSON.stringify(Object.assign({ version: 1 }, value)), 'utf8').toString('base64url')
}

function decodeCursor(cursor, expected) {
  if (typeof cursor !== 'string' || !cursor || cursor.length > 1000 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new Error('cursor is malformed')
  let value
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    throw new Error('cursor is malformed')
  }
  if (!value || value.version !== 1 || !Number.isInteger(value.offset) || value.offset < 0)
    throw new Error('cursor is malformed')
  if (value.resource !== expected.resource || value.filterDigest !== expected.filterDigest)
    throw new Error('cursor does not match the current query; restart pagination with the same filters')
  if (value.dataDigest !== expected.dataDigest)
    throw new Error('cursor data is stale; restart pagination from the first page')
  return value.offset
}

function paginate(items, options = {}) {
  const list = Array.isArray(items) ? items : []
  const resource = String(options.resource || '')
  const filters = options.filters || {}
  const hasPaging = options.limit !== undefined || options.cursor !== undefined
  const detailed = options.detailed === true
  if (detailed && !hasPaging) return { items: list, paginated: false }
  const filterDigest = digest({ resource, filters })
  const dataDigest = digest(list)
  const expected = { resource, filterDigest, dataDigest }
  const limit = options.limit === undefined
    ? (DEFAULT_LIMITS[resource] || 50)
    : options.limit
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
    throw new Error('limit must be an integer from 1 to 100')
  const offset = options.cursor === undefined
    ? 0
    : decodeCursor(options.cursor, expected)
  if (offset > list.length) throw new Error('cursor offset is outside the current result')
  const page = list.slice(offset, offset + limit)
  const nextOffset = offset + page.length
  return {
    items: page,
    paginated: true,
    pagination: {
      total: list.length,
      returned: page.length,
      nextCursor: nextOffset < list.length
        ? encodeCursor({ ...expected, offset: nextOffset })
        : null,
    },
  }
}

module.exports = { DEFAULT_LIMITS, MAX_LIMIT, digest, encodeCursor, decodeCursor, paginate }
