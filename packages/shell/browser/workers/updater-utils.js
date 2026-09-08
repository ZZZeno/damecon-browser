import { parentPort } from 'worker_threads'
import { Readable } from 'stream'

const onUpdateStarted = function (name) {
  parentPort.postMessage({ type: 'update-process-started', data: { name } })
}
const onUpdateProgress = function (name, phase, current, total, type) {
  parentPort.postMessage({
    type: 'update-process-progress',
    data: { name, phase, current, total, type },
  })
}
const onUpdateCompleted = function (name, result = {}) {
  parentPort.postMessage({ type: 'update-process-completed', data: { name, ...result } })
}

const fetchWithProgress = async function (url, onProgress) {
  const signal = AbortSignal.timeout(30000)
  const res = await fetch(url, { signal })

  if (!res.ok) {
    const error = new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
    error.status = res.status
    throw error
  }

  const totalSize = Number(res.headers.get('content-length')) || 0

  let downloaded = 0

  const readable = Readable.fromWeb(res.body)
  readable.on('data', (chunk) => {
    downloaded += chunk.length
    if (totalSize) {
      const pct = ((downloaded / totalSize) * 100).toFixed(2)
      onProgress(downloaded, totalSize, pct)
    } else {
      onProgress(downloaded, 0, null)
    }
  })

  return readable
}

export { onUpdateStarted, onUpdateProgress, onUpdateCompleted, fetchWithProgress }
