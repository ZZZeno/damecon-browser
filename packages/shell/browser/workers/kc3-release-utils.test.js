const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const {
  replaceDirectoryAtomically,
  validateReleaseDirectory,
  validateTranslationsDataDirectory,
} = require('./kc3-release-utils.js')

test('failed release validation leaves the installed release untouched', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kc3-release-test-'))
  const installed = path.join(root, 'installed')
  const invalid = path.join(root, 'invalid')
  await fs.mkdir(installed)
  await fs.writeFile(path.join(installed, 'manifest.json'), 'old')
  await fs.mkdir(invalid)
  await assert.rejects(validateReleaseDirectory(invalid))
  assert.equal(await fs.readFile(path.join(installed, 'manifest.json'), 'utf8'), 'old')
  await fs.rm(root, { recursive: true, force: true })
})

test('translation validation requires an available English terms file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kc3-translation-test-'))
  await fs.mkdir(path.join(root, 'en'), { recursive: true })
  await fs.writeFile(path.join(root, 'en', 'terms.json'), '{"available":false}')
  await assert.rejects(validateTranslationsDataDirectory(root))
  await fs.writeFile(path.join(root, 'en', 'terms.json'), '{"available":true}')
  await validateTranslationsDataDirectory(root)
  await fs.rm(root, { recursive: true, force: true })
})

test('directory replacement keeps the new complete tree', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kc3-atomic-test-'))
  const source = path.join(root, 'source')
  const destination = path.join(root, 'destination')
  await fs.mkdir(source)
  await fs.mkdir(destination)
  await fs.writeFile(path.join(source, 'marker'), 'new')
  await fs.writeFile(path.join(destination, 'marker'), 'old')
  await replaceDirectoryAtomically(source, destination)
  assert.equal(await fs.readFile(path.join(destination, 'marker'), 'utf8'), 'new')
  await fs.rm(root, { recursive: true, force: true })
})

test('failed replacement restores the previous directory', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kc3-rollback-test-'))
  const destination = path.join(root, 'destination')
  await fs.mkdir(destination)
  await fs.writeFile(path.join(destination, 'marker'), 'old')
  await assert.rejects(replaceDirectoryAtomically(path.join(root, 'missing'), destination))
  assert.equal(await fs.readFile(path.join(destination, 'marker'), 'utf8'), 'old')
  await fs.rm(root, { recursive: true, force: true })
})
