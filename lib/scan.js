import fs from 'node:fs'
import path from 'node:path'
import { HttpError, matchesAny, toPosix } from './util.js'

/**
 * Contexto de acceso al disco. Todo acceso a un archivo pasa por aquí:
 * 1) la ruta relativa debe estar permitida (include/exclude/only_listed);
 * 2) la ruta real (tras resolver symlinks) debe seguir dentro de la raíz.
 */
export function createFs(settings, manifest) {
  const realRoot = fs.realpathSync(settings.root)

  const isInside = (abs) => abs === realRoot || abs.startsWith(realRoot + path.sep)

  function cleanRel(rel) {
    if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.length > 500) {
      throw new HttpError(400, 'BAD_PATH', 'Ruta inválida')
    }
    const norm = path.posix.normalize(toPosix(rel))
    if (norm.startsWith('../') || norm === '..' || norm.startsWith('/') || path.isAbsolute(rel)) {
      throw new HttpError(400, 'BAD_PATH', 'Ruta fuera de la raíz')
    }
    return norm
  }

  function isAllowedRel(rel) {
    if (!matchesAny(rel, manifest.includeRe) || matchesAny(rel, manifest.excludeRe)) return false
    if (manifest.onlyListed && !Object.hasOwn(manifest.files, rel)) return false
    return true
  }

  /** Devuelve { rel, abs } de un YAML editable o lanza HttpError. */
  function resolveYaml(relInput) {
    const rel = cleanRel(relInput)
    if (!isAllowedRel(rel)) throw new HttpError(404, 'NOT_FOUND', 'Archivo no disponible')
    let abs
    try {
      abs = fs.realpathSync(path.join(realRoot, rel))
    } catch {
      throw new HttpError(404, 'NOT_FOUND', 'Archivo no encontrado')
    }
    if (!isInside(abs)) throw new HttpError(403, 'OUTSIDE_ROOT', 'El archivo apunta fuera de la raíz')
    if (!fs.statSync(abs).isFile()) throw new HttpError(404, 'NOT_FOUND', 'No es un archivo')
    return { rel, abs }
  }

  /** Lee un archivo auxiliar (schema) dentro de la raíz; null si no existe o no es seguro. */
  function resolveAux(relInput) {
    try {
      const rel = cleanRel(relInput)
      const abs = fs.realpathSync(path.join(realRoot, rel))
      if (!isInside(abs) || !fs.statSync(abs).isFile()) return null
      return { rel, abs }
    } catch {
      return null
    }
  }

  /** Recorre la raíz y devuelve las rutas relativas de los YAML permitidos. */
  function listYamlPaths() {
    const out = []
    const walk = (dirRel) => {
      let entries
      try {
        entries = fs.readdirSync(path.join(realRoot, dirRel), { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        const rel = dirRel ? `${dirRel}/${e.name}` : e.name
        if (e.isDirectory()) {
          if (['.git', 'node_modules', '.yaml-editor'].includes(e.name)) continue
          walk(rel)
        } else if (e.isFile() || e.isSymbolicLink()) {
          if (!isAllowedRel(rel)) continue
          try {
            resolveYaml(rel)
            out.push(rel)
          } catch {
            /* symlink roto o fuera de la raíz: se omite */
          }
        }
      }
    }
    walk('')
    return out.sort((a, b) => a.localeCompare(b))
  }

  return { realRoot, cleanRel, resolveYaml, resolveAux, listYamlPaths }
}
