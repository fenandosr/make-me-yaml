import fs from 'node:fs'
import { loadManifest } from './config.js'
import { createFs } from './scan.js'
import { loadSchema, resolveSchemaRef } from './schemas.js'
import { HttpError, sha256 } from './util.js'
import { lineDiff, restoreCosmetic } from './linediff.js'
import * as store from './store.js'
import {
  applyChanges,
  detectStyle,
  diffData,
  hasSecrets,
  inspectFeatures,
  parseYaml,
  redact,
  restartNeeded,
  serialize,
  unredact,
} from './yamlops.js'

export function createService(settings) {
  const manifest = loadManifest(settings)
  const fsx = createFs(settings, manifest)

  /* ───────── contexto de un archivo: texto + schema ───────── */
  function open(relInput) {
    const { rel, abs } = fsx.resolveYaml(relInput)
    const file = store.readFile(abs, settings.maxBytes)
    const meta = manifest.files[rel] || {}
    const ref = resolveSchemaRef(fsx, manifest, rel, file.text)
    let schema = null
    let schemaError = null
    if (ref.rel) {
      try {
        schema = loadSchema(fsx, ref.rel)
      } catch (e) {
        schemaError = e.message
      }
    }
    const readonly = meta.readonly === true || file.readonly
    return { rel, abs, file, meta, ref, schema, schemaError, readonly }
  }

  const titleOf = (c) => c.meta.title || c.schema?.schema?.title || null
  const descOf = (c) => c.meta.description || c.schema?.schema?.description || null

  /* ───────── listado (sin cargar nada en el navegador salvo metadatos) ───────── */
  function listFiles() {
    const files = fsx.listYamlPaths().map((rel) => {
      const base = { path: rel, name: rel.split('/').pop(), dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '' }
      try {
        const c = open(rel)
        const { doc, errors } = parseYaml(c.file.text)
        let status = 'ok'
        let errorCount = 0
        if (errors.length) {
          status = 'parse_error'
          errorCount = errors.length
        } else if (c.schemaError) status = 'schema_error'
        else if (!c.schema) status = 'noschema'
        else {
          errorCount = c.schema.validate(doc.toJS()).length
          if (errorCount) status = 'invalid'
        }
        return {
          ...base,
          title: titleOf(c),
          description: descOf(c),
          group: c.meta.group || null,
          size: c.file.size,
          mtime: c.file.mtimeMs,
          readonly: c.readonly,
          restartRequired: c.meta.restart_required === true,
          status,
          errorCount,
        }
      } catch (e) {
        return { ...base, title: null, description: null, group: null, size: 0, mtime: 0, readonly: true, status: 'error', errorCount: 0, error: e.message }
      }
    })
    return { root: settings.root.split('/').pop(), folders: manifest.folders, files }
  }

  /* ───────── lectura de un archivo para el editor ───────── */
  function getFile(rel) {
    const c = open(rel)
    const { doc, errors } = parseYaml(c.file.text)
    const out = {
      path: c.rel,
      title: titleOf(c),
      description: descOf(c),
      hash: c.file.hash,
      mtime: c.file.mtimeMs,
      readonly: c.readonly,
      restartRequired: c.meta.restart_required === true,
      schema: c.schema?.schema ?? null,
      schemaSource: c.ref.source ?? null,
      warnings: [c.ref.warning, c.schemaError && `Schema inválido: ${c.schemaError}`].filter(Boolean),
      parseErrors: errors,
      data: null,
      raw: null,
      rawAllowed: true,
      errors: [],
      roundtripStable: true,
    }
    if (errors.length) {
      out.raw = c.file.text
      return out
    }
    const data = doc.toJS()
    const feats = inspectFeatures(doc, c.file.text)
    if (feats.anchors || feats.aliases || feats.merge)
      out.warnings.push('El archivo usa anclas, alias o claves de mezcla (<<): al editar un valor heredado, ese campo pasa a tener valor propio.')
    out.roundtripStable = restoreCosmetic(c.file.text, serialize(doc, detectStyle(c.file.text))) === c.file.text
    if (c.schema) {
      out.errors = c.schema.validate(data)
      out.data = redact(data, c.schema.schema)
      out.rawAllowed = !hasSecrets(data, c.schema.schema)
    }
    if (out.rawAllowed) out.raw = c.file.text
    return out
  }

  /* ───────── propuesta de cambio: la comparten vista previa y guardado ───────── */
  function propose(c, body, { internal = false } = {}) {
    if (body.baseHash !== c.file.hash)
      throw new HttpError(409, 'CONFLICT', 'El archivo cambió en disco desde que se abrió', { hash: c.file.hash })
    const current = parseYaml(c.file.text)
    const style = detectStyle(c.file.text)
    let nextText
    let nextData
    let changes = []
    let warnings = []
    let parseErrors = []

    if (typeof body.raw === 'string') {
      if (!internal && c.schema && !current.errors.length && hasSecrets(current.doc.toJS(), c.schema.schema))
        throw new HttpError(403, 'RAW_BLOCKED', 'El modo YAML crudo no está disponible: el archivo contiene campos secretos')
      nextText = body.raw
      const next = parseYaml(nextText)
      parseErrors = next.errors
      if (!parseErrors.length) {
        nextData = next.doc.toJS()
        if (!current.errors.length) changes = diffData(current.doc.toJS(), nextData)
      }
    } else if (body.data !== undefined) {
      if (!c.schema) throw new HttpError(400, 'NO_SCHEMA', 'Este archivo no tiene schema: edítalo en modo YAML crudo')
      if (current.errors.length) throw new HttpError(422, 'YAML_INVALID', 'El YAML en disco no es válido: edítalo en modo crudo')
      const prev = current.doc.toJS()
      nextData = unredact(body.data, prev)
      changes = diffData(prev, nextData)
      if (changes.length) {
        warnings = applyChanges(current.doc, changes)
        const lib = serialize(current.doc, style)
        // Primero la versión «pulida» (solo cambian las líneas editadas); si no
        // significa exactamente lo que pidió el formulario, la salida normal del serializador.
        let rest = []
        for (const cand of [restoreCosmetic(c.file.text, lib), lib]) {
          const back = parseYaml(cand)
          rest = back.errors.length ? [{ op: 'set', path: [] }] : diffData(back.doc.toJS(), nextData)
          if (!rest.length) {
            nextText = cand
            break
          }
        }
        if (nextText === undefined)
          throw new HttpError(
            422,
            'CANNOT_APPLY',
            'No se pudo aplicar de forma fiel: ' + rest.slice(0, 3).map((r) => r.path.join('.') || '(raíz)').join(', ') + '. Usa el modo YAML crudo para ese cambio.',
            { paths: rest.map((r) => r.path) },
          )
      } else nextText = c.file.text
    } else throw new HttpError(400, 'BAD_BODY', 'Se esperaba «data» o «raw»')

    const errors = c.schema && nextData !== undefined ? c.schema.validate(nextData) : []
    return {
      nextText,
      nextData,
      changes,
      warnings,
      parseErrors,
      errors,
      unchanged: nextText === c.file.text,
      restartRequired: c.meta.restart_required === true || (c.schema ? restartNeeded(c.schema.schema, changes) : false),
    }
  }

  function preview(rel, body) {
    const c = open(rel)
    const p = propose(c, body)
    return {
      valid: !p.parseErrors.length && !p.errors.length,
      unchanged: p.unchanged,
      changeCount: p.changes.length,
      errors: p.errors,
      parseErrors: p.parseErrors,
      warnings: p.warnings,
      restartRequired: p.restartRequired,
      text: p.nextText,
      data: c.schema && p.nextData !== undefined ? redact(p.nextData, c.schema.schema) : null,
      diff: lineDiff(c.file.text, p.nextText),
    }
  }

  /* ───────── guardado ───────── */
  function save(rel, body, opts = {}) {
    const { rel: key } = fsx.resolveYaml(rel)
    return store.withLock(key, async () => {
      const c = open(key)
      if (c.readonly) throw new HttpError(403, 'READONLY', 'El archivo es de solo lectura')
      const p = propose(c, body, opts)
      if (p.parseErrors.length) throw new HttpError(422, 'YAML_INVALID', 'El YAML no es válido', { parseErrors: p.parseErrors })
      if (p.errors.length && body.allowInvalid !== true && !opts.internal)
        throw new HttpError(422, 'SCHEMA_INVALID', 'Los datos no cumplen el schema', { errors: p.errors })
      if (p.unchanged) return { unchanged: true, hash: c.file.hash }
      const backup = await store.saveBackup(settings, c.rel, c.file.text)
      const { atomic } = await store.atomicWrite(c.abs, p.nextText)
      const st = fs.statSync(c.abs)
      return {
        unchanged: false,
        hash: sha256(fs.readFileSync(c.abs)),
        mtime: st.mtimeMs,
        backup,
        atomic,
        changeCount: p.changes.length,
        warnings: p.warnings,
        restartRequired: p.restartRequired,
      }
    })
  }

  async function history(rel) {
    const { rel: key } = fsx.resolveYaml(rel)
    return store.listHistory(settings, key)
  }

  async function restore(rel, body) {
    const { rel: key } = fsx.resolveYaml(rel)
    const text = await store.readHistory(settings, key, body.version)
    return save(key, { raw: text, baseHash: body.baseHash, allowInvalid: true }, { internal: true })
  }

  return { listFiles, getFile, preview, save, history, restore }
}
