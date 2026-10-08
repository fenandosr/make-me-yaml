import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { HttpError, sha256 } from './util.js'

/* Exclusión mutua por archivo (un solo proceso). */
const queues = new Map()
export function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve()
  const run = prev.then(fn, fn)
  queues.set(
    key,
    run.catch(() => {}),
  )
  return run
}

export function readFile(abs, maxBytes) {
  const st = fs.statSync(abs)
  if (st.size > maxBytes) throw new HttpError(413, 'TOO_LARGE', `El archivo supera ${maxBytes} bytes`)
  const buf = fs.readFileSync(abs)
  return { text: buf.toString('utf8'), hash: sha256(buf), mtimeMs: st.mtimeMs, size: st.size, mode: st.mode, readonly: !canWrite(abs) }
}

export function canWrite(abs) {
  try {
    fs.accessSync(abs, fs.constants.W_OK)
    fs.accessSync(path.dirname(abs), fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Escritura atómica: temporal en el mismo directorio + fsync + rename.
 * Conserva permisos y propietario. Si el archivo está montado individualmente
 * (rename da EBUSY), recurre a sobrescribir en sitio y lo indica.
 */
export async function atomicWrite(abs, text) {
  const dir = path.dirname(abs)
  const st = await fsp.stat(abs).catch(() => null)
  const tmp = path.join(dir, `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`)
  const fh = await fsp.open(tmp, 'wx', st ? st.mode & 0o777 : 0o644)
  try {
    await fh.writeFile(text, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    if (st) {
      await fsp.chown(tmp, st.uid, st.gid).catch(() => {})
      await fsp.chmod(tmp, st.mode & 0o7777)
    }
    await fsp.rename(tmp, abs)
  } catch (e) {
    await fsp.rm(tmp, { force: true })
    if (e.code === 'EBUSY' || e.code === 'EXDEV') {
      await fsp.writeFile(abs, text, 'utf8')
      return { atomic: false }
    }
    throw e
  }
  try {
    const d = await fsp.open(dir, 'r')
    await d.sync()
    await d.close()
  } catch {
    /* no todos los sistemas permiten fsync de directorios */
  }
  return { atomic: true }
}

/* ───────────── historial (copias previas a cada guardado) ───────────── */

const VERSION_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9-]+Z\.yaml$/

const historyDir = (settings, rel) => path.join(settings.root, '.yaml-editor', 'history', ...rel.split('/'))

export async function saveBackup(settings, rel, text) {
  const dir = historyDir(settings, rel)
  await fsp.mkdir(dir, { recursive: true })
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '.yaml'
  await fsp.writeFile(path.join(dir, name), text, 'utf8')
  const all = (await fsp.readdir(dir)).filter((f) => VERSION_RE.test(f)).sort()
  for (const old of all.slice(0, Math.max(0, all.length - settings.historyKeep))) await fsp.rm(path.join(dir, old), { force: true })
  return name
}

export async function listHistory(settings, rel) {
  const dir = historyDir(settings, rel)
  try {
    const names = (await fsp.readdir(dir)).filter((f) => VERSION_RE.test(f)).sort().reverse()
    return Promise.all(
      names.map(async (name) => ({ version: name, size: (await fsp.stat(path.join(dir, name))).size })),
    )
  } catch {
    return []
  }
}

export async function readHistory(settings, rel, version) {
  if (!VERSION_RE.test(version || '')) throw new HttpError(400, 'BAD_VERSION', 'Versión inválida')
  try {
    return await fsp.readFile(path.join(historyDir(settings, rel), version), 'utf8')
  } catch {
    throw new HttpError(404, 'NOT_FOUND', 'Versión no encontrada')
  }
}
