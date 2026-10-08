import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadSettings } from './lib/config.js'
import { createService } from './lib/documents.js'
import { HttpError } from './lib/util.js'

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const LOTTIE_PLAYER = fileURLToPath(import.meta.resolve('lottie-web/build/player/lottie_light.min.js'))
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
}
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
}

const safeEqual = (a, b) => {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function createServer(settings = loadSettings()) {
  const service = createService(settings)
  const authOn = Boolean(settings.user || settings.pass)

  function authorized(req) {
    if (!authOn) return true
    const m = /^Basic (.+)$/.exec(req.headers.authorization || '')
    if (!m) return false
    const [u, ...rest] = Buffer.from(m[1], 'base64').toString('utf8').split(':')
    return safeEqual(u, settings.user) && safeEqual(rest.join(':'), settings.pass)
  }

  function send(res, status, body, headers = {}) {
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      'Content-Type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
      ...headers,
    })
    res.end(payload)
  }

  function readJson(req, limit = 4 * 1024 * 1024) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (c) => {
        size += c.length
        if (size > limit) {
          reject(new HttpError(413, 'TOO_LARGE', 'Cuerpo demasiado grande'))
          req.destroy()
        } else chunks.push(c)
      })
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'))
        } catch {
          reject(new HttpError(400, 'BAD_JSON', 'JSON inválido'))
        }
      })
      req.on('error', reject)
    })
  }

  /** Mutaciones: cabecera propia (obliga a preflight CORS) y Origin coherente con Host. */
  function checkMutation(req) {
    if (req.headers['x-requested-with'] !== 'yaml-editor') throw new HttpError(403, 'CSRF', 'Falta la cabecera de seguridad')
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'CSRF', 'Origen no permitido')
  }

  async function api(req, res, url) {
    const q = url.searchParams.get('path')
    const key = `${req.method} ${url.pathname}`
    if (req.method !== 'GET') checkMutation(req)
    switch (key) {
      case 'GET /api/files':
        return send(res, 200, service.listFiles())
      case 'GET /api/file':
        return send(res, 200, service.getFile(q))
      case 'GET /api/history':
        return send(res, 200, { versions: await service.history(q) })
      case 'POST /api/preview': {
        const b = await readJson(req)
        return send(res, 200, service.preview(b.path, b))
      }
      case 'PUT /api/file': {
        const b = await readJson(req)
        return send(res, 200, await service.save(b.path, b))
      }
      case 'POST /api/restore': {
        const b = await readJson(req)
        return send(res, 200, await service.restore(b.path, b))
      }
      default:
        throw new HttpError(404, 'NOT_FOUND', 'Ruta de API desconocida')
    }
  }

  function serveStatic(res, pathname) {
    if (pathname === '/vendor/lottie-light.min.js') return send(res, 200, fs.readFileSync(LOTTIE_PLAYER), { 'Content-Type': TYPES['.js'] })
    const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
    const abs = path.resolve(PUBLIC_DIR, rel)
    if (!abs.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return send(res, 404, 'No encontrado')
    send(res, 200, fs.readFileSync(abs), { 'Content-Type': TYPES[path.extname(abs)] || 'application/octet-stream' })
  }

  return http.createServer(async (req, res) => {
    try {
      if (!authorized(req)) return send(res, 401, 'Autenticación requerida', { 'WWW-Authenticate': 'Basic realm="yaml-editor", charset="UTF-8"' })
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname.startsWith('/api/')) return await api(req, res, url)
      if (req.method !== 'GET') return send(res, 405, 'Método no permitido')
      serveStatic(res, decodeURIComponent(url.pathname))
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message, ...e.extra })
      console.error(e)
      send(res, 500, { error: 'INTERNAL', message: 'Error interno' })
    }
  })
}

export function warnIfExposed(settings) {
  const authOn = Boolean(settings.user || settings.pass)
  if (!['127.0.0.1', 'localhost', '::1'].includes(settings.host) && !authOn)
    console.warn('⚠️  Escuchando fuera de localhost SIN autenticación. Define EDITOR_USER y EDITOR_PASS y pon TLS delante (proxy inverso).')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const settings = loadSettings()
  warnIfExposed(settings)
  createServer(settings).listen(settings.port, settings.host, () => {
    console.log(`Make Me YAML! → http://${settings.host}:${settings.port}  (raíz: ${settings.root})`)
  })
}
