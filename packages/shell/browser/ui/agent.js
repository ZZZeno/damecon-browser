'use strict'

const output = document.getElementById('output')
const status = document.getElementById('status')

for (const button of document.querySelectorAll('[data-operation]')) {
  button.addEventListener('click', async () => {
    const operation = button.dataset.operation
    status.textContent = `Reading ${operation}…`
    try {
      const api = window.dameconAgent
      if (!api) throw new Error('window.dameconAgent is unavailable on this page')
      const result =
        operation === 'tools'
          ? await api.listTools()
          : await (
              operation === 'health'
                ? api.health
                : api[`get${operation[0].toUpperCase()}${operation.slice(1)}`]
            )()
      status.textContent =
        result && result.source
          ? `source: ${result.source.status}, revision: ${result.revision}`
          : 'OK'
      output.textContent = JSON.stringify(result, null, 2)
    } catch (error) {
      status.textContent = 'Read failed'
      output.textContent = String((error && error.stack) || error)
    }
  })
}
