const BASE = { 'X-Requested-With': 'yaml-editor' }

async function call(method, url, body) {
  if (window.go?.main?.App) {
    const { unwrap } = await import('./desktop.js')
    return unwrap(await window.go.main.App.Request(window.yamlWorkspace?.id || '', method, url, JSON.stringify(body ?? {})))
  }
  const res = await fetch(url, {
    method,
    headers: body ? { ...BASE, 'Content-Type': 'application/json' } : BASE,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok) {
    const err = new Error(data?.message || res.statusText || 'Error de red')
    err.status = res.status
    err.code = data?.error
    err.data = data
    throw err
  }
  return data
}

const q = (p) => encodeURIComponent(p)

export const api = {
  files: () => call('GET', '/api/files'),
  file: (path) => call('GET', `/api/file?path=${q(path)}`),
  preview: (body) => call('POST', '/api/preview', body),
  save: (body) => call('PUT', '/api/file', body),
  history: (path) => call('GET', `/api/history?path=${q(path)}`),
  restore: (body) => call('POST', '/api/restore', body),
}
