import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bin = path.join(here, '..', 'bin', 'make-me-yaml.js')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-editor-cli-'))
fs.cpSync(path.join(here, '..', 'examples'), tmp, { recursive: true })
const children = []
test.after(() => {
  for (const child of children) child.kill()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['PORT', 'HOST', 'YAML_ROOT', 'EDITOR_MANIFEST'].includes(k)))
const run = (args, opts = {}) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: cleanEnv, ...opts })

// Arranca el comando y espera la dirección que anuncia.
function start(args, opts = {}) {
  const child = spawn(process.execPath, [bin, '--no-open', ...args], { env: cleanEnv, ...opts })
  children.push(child)
  return new Promise((resolve, reject) => {
    let out = ''
    child.stdout.on('data', (chunk) => {
      out += chunk
      if (out.includes('Ctrl+C')) resolve({ child, url: out.match(/→ (http:\/\/\S+)/)[1], out })
    })
    child.on('exit', (code) => reject(new Error(`salió con ${code}`)))
  })
}

test('--help y --version', () => {
  assert.match(run(['--help']).stdout, /Uso: make-me-yaml \[carpeta\]/)
  assert.match(run(['-v']).stdout, /^\d+\.\d+\.\d+/)
})

test('sirve la carpeta indicada', async () => {
  const { url, out } = await start([tmp, '--port', '0'])
  assert.ok(out.includes(`Carpeta: ${tmp}`))
  const { files } = await (await fetch(url + 'api/files')).json()
  assert.ok(files.some((f) => f.path === 'global.yaml'))
})

test('sin argumentos usa el directorio actual', async () => {
  const { url } = await start(['--port', '0'], { cwd: path.join(tmp, 'monitoreo') })
  const { files } = await (await fetch(url + 'api/files')).json()
  assert.deepEqual(files.map((f) => f.path).sort(), ['alertas.yaml', 'legacy.yaml'])
})

test('si el puerto por defecto está ocupado prueba el siguiente; uno explícito no', async () => {
  const blocker = net.createServer()
  // Si otro proceso ya tiene el 8787, la prueba sigue siendo válida.
  await new Promise((r) => blocker.once('error', r).listen(8787, '127.0.0.1', r))
  try {
    const { url } = await start([tmp])
    assert.notEqual(new URL(url).port, '8787')
    const r = run([tmp, '--port', '8787', '--no-open'])
    assert.equal(r.status, 2)
    assert.match(r.stderr, /el puerto 8787 está ocupado/)
  } finally {
    blocker.close()
  }
})

test('rechaza carpetas inexistentes y puertos no válidos', () => {
  const missing = run([path.join(tmp, 'no-existe'), '--no-open'])
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /no existe la carpeta/)
  const badPort = run([tmp, '--port', 'abc', '--no-open'])
  assert.equal(badPort.status, 2)
  assert.match(badPort.stderr, /puerto no válido/)
  assert.equal(run(['--bogus']).status, 2)
})
