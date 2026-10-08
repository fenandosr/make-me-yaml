#!/usr/bin/env node
// Comando `make-me-yaml`: sirve una carpeta con el editor web y abre el navegador.
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { parseArgs } from 'node:util'
import { createRequire } from 'node:module'
import { loadSettings } from '../lib/config.js'
import { createServer, warnIfExposed } from '../server.js'

const { version } = createRequire(import.meta.url)('../package.json')
const PORT_ATTEMPTS = 10

const HELP = `Uso: make-me-yaml [carpeta] [opciones]

Abre el editor de YAML sobre [carpeta] (por defecto, el directorio actual).

Opciones:
  -p, --port <n>         Puerto (por defecto 8787; si está ocupado prueba los siguientes)
      --host <dir>       Dirección de escucha (por defecto 127.0.0.1)
  -m, --manifest <nom>   Nombre del manifiesto dentro de la carpeta (por defecto editor.manifest.yaml)
      --no-open          No abrir el navegador
  -h, --help             Muestra esta ayuda
  -v, --version          Muestra la versión

Las variables de entorno del modo web (PORT, HOST, EDITOR_USER, EDITOR_PASS,
EDITOR_MANIFEST, HISTORY_KEEP, MAX_FILE_BYTES) siguen funcionando; las opciones
tienen prioridad. Las credenciales solo se aceptan por entorno.`

function fail(message) {
  console.error(`make-me-yaml: ${message}`)
  console.error('Usa --help para ver las opciones.')
  process.exit(2)
}

let args
try {
  args = parseArgs({
    allowPositionals: true,
    options: {
      port: { type: 'string', short: 'p' },
      host: { type: 'string' },
      manifest: { type: 'string', short: 'm' },
      'no-open': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  })
} catch (e) {
  fail(e.message)
}
const { values, positionals } = args
if (values.help) {
  console.log(HELP)
  process.exit(0)
}
if (values.version) {
  console.log(version)
  process.exit(0)
}
if (positionals.length > 1) fail('indica una sola carpeta')

const root = path.resolve(positionals[0] ?? process.env.YAML_ROOT ?? '.')
if (!fs.statSync(root, { throwIfNoEntry: false })?.isDirectory()) fail(`no existe la carpeta ${root}`)

const env = { ...process.env, YAML_ROOT: root }
if (values.port !== undefined) env.PORT = values.port
if (values.host !== undefined) env.HOST = values.host
if (values.manifest !== undefined) env.EDITOR_MANIFEST = values.manifest
const settings = loadSettings(env)
if (!Number.isInteger(settings.port) || settings.port < 0 || settings.port > 65535) fail(`puerto no válido: ${env.PORT}`)
if (path.basename(settings.manifestName) !== settings.manifestName) fail('el manifiesto debe ser un nombre de archivo dentro de la carpeta, no una ruta')

// Con un puerto elegido explícitamente no se prueban otros: mejor fallar que sorprender.
const explicitPort = values.port !== undefined || process.env.PORT !== undefined
const server = createServer(settings)

function listen(port, attemptsLeft) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && !explicitPort && attemptsLeft > 1 && port < 65535) return listen(port + 1, attemptsLeft - 1)
    if (e.code === 'EADDRINUSE') fail(`el puerto ${port} está ocupado`)
    fail(e.message)
  })
  server.listen(port, settings.host, onListening)
}

function onListening() {
  const { port } = server.address()
  const wildcard = ['0.0.0.0', '::'].includes(settings.host)
  const host = wildcard ? '127.0.0.1' : settings.host.includes(':') ? `[${settings.host}]` : settings.host
  const url = `http://${host}:${port}/`
  warnIfExposed(settings)
  console.log(`Make Me YAML! → ${url}`)
  console.log(`Carpeta: ${settings.root}`)
  console.log('Pulsa Ctrl+C para salir.')
  if (!values['no-open']) openBrowser(url)
}

function openBrowser(url) {
  const [cmd, cmdArgs] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]]
  try {
    const child = spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true })
    child.on('error', () => console.log('No se pudo abrir el navegador; abre la dirección manualmente.'))
    child.unref()
  } catch {
    console.log('No se pudo abrir el navegador; abre la dirección manualmente.')
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close()
    process.exit(0)
  })
}

listen(settings.port, PORT_ATTEMPTS)
