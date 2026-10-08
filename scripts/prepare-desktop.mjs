import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Para empaquetar escritorio se necesita Node.js 22 o posterior.')
const generated = path.join(root, 'desktop/generated')
const frontend = path.join(generated, 'frontend')
fs.mkdirSync(frontend, { recursive: true })
fs.cpSync(path.join(root, 'public'), frontend, { recursive: true })
const index = path.join(frontend, 'index.html')
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<head>', '<head>\n    <meta name="desktop-shell" content="wails" />'))
fs.mkdirSync(path.join(frontend, 'vendor'), { recursive: true })
fs.copyFileSync(path.join(root, 'node_modules/lottie-web/build/player/lottie_light.min.js'), path.join(frontend, 'vendor/lottie-light.min.js'))
// Incluir Node evita depender del PATH o de una instalación en el equipo del usuario.
const runtimeFile = path.join(generated, 'node.gz')
const metadataFile = path.join(generated, 'runtime.json')
const metadata = JSON.stringify({ platform: process.platform, arch: process.arch, version: process.version })
if (!fs.existsSync(runtimeFile) || !fs.existsSync(metadataFile) || fs.readFileSync(metadataFile, 'utf8') !== metadata) {
  fs.writeFileSync(runtimeFile, gzipSync(fs.readFileSync(process.execPath), { level: 9 }))
  fs.writeFileSync(metadataFile, metadata)
}
await build({ entryPoints: [path.join(root, 'desktop/worker.js')], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: path.join(generated, 'worker.cjs') })
const licenses = []
const nodeLicense = path.resolve(process.execPath, '../../LICENSE')
if (!fs.existsSync(nodeLicense)) throw new Error(`Falta la licencia de Node: ${nodeLicense}. Compila con una distribución oficial de Node.js.`)
licenses.push(`Node.js ${process.version}\n${fs.readFileSync(nodeLicense, 'utf8')}`)
for (const name of ['yaml', 'ajv', 'ajv-formats', 'fast-deep-equal', 'fast-uri', 'json-schema-traverse', 'require-from-string', 'lottie-web']) {
  const directory = path.join(root, 'node_modules', name)
  const license = fs.readdirSync(directory).find((name) => /^licen[cs]e(\.|$)/i.test(name))
  if (!license) throw new Error(`Falta la licencia de ${name}`)
  licenses.push(`${name}\n${fs.readFileSync(path.join(directory, license), 'utf8')}`)
}
for (const [name, file] of [['Bangers', 'Bangers-OFL.txt'], ['Comic Neue', 'ComicNeue-OFL.txt']])
  licenses.push(`Fuente ${name}\n${fs.readFileSync(path.join(root, 'public/fonts', file), 'utf8')}`)
fs.writeFileSync(path.join(frontend, 'THIRD_PARTY_LICENSES.txt'), licenses.join('\n\n────────────────\n\n'))
console.log(`Escritorio preparado: ${process.platform}/${process.arch}, Node ${process.version} incluido.`)
