import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'yaml'
import { globToRegExp, HttpError } from './util.js'

/** Ajustes de entorno. Todo tiene un valor por defecto seguro. */
export function loadSettings(env = process.env) {
  return {
    root: path.resolve(env.YAML_ROOT || 'examples'),
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8787),
    user: env.EDITOR_USER || '',
    pass: env.EDITOR_PASS || '',
    manifestName: env.EDITOR_MANIFEST || 'editor.manifest.yaml',
    historyKeep: Number(env.HISTORY_KEEP || 20),
    maxBytes: Number(env.MAX_FILE_BYTES || 1024 * 1024),
  }
}

const ALWAYS_EXCLUDED = ['**/.yaml-editor/**', '**/.git/**', '**/node_modules/**', '**/*.bak']

/**
 * Manifiesto opcional (editor.manifest.yaml dentro de la raíz). Modelo híbrido:
 * se escanea el disco y el manifiesto enriquece (títulos, schema, grupos)
 * o restringe (exclude, only_listed) lo encontrado.
 */
export function loadManifest(settings) {
  const file = path.join(settings.root, settings.manifestName)
  let raw = {}
  try {
    if (settings.manifestMode !== 'discover') {
      if (settings.strictManifest) {
        const real = fs.realpathSync(file)
        if (path.relative(settings.root, real).startsWith('..' + path.sep) || path.isAbsolute(path.relative(settings.root, real))) throw new Error('El manifiesto apunta fuera de la carpeta elegida.')
        if (fs.statSync(real).size > settings.maxBytes) throw new Error('El manifiesto supera el tamaño máximo permitido.')
      }
      raw = parse(fs.readFileSync(file, 'utf8')) ?? {}
      if (settings.strictManifest) {
        const record = (value) => value && typeof value === 'object' && !Array.isArray(value)
        if (!record(raw)) throw new Error('El manifiesto debe ser un objeto YAML.')
        for (const key of ['include', 'exclude']) if (raw[key] !== undefined && (!Array.isArray(raw[key]) || raw[key].some((v) => typeof v !== 'string'))) throw new Error(`«${key}» debe ser una lista de patrones de texto.`)
        for (const key of ['files', 'folders', 'defaults']) if (raw[key] !== undefined && !record(raw[key])) throw new Error(`«${key}» debe ser un objeto.`)
        if (raw.only_listed !== undefined && typeof raw.only_listed !== 'boolean') throw new Error('«only_listed» debe ser true o false.')
      }
    }
  } catch (e) {
    if (settings.strictManifest && (e.code !== 'ENOENT' || settings.manifestMode === 'manifest')) throw new HttpError(400, 'INVALID_MANIFEST', `No se pudo leer el manifiesto: ${e.message}`)
    if (e.code !== 'ENOENT') console.warn(`[manifiesto] no se pudo leer (${e.message}); se ignora`)
  }
  const include = Array.isArray(raw.include) && raw.include.length ? raw.include : ['**/*.yaml', '**/*.yml']
  const exclude = [...ALWAYS_EXCLUDED, settings.manifestName, ...(Array.isArray(raw.exclude) ? raw.exclude : [])]
  return {
    includeRe: include.map(globToRegExp),
    excludeRe: exclude.map(globToRegExp),
    onlyListed: raw.only_listed === true,
    defaults: raw.defaults || {},
    files: raw.files && typeof raw.files === 'object' ? raw.files : {},
    folders: raw.folders && typeof raw.folders === 'object' ? raw.folders : {},
  }
}
