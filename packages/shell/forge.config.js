const path = require('path')
const fs = require('fs/promises')

const PACKAGED_RESOURCE_EXCLUDES = new Set(['.git', '.DS_Store', '__MACOSX'])
const KC3_RELEASE_DIRECTORY = 'kc3kai-release'
const KC3_REQUIRED_FILES = ['manifest.json', 'data/lang/data/en/terms.json']

function shouldCopyPackagedResource(sourcePath) {
  return !PACKAGED_RESOURCE_EXCLUDES.has(path.basename(sourcePath))
}

async function isDirectory(directory) {
  try {
    return (await fs.stat(directory)).isDirectory()
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function requireFiles(directory, files, description) {
  for (const file of files) {
    const filePath = path.join(directory, file)
    try {
      if (!(await fs.stat(filePath)).isFile()) {
        throw new Error(`${filePath} is not a file`)
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Missing ${description}: ${filePath}`)
      }
      throw error
    }
  }
}

async function getKc3ReleaseSource(extensionsDirectory) {
  const releaseDirectory = path.join(extensionsDirectory, KC3_RELEASE_DIRECTORY)
  const candidates = [releaseDirectory, path.join(releaseDirectory, 'src')]

  for (const candidate of candidates) {
    if (!(await isDirectory(candidate))) continue
    try {
      await requireFiles(candidate, KC3_REQUIRED_FILES, 'KC3Kai release file')
      return candidate
    } catch (error) {
      if (candidate === candidates[candidates.length - 1]) throw error
    }
  }

  throw new Error(
    `Missing KC3Kai release directory. Expected ${releaseDirectory} or its src directory.`,
  )
}

async function listCopiedFiles(directory, relativeDirectory = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (PACKAGED_RESOURCE_EXCLUDES.has(entry.name)) continue
    const relativePath = path.join(relativeDirectory, entry.name)
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listCopiedFiles(entryPath, relativePath)))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }

  return files
}

async function verifyCopiedTree(source, destination, description) {
  const files = await listCopiedFiles(source)
  for (const relativePath of files) {
    const [sourceStat, destinationStat] = await Promise.all([
      fs.stat(path.join(source, relativePath)),
      fs.stat(path.join(destination, relativePath)),
    ])
    if (!destinationStat.isFile() || sourceStat.size !== destinationStat.size) {
      throw new Error(`Failed to copy ${description}: ${relativePath}`)
    }
  }
}

async function getMacResourcesDirectory(outputPath, appName) {
  const namedApp = path.join(outputPath, `${appName}.app`)
  if (await isDirectory(namedApp)) return path.join(namedApp, 'Contents', 'Resources')
  if (outputPath.endsWith('.app') && (await isDirectory(outputPath))) {
    return path.join(outputPath, 'Contents', 'Resources')
  }

  const appBundles = (await fs.readdir(outputPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
    .map((entry) => entry.name)
  if (appBundles.length === 1) {
    return path.join(outputPath, appBundles[0], 'Contents', 'Resources')
  }

  throw new Error(`Unable to locate the packaged macOS app in ${outputPath}`)
}

async function copyDirectory(source, destination, description) {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.cp(source, destination, {
    recursive: true,
    force: true,
    filter: shouldCopyPackagedResource,
  })
  await verifyCopiedTree(source, destination, description)
}

module.exports = {
  packagerConfig: {
    name: 'damecon-browser',
    asar: true,
    extraResource: ['browser/ui'],
    icon: 'icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32', 'linux'],
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
    },
    {
      name: '@electron-forge/maker-squirrel',
      platforms: ['win32'],
      config: (arch) => ({
        remoteReleases: `https://tsunkit.net/damecon-browser/updates/win32/${arch}`,
        setupIcon: 'icon.ico',
        authors: 'TsunKit',
      }),
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-webpack',
      config: {
        mainConfig: './webpack.main.config.js',
        renderer: {
          config: './webpack.renderer.config.js',
          entryPoints: [
            {
              name: 'browser',
              preload: {
                js: './preload.ts',
              },
            },
          ],
        },
        devServer: {
          client: {
            overlay: false,
          },
        },
      },
    },
  ].filter(Boolean),
  hooks: {
    postPackage: async (config, options) => {
      const extensionsDirectory = path.join(__dirname, '../../extensions')
      const minCacheSource = path.join(__dirname, '../../packages/kccacheproxy/minimum-cache.zip')
      await requireFiles(
        path.dirname(minCacheSource),
        [path.basename(minCacheSource)],
        'minimum cache archive (run packages/kccacheproxy/build.bat to generate it)',
      )

      const extensionDirectories = (await fs.readdir(extensionsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
      const nonKc3Extensions = extensionDirectories.filter(
        (directory) => !directory.toLowerCase().startsWith('kc3kai'),
      )
      const isMac = options.platform === 'darwin'
      const kc3ReleaseSource = isMac ? await getKc3ReleaseSource(extensionsDirectory) : undefined

      for (const outputPath of options.outputPaths) {
        const resourcesDirectory = isMac
          ? await getMacResourcesDirectory(outputPath, config.packagerConfig.name)
          : path.join(outputPath, 'resources')
        const extensionsDestination = isMac
          ? path.join(resourcesDirectory, 'extensions')
          : path.join(outputPath, 'extensions')

        await fs.mkdir(resourcesDirectory, { recursive: true })
        await fs.mkdir(extensionsDestination, { recursive: true })

        for (const extensionDirectory of nonKc3Extensions) {
          await copyDirectory(
            path.join(extensionsDirectory, extensionDirectory),
            path.join(extensionsDestination, extensionDirectory),
            `extension ${extensionDirectory}`,
          )
        }

        if (isMac) {
          const kc3Destination = path.join(extensionsDestination, KC3_RELEASE_DIRECTORY)
          await copyDirectory(kc3ReleaseSource, kc3Destination, 'KC3Kai release')
          await requireFiles(kc3Destination, KC3_REQUIRED_FILES, 'packaged KC3Kai release file')
        }

        const minCacheDestination = path.join(resourcesDirectory, 'minimum-cache.zip')
        await fs.copyFile(minCacheSource, minCacheDestination)
        await requireFiles(
          resourcesDirectory,
          ['minimum-cache.zip'],
          'packaged minimum cache archive',
        )
      }
    },
  },
}
