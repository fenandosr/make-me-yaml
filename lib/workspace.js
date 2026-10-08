import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadSettings } from './config.js'
import { createService } from './documents.js'
import { HttpError } from './util.js'

/** Selección explícita de raíz para escritorio. Inspeccionar nunca cambia la sesión activa. */
export function inspectWorkspace({ directory, mode = 'auto', manifestName = 'editor.manifest.yaml' } = {}) {
  if (typeof directory !== 'string' || !directory.trim() || !path.isAbsolute(directory)) throw new HttpError(400, 'BAD_DIRECTORY', 'Elige una carpeta o escribe su ruta absoluta.')
  if (!['auto', 'discover', 'manifest'].includes(mode)) throw new HttpError(400, 'BAD_MODE', 'Modo de apertura desconocido.')
  if (typeof manifestName !== 'string' || !manifestName || manifestName !== path.basename(manifestName) || /[/\\\0]/.test(manifestName) || !/\.ya?ml$/i.test(manifestName)) throw new HttpError(400, 'BAD_MANIFEST', 'El manifiesto debe ser un archivo YAML dentro de la carpeta elegida.')
  let root
  try {
    root = fs.realpathSync(directory)
    if (!fs.statSync(root).isDirectory()) throw new Error('No es una carpeta.')
    fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK)
    fs.readdirSync(root)
  } catch (e) {
    throw new HttpError(400, 'BAD_DIRECTORY', `No se puede abrir la carpeta: ${e.message}`)
  }
  const settings = { ...loadSettings({ YAML_ROOT: root }), strictManifest: true, manifestMode: mode, manifestName }
  const service = createService(settings)
  const listing = service.listFiles()
  const manifestFound = mode !== 'discover' && fs.existsSync(path.join(root, manifestName))
  return {
    service,
    info: {
      directory: root, mode, manifestName,
      source: manifestFound ? 'manifest' : 'discovery',
      count: listing.files.length,
      invalid: listing.files.filter((file) => ['invalid', 'parse_error', 'schema_error', 'error'].includes(file.status)).length,
    },
  }
}

export function createWorkspaceManager() {
  let active = null
  return {
    inspect: (selection) => inspectWorkspace(selection).info,
    open(selection) {
      const candidate = inspectWorkspace(selection)
      active = { ...candidate, id: randomUUID() }
      return { ...candidate.info, id: active.id }
    },
    async request({ workspaceId, method, url, body = {} }) {
      if (!active) throw new HttpError(409, 'NO_WORKSPACE', 'Primero elige una carpeta.')
      if (workspaceId !== active.id) throw new HttpError(409, 'WORKSPACE_CHANGED', 'La carpeta activa cambió. Vuelve a abrir el archivo.')
      const service = active.service
      const route = new URL(url, 'http://desktop.local')
      const file = route.searchParams.get('path')
      switch (`${method} ${route.pathname}`) {
        case 'GET /api/files': return service.listFiles()
        case 'GET /api/file': return service.getFile(file)
        case 'GET /api/history': return { versions: await service.history(file) }
        case 'POST /api/preview': return service.preview(body.path, body)
        case 'PUT /api/file': return service.save(body.path, body)
        case 'POST /api/restore': return service.restore(body.path, body)
        default: throw new HttpError(404, 'NOT_FOUND', 'Ruta de API desconocida')
      }
    },
  }
}
