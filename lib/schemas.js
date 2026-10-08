import fs from 'node:fs'
import path from 'node:path'
import Ajv from 'ajv'
import Ajv2019 from 'ajv/dist/2019.js'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormatsModule from 'ajv-formats'

const addFormats = addFormatsModule.default ?? addFormatsModule

const MODELINE = /^#\s*yaml-language-server:\s*\$schema=(\S+)/m

/**
 * Orden de resolución del schema de un YAML (de mayor a menor prioridad):
 * 1. manifiesto (files.<ruta>.schema, relativo a la raíz)
 * 2. modeline dentro del YAML:  # yaml-language-server: $schema=./x.schema.json
 * 3. archivo hermano:           nginx.yaml -> nginx.schema.json
 * 4. defaults.schema del manifiesto
 * Devuelve { rel, source } o { rel: null, warning? }.
 */
export function resolveSchemaRef(fsx, manifest, rel, text) {
  const dir = path.posix.dirname(rel)
  const join = (p) => path.posix.normalize(dir === '.' ? p : `${dir}/${p}`)
  let warning = null

  const fromManifest = manifest.files[rel]?.schema
  if (fromManifest && fsx.resolveAux(fromManifest)) return { rel: path.posix.normalize(fromManifest), source: 'manifiesto' }

  const head = text.split('\n', 12).join('\n')
  const m = MODELINE.exec(head)
  if (m) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(m[1])) {
      warning = 'El schema de la cabecera es remoto (URL); solo se admiten schemas locales.'
    } else if (fsx.resolveAux(join(m[1]))) {
      return { rel: join(m[1]), source: 'cabecera del YAML' }
    }
  }

  const sibling = join(path.posix.basename(rel).replace(/\.ya?ml$/i, '') + '.schema.json')
  if (fsx.resolveAux(sibling)) return { rel: sibling, source: 'archivo hermano' }

  const dflt = manifest.defaults?.schema
  if (dflt && fsx.resolveAux(dflt)) return { rel: path.posix.normalize(dflt), source: 'por defecto' }

  return { rel: null, warning }
}

const cache = new Map() // abs -> { mtimeMs, size, schema, validate }

function pickAjv(schema) {
  const s = String(schema.$schema || '')
  if (s.includes('2020-12')) return new Ajv2020({ allErrors: true, strict: false, allowUnionTypes: true })
  if (s.includes('2019-09')) return new Ajv2019({ allErrors: true, strict: false, allowUnionTypes: true })
  if (s && !s.includes('draft-07')) delete schema.$schema // drafts antiguos: se valida como draft-07
  return new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
}

/** Carga y compila un schema (con caché por mtime). Devuelve { schema, validate } o lanza Error. */
export function loadSchema(fsx, rel) {
  const aux = fsx.resolveAux(rel)
  if (!aux) throw new Error(`Schema no encontrado: ${rel}`)
  const st = fs.statSync(aux.abs)
  const hit = cache.get(aux.abs)
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit
  const schema = JSON.parse(fs.readFileSync(aux.abs, 'utf8'))
  const ajv = pickAjv(schema)
  addFormats(ajv)
  const fn = ajv.compile(schema)
  const entry = {
    mtimeMs: st.mtimeMs,
    size: st.size,
    schema,
    validate: (data) => (fn(data) ? [] : (fn.errors || []).map(toError)),
  }
  cache.set(aux.abs, entry)
  return entry
}

const ES = {
  required: (p) => `Falta el campo obligatorio «${p.missingProperty}»`,
  type: (p) => `Debe ser de tipo ${Array.isArray(p.type) ? p.type.join(' o ') : p.type}`,
  enum: (p) => `Debe ser uno de: ${(p.allowedValues || []).join(', ')}`,
  const: () => 'Valor no permitido',
  minimum: (p) => `Debe ser ≥ ${p.limit}`,
  maximum: (p) => `Debe ser ≤ ${p.limit}`,
  exclusiveMinimum: (p) => `Debe ser > ${p.limit}`,
  exclusiveMaximum: (p) => `Debe ser < ${p.limit}`,
  minLength: (p) => `Mínimo ${p.limit} caracteres`,
  maxLength: (p) => `Máximo ${p.limit} caracteres`,
  pattern: (p) => `No cumple el patrón ${p.pattern}`,
  format: (p) => `Formato inválido (${p.format})`,
  minItems: (p) => `Mínimo ${p.limit} elementos`,
  maxItems: (p) => `Máximo ${p.limit} elementos`,
  uniqueItems: () => 'Los elementos no pueden repetirse',
  additionalProperties: (p) => `Campo no permitido «${p.additionalProperty}»`,
  multipleOf: (p) => `Debe ser múltiplo de ${p.multipleOf}`,
  oneOf: () => 'No coincide con exactamente una de las variantes',
  anyOf: () => 'No coincide con ninguna de las variantes',
}

function toError(e) {
  let p = e.instancePath || ''
  if (e.keyword === 'required') p += '/' + e.params.missingProperty
  if (e.keyword === 'additionalProperties') p += '/' + e.params.additionalProperty
  const fn = ES[e.keyword]
  return {
    path: p
      .split('/')
      .slice(1)
      .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')),
    keyword: e.keyword,
    message: fn ? fn(e.params) : e.message,
  }
}
