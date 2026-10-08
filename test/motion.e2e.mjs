// Comprueba Lottie con la CSP real, sin modificar los archivos de ejemplo.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium } from 'playwright'
import { createServer } from '../server.js'
import { loadSettings } from '../lib/config.js'

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-motion-e2e-'))
const root = path.join(scratch, 'root')
fs.cpSync(new URL('../examples/', import.meta.url), root, { recursive: true })
const server = createServer(loadSettings({ YAML_ROOT: root }))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
let browser
let checks = 0
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`PASS  ${name}`) }
const waitPlaying = (page, selector) => page.waitForFunction((selector) => {
  const el = document.querySelector(selector)
  return el?.animation?.isLoaded && !el.animation.isPaused && el.animation.currentFrame > 1
}, selector)
const defer = () => {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release }
}

try {
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  const requests = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('request', (req) => requests.push(req.url()))
  page.on('dialog', (dialog) => dialog.accept())

  const initial = defer()
  await page.route('**/api/files', async (route) => { await initial.promise; await route.continue() })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await waitPlaying(page, '#home yaml-motion[name=loading]')
  check('carga inicial: Lottie avanza mientras espera la API', true)
  const removedLoader = await page.locator('#home yaml-motion').elementHandle()
  initial.release()
  await page.waitForSelector('.card')
  await page.unroute('**/api/files')
  check('carga retirada: libera la instancia', await removedLoader.evaluate((el) => !el.animation))
  await waitPlaying(page, '.home-heading yaml-motion')
  const runtime = await page.request.get(base + '/vendor/lottie-light.min.js')
  check('reproductor local con MIME JavaScript', runtime.ok() && runtime.headers()['content-type'].includes('javascript'))
  const asset = await page.request.get(base + '/animations/loading.json')
  check('JSON local con MIME correcto', asset.ok() && asset.headers()['content-type'].includes('application/json'))
  check('tarjetas estáticas hasta interactuar', await page.locator('.card yaml-motion').first().evaluate((el) => !el.animation))
  await page.locator('.card').first().focus()
  await waitPlaying(page, '.card yaml-motion')
  check('foco del teclado reproduce el icono de tarjeta', true)

  // Verifica que todos los assets se dibujan y la retirada destruye los players.
  await page.evaluate(async () => {
    const { motion } = await import('/motion.js')
    const gallery = document.createElement('div')
    gallery.id = 'motion-gallery'
    Object.assign(gallery.style, { position: 'fixed', top: '200px', left: '400px', zIndex: '50', display: 'flex', background: 'var(--surface)', color: 'var(--accent)', padding: '20px', gap: '8px' })
    for (const name of ['document', 'success', 'warning', 'info', 'search', 'favorite', 'history', 'refresh', 'save', 'loading']) gallery.append(motion(name, { size: 'small', autoplay: true, loop: name === 'loading' }))
    document.body.append(gallery)
  })
  await page.waitForFunction(() => [...document.querySelectorAll('#motion-gallery yaml-motion')].every((el) => el.animation?.isLoaded && el.querySelector('.motion-canvas path[d]')))
  check('los diez JSON generan SVG válidos', true)
  await page.waitForFunction(() => [...document.querySelectorAll('#motion-gallery yaml-motion:not([loop])')].every((el) => el.finished))
  await page.locator('#motion-gallery').screenshot({ path: path.join(scratch, 'animations.png') })
  const loop = await page.locator('#motion-gallery yaml-motion[name=loading]').elementHandle()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => [...document.querySelectorAll('yaml-motion')].every((el) => !el.animation || el.animation.isPaused))
  check('cambio a movimiento reducido pausa los players activos', await loop.evaluate((el) => el.dataset.state === 'static' && getComputedStyle(el.querySelector('.motion-fallback')).visibility === 'visible'))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await waitPlaying(page, '#motion-gallery yaml-motion[name=loading]')
  check('cambio de preferencia reanuda las cargas', true)
  await page.locator('#motion-gallery').evaluate((el) => { el.hidden = true })
  await page.waitForFunction(() => document.querySelector('#motion-gallery yaml-motion[name=loading]').animation.isPaused)
  check('elemento fuera de vista queda pausado', true)
  await page.locator('#motion-gallery').evaluate((el) => el.remove())
  check('elemento retirado queda destruido', await loop.evaluate((el) => !el.animation))

  await page.locator('#search').fill('zzzz-sin-resultados')
  await waitPlaying(page, '#tree yaml-motion[name=search]')
  check('búsqueda sin resultados usa Lottie y texto', (await page.locator('#tree').innerText()).includes('Sin coincidencias'))
  await page.locator('#search').fill('')
  await page.locator('.tab[data-tab=fav]').click()
  await waitPlaying(page, '#tree yaml-motion[name=favorite]')
  check('favoritos vacíos tienen ilustración', true)
  await page.locator('.tab[data-tab=recent]').click()
  await page.waitForSelector('#tree yaml-motion[name=history]')
  check('recientes vacíos tienen ilustración', true)
  await page.locator('.tab[data-tab=all]').click()
  await page.locator('#tree .star').first().click()
  check('favorito conserva nombre y estado accesible', await page.locator('#tree .star').first().getAttribute('aria-pressed') === 'true')

  await page.locator('.card', { hasText: 'Proxy inverso' }).first().click()
  await page.waitForSelector('.form .field')
  await page.getByRole('button', { name: 'Historial', exact: true }).click()
  await page.waitForSelector('#history-list yaml-motion[name=history]')
  check('historial vacío ilustrado', (await page.locator('#history-list').innerText()).includes('Aún no hay versiones'))
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.locator('.filter').fill('zzzz-sin-campos')
  await page.waitForSelector('.form-empty:not([hidden]) yaml-motion[name=search]')
  check('filtro vacío del formulario ilustrado', true)
  await page.locator('.filter').fill('')
  const port = page.locator('.field', { has: page.locator('.label', { hasText: 'Puerto' }) }).first().locator('input[type=number]')
  const preview = defer()
  await page.route('**/api/preview', async (route) => { await preview.promise; await route.continue() })
  await port.fill('8443')
  await waitPlaying(page, '.preview-status yaml-motion[name=loading]')
  check('validación pendiente animada', await page.locator('.toolbar .btn.primary').isDisabled())
  preview.release()
  await page.waitForSelector('.preview-status yaml-motion[name=success]')
  await page.unroute('**/api/preview')
  const save = defer()
  let writes = 0
  await page.route('**/api/file', async (route) => {
    if (route.request().method() === 'PUT') { writes++; await save.promise }
    await route.continue()
  })
  await page.locator('.toolbar .btn.primary').click()
  await waitPlaying(page, '.toolbar .btn.primary yaml-motion[name=loading]')
  await page.keyboard.press('Control+s')
  check('guardado: indicador ocupado y evita doble envío', await page.locator('.toolbar .btn.primary').getAttribute('aria-busy') === 'true' && writes === 1)
  save.release()
  await page.waitForSelector('.banner.ok yaml-motion[name=success]')
  check('guardado confirmado con Lottie', (await page.locator('#toast').innerText()).includes('Guardado'))
  await page.unroute('**/api/file')
  await port.fill('99999')
  await page.waitForSelector('.preview-status yaml-motion[name=warning]')
  check('validación inválida animada sin habilitar guardado', await page.locator('.toolbar .btn.primary').isDisabled())
  await page.getByRole('button', { name: 'Descartar', exact: true }).click()
  await page.waitForSelector('.form .field')
  await page.getByRole('button', { name: 'Historial', exact: true }).click()
  await page.waitForSelector('.hist-row')
  const restore = defer()
  await page.route('**/api/restore', async (route) => { await restore.promise; await route.continue() })
  await page.getByRole('button', { name: 'Restaurar', exact: true }).first().click()
  await waitPlaying(page, '.hist-row yaml-motion[name=loading]')
  check('restauración pendiente animada', true)
  restore.release()
  await page.waitForSelector('.banner.ok')
  check('restauración confirma resultado', (await page.locator('.banner.ok').innerText()).includes('Versión restaurada'))
  await page.unroute('**/api/restore')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.querySelector('.banner.ok yaml-motion').finished)
  await page.screenshot({ path: path.join(scratch, 'editor-dark.png') })
  await page.setViewportSize({ width: 390, height: 800 })
  await page.waitForFunction(() => document.querySelector('#sidebar').getBoundingClientRect().right <= 1)
  check('móvil sin desbordamiento con iconos y mensajes', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
  await page.screenshot({ path: path.join(scratch, 'editor-mobile.png') })
  check('sin peticiones externas', requests.every((url) => url.startsWith(base)))
  check('sin errores de JavaScript ni CSP', errors.length === 0 || (console.error(errors), false))

  const reduced = await browser.newPage({ reducedMotion: 'reduce' })
  const reducedRequests = []
  reduced.on('request', (req) => reducedRequests.push(req.url()))
  await reduced.goto(base)
  await reduced.waitForSelector('.card')
  await reduced.locator('.card').first().focus()
  check('movimiento reducido desde inicio: sin descargar player ni JSON', reducedRequests.every((url) => !url.includes('/vendor/') && !url.endsWith('.json')))
  check('respaldo SVG visible y decorativo', await reduced.locator('.home-heading yaml-motion').evaluate((el) => el.getAttribute('aria-hidden') === 'true' && getComputedStyle(el.querySelector('.motion-fallback')).visibility === 'visible'))

  const fallback = await browser.newPage()
  const fallbackErrors = []
  fallback.on('pageerror', (e) => fallbackErrors.push(e.message))
  await fallback.route('**/vendor/lottie-light.min.js', (route) => route.abort())
  await fallback.goto(base)
  await fallback.waitForSelector('.card')
  await fallback.waitForFunction(() => document.querySelector('.home-heading yaml-motion').failed)
  await fallback.locator('.card').first().click()
  await fallback.waitForSelector('.form .field')
  check('reproductor fallido: editor funcional y sin excepciones', fallbackErrors.length === 0)

  const failedList = await browser.newPage()
  await failedList.route('**/api/files', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Fallo de prueba' }) }))
  await failedList.goto(base)
  await failedList.waitForSelector('#home .banner.bad')
  check('fallo de API conserva aviso y permite reintentar', await failedList.getByRole('button', { name: 'Actualizar archivos' }).isEnabled())
  await failedList.unroute('**/api/files')
  await failedList.getByRole('button', { name: 'Actualizar archivos' }).click()
  await failedList.waitForSelector('.card')
  check('actualizar recupera la lista tras un error', true)
  console.log(`\n${checks}/${checks} comprobaciones de animaciones OK. Capturas: ${scratch}`)
} finally {
  await browser?.close()
  await new Promise((resolve) => server.close(resolve))
}
