// Prueba de la interfaz de escritorio con el contrato de bindings Wails y el motor real.
// Los selectores nativos se sustituyen por respuestas de fixture; no automatiza macOS.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from '../server.js'
import { loadSettings } from '../lib/config.js'
import { createWorkspaceManager } from '../lib/workspace.js'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-desktop-e2e-'))
const root = path.join(scratch, 'configuración con espacios')
const other = path.join(scratch, 'otra carpeta')
const empty = path.join(scratch, 'vacía')
fs.cpSync(new URL('../examples/', import.meta.url), root, { recursive: true })
fs.mkdirSync(other)
fs.mkdirSync(empty)
fs.writeFileSync(path.join(other, 'one.yaml'), '# otro proyecto\na: 1\n')
fs.writeFileSync(path.join(other, 'setup.yml'), 'only_listed: true\nfiles:\n  one.yaml:\n    title: Otro proyecto\n')
const server = createServer(loadSettings({ YAML_ROOT: root }))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const manager = createWorkspaceManager()
let browser
let checks = 0
const check = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS  ${name}`) }
let selectedDirectory = root
let selectedManifest = { directory: other, mode: 'manifest', manifestName: 'setup.yml' }
let dirty = false
let requests = 0
let acceptDiscard = false
try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1150, height: 850 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (dialog) => acceptDiscard ? dialog.accept() : dialog.dismiss())
  await page.route(base + '/', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, body: (await response.text()).replace('<head>', '<head><meta name="desktop-shell" content="wails">') })
  })
  await page.exposeFunction('nativeTestCall', async (method, ...args) => {
    if (method === 'ChooseDirectory') return selectedDirectory
    if (method === 'ChooseManifest') return selectedManifest
    if (method === 'SetDirty') { dirty = args[0]; return }
    try {
      let data
      if (method === 'InspectWorkspace') data = manager.inspect(args[0])
      else if (method === 'OpenWorkspace') data = manager.open(args[0])
      else if (method === 'Request') {
        requests++
        const [workspaceId, method, url, body] = args
        data = await manager.request({ workspaceId, method, url, body: JSON.parse(body) })
      }
      return { status: 200, data }
    } catch (error) { return { status: error.status || 500, data: { error: error.code, message: error.message } } }
  })
  await page.addInitScript(() => {
    setTimeout(() => {
      window.go = { main: { App: Object.fromEntries(['ChooseDirectory', 'ChooseManifest', 'InspectWorkspace', 'OpenWorkspace', 'Request', 'SetDirty'].map((method) => [method, (...args) => window.nativeTestCall(method, ...args)])) } }
    }, 150)
  })
  await page.goto(base)
  await page.getByRole('heading', { name: '¿Dónde está tu configuración?' }).waitFor()
  check('inicio requiere carpeta y no lee archivos de la API', requests === 0 && await page.locator('#app').isHidden())
  check('abrir deshabilitado hasta revisar una carpeta', await page.getByRole('button', { name: 'Abrir configuración' }).isDisabled())
  selectedDirectory = ''
  await page.getByRole('button', { name: 'Elegir carpeta', exact: true }).click()
  check('cancelar selector conserva pantalla inicial', await page.getByRole('button', { name: 'Abrir configuración' }).isDisabled())
  selectedDirectory = root
  await page.getByRole('button', { name: 'Elegir carpeta', exact: true }).click()
  await page.locator('.workspace-summary').waitFor()
  check('carpeta elegida detecta manifiesto y seis YAML', /6 archivos YAML/.test(await page.locator('.workspace-summary').innerText()) && /editor.manifest.yaml/.test(await page.locator('.workspace-summary').innerText()))
  await page.screenshot({ path: path.join(scratch, 'workspace-light.png') })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.screenshot({ path: path.join(scratch, 'workspace-dark.png') })
  await page.getByRole('button', { name: 'Abrir configuración' }).click()
  await page.locator('.card').first().waitFor()
  check('abrir entra al editor usando los bindings', await page.locator('#workspace-start').isHidden() && requests > 0)
  await page.locator('#tree .star').first().click()
  await page.locator('.card', { hasText: 'Proxy inverso' }).first().click()
  await page.locator('.form .field').first().waitFor()
  const port = page.locator('.field', { has: page.locator('.label', { hasText: 'Puerto' }) }).first().locator('input[type=number]')
  await port.fill('8443')
  await page.locator('.diff .dl.add').first().waitFor()
  check('edición notifica cambios pendientes al cierre nativo', dirty)
  await page.getByRole('button', { name: 'Cambiar carpeta' }).click()
  check('cancelar cambio de carpeta conserva edición', await port.inputValue() === '8443' && await page.locator('#workspace-start').isHidden())
  await page.locator('.toolbar .btn.primary').click()
  await page.locator('.banner.ok').waitFor()
  check('guardado por binding conserva comentarios', /^puerto: 8443 {11}# HTTPS$/m.test(fs.readFileSync(path.join(root, 'servicios/web/nginx.yaml'), 'utf8')))
  await page.waitForFunction(() => document.querySelector('.toolbar .btn.primary').disabled)
  check('guardar limpia el indicador nativo de cambios', !dirty)
  await port.fill('9443')
  await page.locator('.diff .dl.add').first().waitFor()
  acceptDiscard = true
  await page.getByRole('button', { name: 'Cambiar carpeta' }).click()
  await page.getByRole('heading', { name: '¿Dónde está tu configuración?' }).waitFor()
  check('cambiar carpeta regresa al inicio y limpia cambios', !dirty)
  check('recuerda la última carpeta sin abrirla automáticamente', await page.getByRole('button', { name: /Volver a la última carpeta/ }).isVisible())
  await page.getByRole('button', { name: 'Elegir manifiesto…', exact: true }).click()
  await page.locator('.workspace-summary').waitFor()
  check('manifiesto personalizado se reconoce antes de abrir', /setup.yml/.test(await page.locator('.workspace-summary').innerText()))
  await page.getByRole('button', { name: 'Abrir configuración' }).click()
  await page.locator('.card').first().waitFor()
  check('nueva carpeta muestra su propio archivo', await page.locator('.card').count() === 1 && /Otro proyecto/.test(await page.locator('.card').innerText()))
  check('favoritos quedan separados por carpeta', await page.locator('#tree .star.on').count() === 0)
  await page.getByRole('button', { name: 'Cambiar carpeta' }).click()
  await page.getByRole('heading', { name: '¿Dónde está tu configuración?' }).waitFor()
  await page.getByLabel('Ruta de la carpeta').fill(path.join(root, 'inexistente'))
  await page.getByRole('button', { name: 'Revisar carpeta', exact: true }).click()
  await page.locator('.workspace-result .banner.bad').waitFor()
  check('ruta inexistente muestra error y permite reintentar', await page.getByRole('button', { name: 'Abrir configuración' }).isDisabled())
  await page.getByLabel('Ruta de la carpeta').fill(empty)
  await page.getByRole('button', { name: 'Revisar carpeta', exact: true }).click()
  await page.locator('.workspace-summary').waitFor()
  check('carpeta vacía se reconoce sin fallar', /0 archivos YAML/.test(await page.locator('.workspace-summary').innerText()))
  await page.getByLabel('Ruta de la carpeta').fill(root)
  check('cambiar la ruta invalida la revisión anterior', await page.getByRole('button', { name: 'Abrir configuración' }).isDisabled())
  await page.getByLabel('Cómo buscar los archivos').selectOption('discover')
  await page.getByRole('button', { name: 'Revisar carpeta', exact: true }).click()
  await page.locator('.workspace-summary').waitFor()
  check('descubrimiento explícito funciona sin usar manifiesto', /Descubrimiento recursivo/.test(await page.locator('.workspace-summary').innerText()))
  await page.setViewportSize({ width: 640, height: 640 })
  check('pantalla inicial cabe en el tamaño mínimo de Wails', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  check('sin excepciones JavaScript', errors.length === 0 || (console.error(errors), false))
  console.log(`\n${checks}/${checks} comprobaciones del flujo de escritorio OK. Capturas: ${scratch}`)
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
