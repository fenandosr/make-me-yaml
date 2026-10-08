import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSettings } from '../lib/config.js'
import { createServer } from '../server.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-editor-'))
fs.cpSync(path.join(here, '..', 'examples'), tmp, { recursive: true })

const settings = loadSettings({ YAML_ROOT: tmp })
const server = createServer(settings)
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`
test.after(() => {
  server.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'yaml-editor' }
const get = async (p) => (await fetch(base + p)).json()
const post = async (method, p, body, headers = H) => {
  const r = await fetch(base + p, { method, headers, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}
const read = (rel) => fs.readFileSync(path.join(tmp, rel), 'utf8')
const q = (rel) => `/api/file?path=${encodeURIComponent(rel)}`

test('lista solo los YAML permitidos, con estado', async () => {
  const { files, folders } = await get('/api/files')
  assert.deepEqual(
    files.map((f) => f.path),
    ['global.yaml', 'monitoreo/alertas.yaml', 'monitoreo/legacy.yaml', 'servicios/db/postgres.yaml', 'servicios/web/app.yaml', 'servicios/web/nginx.yaml'],
  )
  const st = Object.fromEntries(files.map((f) => [f.path, f.status]))
  assert.equal(st['monitoreo/legacy.yaml'], 'invalid')
  assert.equal(st['servicios/db/postgres.yaml'], 'noschema')
  assert.equal(st['global.yaml'], 'ok')
  assert.equal(files.find((f) => f.path === 'global.yaml').title, 'Ajustes globales')
  assert.equal(folders.servicios.title, 'Servicios')
})

test('rechaza rutas fuera de la lista blanca o de la raíz', async () => {
  for (const p of ['../etc/passwd', '/etc/passwd', 'servicios/../../x.yaml', 'global.schema.json', 'editor.manifest.yaml', 'nada.yaml']) {
    const r = await fetch(base + q(p))
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`)
  }
})

test('las mutaciones exigen la cabecera anti-CSRF', async () => {
  const r = await post('POST', '/api/preview', { path: 'global.yaml' }, { 'Content-Type': 'application/json' })
  assert.equal(r.status, 403)
})

test('vista previa y guardado conservan comentarios, comillas y estilo', async () => {
  const f = await get(q('servicios/web/nginx.yaml'))
  assert.equal(f.data.puerto, 443)
  assert.ok(f.warnings.some((w) => /alias|anclas/.test(w)))
  const data = structuredClone(f.data)
  data.puerto = 8443
  data.upstreams[1].timeout_s = 15
  const prev = await post('POST', '/api/preview', { path: f.path, baseHash: f.hash, data })
  assert.equal(prev.status, 200)
  assert.equal(prev.body.valid, true)
  assert.equal(prev.body.changeCount, 2)
  assert.equal(prev.body.restartRequired, true) // puerto es x-restart-required
  const save = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, data })
  assert.equal(save.status, 200)
  const after = read(f.path)
  // los comentarios se conservan y mantienen su columna original
  assert.match(after, /^puerto: 8443 {11}# HTTPS$/m)
  assert.match(after, /^ {4}timeout_s: 15 {6}# más corto que el valor común$/m)
  assert.match(after, /servidor: "mi-sitio\.example\.com"/)
  assert.match(after, /^# Parámetros comunes reutilizados/m)
  assert.match(after, /<<: \*defaults/)
  // la lista sin sangría extra del original y su comentario alineado no se tocan
  assert.match(after, /^ {2}- TLSv1\.2 {12}# mínimo aceptable$/m)
  // y solo cambian las líneas editadas
  const orig = fs.readFileSync(path.join(here, '..', 'examples', f.path), 'utf8').split('\n')
  const changed = after.split('\n').filter((l, i) => l !== orig[i])
  assert.equal(changed.length, 2, `líneas distintas: ${JSON.stringify(changed)}`)
})

test('conflicto si el archivo cambió en disco', async () => {
  const f = await get(q('global.yaml'))
  fs.appendFileSync(path.join(tmp, 'global.yaml'), '# editado a mano\n')
  const r = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, data: { ...f.data, modo_mantenimiento: true } })
  assert.equal(r.status, 409)
  assert.equal(r.body.error, 'CONFLICT')
})

test('no escribe si no cumple el schema', async () => {
  const f = await get(q('global.yaml'))
  const before = read(f.path)
  const r = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, data: { ...f.data, entorno: 'otro' } })
  assert.equal(r.status, 422)
  assert.equal(r.body.error, 'SCHEMA_INVALID')
  assert.deepEqual(r.body.errors[0].path, ['entorno'])
  assert.equal(read(f.path), before)
})

test('secretos: no viajan al navegador y se conservan al guardar', async () => {
  const f = await get(q('servicios/web/app.yaml'))
  assert.equal(f.data.base_datos.clave, '__unchanged__')
  assert.equal(f.rawAllowed, false)
  assert.equal(f.raw, null)
  assert.ok(!JSON.stringify(f).includes('s3creta-demo'))
  const data = structuredClone(f.data)
  data.base_datos.pool = 25
  const r = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, data })
  assert.equal(r.status, 200)
  assert.match(read(f.path), /clave: s3creta-demo/)
  assert.match(read(f.path), /pool: 25/)
  const f2 = await get(q(f.path))
  const raw = await post('POST', '/api/preview', { path: f.path, baseHash: f2.hash, raw: 'a: 1\n' })
  assert.equal(raw.status, 403)
})

test('arrays y mapas: añadir, quitar y claves nuevas', async () => {
  const f = await get(q('servicios/web/app.yaml'))
  const data = structuredClone(f.data)
  data.administradores.push({ nombre: 'Eva', correo: 'eva@example.com' })
  data.administradores.splice(0, 1)
  data.etiquetas.entorno = 'prod'
  delete data.funciones.exportar_csv
  const r = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, data })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const after = read(f.path)
  assert.match(after, /nombre: Luis/)
  assert.match(after, /nombre: Eva/)
  assert.doesNotMatch(after, /nombre: Ana/)
  assert.match(after, /entorno: prod/)
  assert.doesNotMatch(after, /exportar_csv/)
  assert.match(after, /^# Aplicación principal$/m)
})

test('cambio de tipo y valores ambiguos se escriben con las comillas correctas', async () => {
  const f = await get(q('servicios/web/app.yaml'))
  const data = structuredClone(f.data)
  data.base_datos.usuario = 'yes'
  data.etiquetas.region = '0123'
  data.nombre = 'Línea 1\nLínea 2'
  const r = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, data })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  const f2 = await get(q(f.path))
  assert.equal(f2.data.base_datos.usuario, 'yes')
  assert.equal(f2.data.etiquetas.region, '0123')
  assert.equal(f2.data.nombre, 'Línea 1\nLínea 2')
})

test('historial y restauración', async () => {
  const { versions } = await get(`/api/history?path=${encodeURIComponent('servicios/web/nginx.yaml')}`)
  assert.ok(versions.length >= 1)
  const f = await get(q('servicios/web/nginx.yaml'))
  const r = await post('POST', '/api/restore', { path: f.path, baseHash: f.hash, version: versions[versions.length - 1].version })
  assert.equal(r.status, 200)
  assert.match(read(f.path), /^puerto: 443 +# HTTPS$/m)
})

test('modo crudo: rechaza YAML inválido y guarda el válido', async () => {
  const f = await get(q('servicios/db/postgres.yaml'))
  const bad = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, raw: 'a: [1, 2\nb: : :' })
  assert.equal(bad.status, 422)
  assert.equal(bad.body.error, 'YAML_INVALID')
  const ok = await post('PUT', '/api/file', { path: f.path, baseHash: f.hash, raw: f.raw.replace('200', '300') })
  assert.equal(ok.status, 200)
  assert.match(read(f.path), /max_connections: 300/)
})
