const path = require('path')
const fs = require('fs/promises')

const RELEASE_REQUIRED_FILES = ['manifest.json', 'data/lang/data/en/terms.json']

async function requireFile(filePath, description) {
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Missing ${description}: ${filePath}`)
    throw error
  }
  if (!stat.isFile()) throw new Error(`${description} is not a file: ${filePath}`)
}

async function validateJsonFile(filePath, description) {
  await requireFile(filePath, description)
  try {
    JSON.parse((await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, ''))
  } catch (error) {
    throw new Error(`Invalid ${description}: ${filePath}`, { cause: error })
  }
}

async function validateReleaseDirectory(directory) {
  for (const file of RELEASE_REQUIRED_FILES) {
    const filePath = path.join(directory, file)
    if (file.endsWith('.json')) await validateJsonFile(filePath, 'KC3Kai release file')
    else await requireFile(filePath, 'KC3Kai release file')
  }
  return true
}

async function validateTranslationsDataDirectory(directory) {
  const termsPath = path.join(directory, 'en', 'terms.json')
  await validateJsonFile(termsPath, 'English translation data')
  const terms = JSON.parse(await fs.readFile(termsPath, 'utf8'))
  if (terms.available !== true)
    throw new Error(`English translation data is unavailable: ${termsPath}`)

  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) await validateTranslationsDataDirectoryFiles(entryPath)
  }
  return true
}

async function validateTranslationsDataDirectoryFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) await validateTranslationsDataDirectoryFiles(entryPath)
    else if (entry.isFile() && entry.name.endsWith('.json'))
      await validateJsonFile(entryPath, 'translation JSON')
  }
}

async function findTranslationsDataDirectory(directory) {
  const directDataDirectory = path.join(directory, 'data')
  try {
    await validateTranslationsDataDirectory(directDataDirectory)
    return directDataDirectory
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') throw error
  }

  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dataDirectory = path.join(directory, entry.name, 'data')
    try {
      await validateTranslationsDataDirectory(dataDirectory)
      return dataDirectory
    } catch (error) {
      if (error.code && error.code !== 'ENOENT') throw error
    }
  }
  throw new Error(`Unable to find valid translation data in ${directory}`)
}

async function createSiblingTemporaryDirectory(destination, label = 'download') {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  return fs.mkdtemp(
    path.join(path.dirname(destination), `.${path.basename(destination)}-${label}-`),
  )
}

async function replaceDirectoryAtomically(source, destination) {
  const parent = path.dirname(destination)
  const backup = path.join(parent, `.${path.basename(destination)}-backup`)
  let movedPrevious = false

  await fs.mkdir(parent, { recursive: true })
  try {
    await fs.access(destination)
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        await fs.rename(backup, destination)
      } catch (restoreError) {
        if (restoreError.code !== 'ENOENT') throw restoreError
      }
    } else {
      throw error
    }
  }
  try {
    await fs.rename(destination, backup)
    movedPrevious = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  try {
    await fs.rename(source, destination)
  } catch (error) {
    if (movedPrevious) await fs.rename(backup, destination)
    throw error
  }

  if (movedPrevious) await fs.rm(backup, { recursive: true, force: true })
}

module.exports = {
  RELEASE_REQUIRED_FILES,
  createSiblingTemporaryDirectory,
  findTranslationsDataDirectory,
  replaceDirectoryAtomically,
  validateReleaseDirectory,
  validateTranslationsDataDirectory,
}
