const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const Module = require('node:module')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const esbuild = require('esbuild')
const AdmZip = require('adm-zip')

const source = path.join(__dirname, 'kc3updater.js')

async function loadUpdater() {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kc3updater-bundle-'))
  const output = path.join(temporaryDirectory, 'kc3updater.cjs')
  esbuild.buildSync({
    bundle: true,
    entryPoints: [source],
    external: ['isomorphic-git', 'isomorphic-git/http/node'],
    format: 'cjs',
    outfile: output,
    platform: 'node',
  })

  const originalLoad = Module._load
  Module._load = function (request, parent, isMain) {
    if (request === 'isomorphic-git')
      return { listServerRefs: async () => [{ oid: 'new-translation-oid' }] }
    if (request === 'isomorphic-git/http/node') return {}
    if (request === 'worker_threads') return { parentPort: { postMessage() {} } }
    const loaded = originalLoad.call(this, request, parent, isMain)
    if (request === 'stream/promises') return loaded
    return loaded
  }

  try {
    const updater = require(output).default
    return { updater: new updater(), temporaryDirectory }
  } finally {
    Module._load = originalLoad
  }
}

async function createReleaseFixture(root) {
  const release = path.join(root, 'kc3kai-release')
  const data = path.join(release, 'data', 'lang', 'data', 'en')
  await fs.mkdir(data, { recursive: true })
  await fs.writeFile(path.join(data, 'terms.json'), '{"available":true,"old":true}')
  await fs.writeFile(path.join(release, 'data', 'lang', '.damecon-translation-oid'), 'old-oid\n')
  return release
}

for (const [name, fetch] of [
  [
    'network failure',
    async () => {
      throw new Error('offline')
    },
  ],
  [
    'corrupt zip',
    async () => ({
      ok: true,
      headers: { get: () => '9' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('not a zip'))
          controller.close()
        },
      }),
    }),
  ],
  [
    'midstream read error',
    async () => ({
      ok: true,
      headers: { get: () => '9' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('partial'))
          controller.error(new Error('connection reset'))
        },
      }),
    }),
  ],
  [
    'valid zip',
    async () => {
      const zip = new AdmZip()
      zip.addFile(
        'kc3-translations-master/data/en/terms.json',
        Buffer.from('{"available":true,"new":true}'),
      )
      const archive = zip.toBuffer()
      return {
        ok: true,
        headers: { get: () => String(archive.length) },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(archive)
            controller.close()
          },
        }),
      }
    },
  ],
]) {
  test(
    `release translation ${name} preserves the installed data`,
    { concurrency: false },
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kc3updater-test-'))
      const previousFetch = global.fetch
      global.fetch = fetch
      const { updater, temporaryDirectory } = await loadUpdater()
      try {
        const release = await createReleaseFixture(root)
        if (name === 'valid zip') {
          await updater.updateTranslations(root, 'release')
          assert.match(
            await fs.readFile(
              path.join(release, 'data', 'lang', 'data', 'en', 'terms.json'),
              'utf8',
            ),
            /"new":true/,
          )
          assert.equal(
            await fs.readFile(
              path.join(release, 'data', 'lang', '.damecon-translation-oid'),
              'utf8',
            ),
            'new-translation-oid\n',
          )
        } else {
          await assert.rejects(updater.updateTranslations(root, 'release'))
          assert.match(
            await fs.readFile(
              path.join(release, 'data', 'lang', 'data', 'en', 'terms.json'),
              'utf8',
            ),
            /"old":true/,
          )
          assert.equal(
            await fs.readFile(
              path.join(release, 'data', 'lang', '.damecon-translation-oid'),
              'utf8',
            ),
            'old-oid\n',
          )
        }
        await assert.rejects(fs.stat(path.join(release, 'src', 'data', 'lang')))
      } finally {
        await fs.rm(root, { recursive: true, force: true })
        await fs.rm(temporaryDirectory, { recursive: true, force: true })
        global.fetch = previousFetch
      }
    },
  )
}
