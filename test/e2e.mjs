// Prueba de extremo a extremo en un Chromium real (requiere: npm i -D playwright && npx playwright install chromium).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { loadSettings } from '../lib/config.js'
import { createServer } from '../server.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-editor-e2e-'))
const tmp = path.join(SCRATCH, 'root')
fs.cpSync(path.join(here, '..', 'examples'), tmp, { recursive: true })
const server = createServer(loadSettings({ YAML_ROOT: tmp }))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  → ' + extra : ''}`)
}
const read = (rel) => fs.readFileSync(path.join(tmp, rel), 'utf8')

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('dialog', (d) => d.accept())

try {
  /* 1 · menú de inicio */
  await page.goto(base)
  await page.waitForSelector('.card')
  check('home: 6 tarjetas', (await page.locator('.card').count()) === 6, String(await page.locator('.card').count()))
  check('home: grupos del manifiesto', (await page.locator('.home-group h2').allTextContents()).includes('Servicios'))
  check('sidebar: árbol con carpetas', (await page.locator('.row.folder').count()) >= 4)
  check('badge de error en legacy.yaml', (await page.locator('.badge.warn').count()) >= 1)
  const stray = async () => /\b(null|undefined|NaN|\[object)\b/.test(await page.evaluate(() => document.body.innerText))
  check('home: sin texto «null/undefined» perdido', !(await stray()))
  await page.screenshot({ path: path.join(SCRATCH, 'shot-home.png') })

  /* 2 · editar nginx desde el formulario */
  await page.locator('.card', { hasText: 'Proxy inverso' }).click()
  await page.waitForSelector('.form .field')
  check('hash de URL', page.url().includes('#/f/servicios/web/nginx.yaml'))
  const puerto = page.locator('.field', { has: page.locator('.label', { hasText: 'Puerto' }) }).first().locator('input[type=number]')
  check('puerto cargado = 443', (await puerto.inputValue()) === '443')
  await puerto.fill('8443')
  await page.waitForSelector('.diff .dl.add')
  check('diff muestra línea añadida', (await page.locator('.dl.add .tx').first().textContent()).includes('puerto: 8443'))
  check('guardar habilitado con 1 cambio', await page.locator('button:has-text("Guardar (1 cambio)")').isEnabled())
  check('formulario: sin texto «null/undefined» perdido', !(await stray()))
  await page.screenshot({ path: path.join(SCRATCH, 'shot-form.png') })
  await page.locator('button:has-text("Guardar (1 cambio)")').click()
  await page.waitForSelector('.banner.ok')
  const nginx = read('servicios/web/nginx.yaml')
  check('guardado conserva comentario y columna', /^puerto: 8443 {11}# HTTPS$/m.test(nginx))
  check('aviso de reinicio tras guardar', (await page.locator('.banner.ok').first().textContent()).includes('reiniciar'))

  /* 3 · validación: valor fuera de rango */
  await puerto.fill('')
  const puerto2 = page.locator('.field', { has: page.locator('.label', { hasText: 'Puerto' }) }).first().locator('input[type=number]')
  await puerto2.fill('99999')
  await page.waitForSelector('.field.invalid')
  check('error junto al campo', (await page.locator('.field.invalid .err').first().textContent()).includes('≤ 65535'))
  check('guardar deshabilitado con error', await page.locator('.toolbar .btn.primary').isDisabled())
  await page.locator('button:has-text("Descartar")').click()
  await page.waitForSelector('.form .field')

  /* 4 · listas y secretos en app.yaml */
  await page.goto(base + '#/f/servicios/web/app.yaml')
  await page.waitForSelector('.form .field')
  check('secreto enmascarado', (await page.locator('input[type=password]').first().inputValue()) === '' && (await page.locator('input[type=password]').first().getAttribute('placeholder')).includes('sin cambios'))
  check('sin modo YAML (secretos)', (await page.locator('.seg').count()) === 0)
  check('lista de administradores (2)', (await page.locator('.field:has-text("Administradores") .item').count()) === 2)
  await page.locator('button:has-text("+ Añadir elemento")').first().click()
  check('añadir elemento → 3', (await page.locator('.field:has-text("Administradores") .item').count()) === 3)
  // quita el elemento nuevo (se queda sin cambios netos)
  await page.locator('.field:has-text("Administradores") .item').nth(2).locator('button[title="Quitar"]').click()
  await page.waitForSelector('.panel .panel-head:has-text("Sin cambios")')
  check('revertir deja “Sin cambios”', true)
  // mapa: añadir clave
  await page.locator('.field:has-text("Etiquetas") .add-row input').fill('zona')
  await page.locator('.field:has-text("Etiquetas") .add-row button').click()
  await page.waitForSelector('.diff .dl.add')
  check('mapa: clave nueva en el diff', (await page.locator('.dl.add .tx').allTextContents()).some((t) => t.includes('zona')))
  // buscador de campos
  await page.locator('.filter').fill('pool')
  const visible = await page.locator('.field:not(.group):not(.compact):visible').count()
  check('filtro de campos deja 1 visible', visible === 1, String(visible))
  await page.locator('.filter').fill('')

  /* 5 · archivo sin schema → modo crudo */
  await page.goto(base + '#/f/servicios/db/postgres.yaml')
  await page.waitForSelector('textarea.raw')
  check('sin schema: aviso + crudo', (await page.locator('.banner.info').first().textContent()).includes('schema'))
  const ta = page.locator('textarea.raw')
  await ta.fill((await ta.inputValue()).replace('200', '350'))
  await page.waitForSelector('.diff .dl.add')
  await page.locator('.toolbar .btn.primary').click()
  await page.waitForSelector('.banner.ok')
  check('crudo guardado', read('servicios/db/postgres.yaml').includes('max_connections: 350'))
  await ta.fill('a: [1, 2\nb: : :')
  await page.waitForSelector('.panel .banner.bad')
  check('YAML inválido bloquea guardar', await page.locator('.toolbar .btn.primary').isDisabled())

  /* 6 · modo formulario ⇄ YAML con cambios pendientes */
  await page.goto(base + '#/f/global.yaml')
  await page.waitForSelector('.form .field')
  await page.locator('.switch').first().click()
  await page.waitForSelector('.diff .dl.add')
  await page.locator('.seg-b:has-text("YAML")').click()
  await page.waitForSelector('textarea.raw')
  check('cambio del formulario llega al editor YAML', (await page.locator('textarea.raw').inputValue()).includes('modo_mantenimiento: true'))
  await page.locator('.seg-b:has-text("Formulario")').click()
  await page.waitForSelector('.form .field')
  check('…y vuelve al formulario', await page.locator('.switch').first().isChecked())

  /* 7 · navegación, favoritos y búsqueda del menú */
  await page.locator('button:has-text("Descartar")').click()
  await page.locator('.crumbs button:has-text("Inicio")').click()
  await page.waitForSelector('.card')
  await page.locator('#search').fill('alert')
  check('búsqueda: alertas + legacy', (await page.locator('#tree .row.file').count()) === 2, String(await page.locator('#tree .row.file').count()))
  await page.locator('#tree .star').first().click()
  await page.locator('#search').fill('')
  await page.locator('.tab[data-tab=fav]').click()
  check('favorito aparece en la pestaña', (await page.locator('#tree .row.file').count()) === 1)
  await page.screenshot({ path: path.join(SCRATCH, 'shot-home2.png') })

  /* 8 · móvil */
  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto(base + '#/f/servicios/web/app.yaml')
  await page.waitForSelector('.form .field')
  await page.waitForTimeout(500)
  await page.screenshot({ path: path.join(SCRATCH, 'shot-mobile.png') })
  check('móvil: sin desbordamiento horizontal', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  check('móvil: barra lateral oculta por defecto', (await page.locator('#sidebar').boundingBox()).x + (await page.locator('#sidebar').boundingBox()).width <= 1)
  await page.locator('#menu-toggle').click()
  await page.waitForTimeout(400)
  check('móvil: el botón ☰ muestra la barra lateral', (await page.locator('#sidebar').boundingBox()).x >= 0)
  await page.screenshot({ path: path.join(SCRATCH, 'shot-mobile-menu.png') })
} catch (e) {
  check('excepción en el flujo: ' + e.message.split('\n')[0], false)
}

check('sin errores de consola/JS', errors.length === 0, errors.join(' | '))
await browser.close()
server.close()
console.log(`Capturas de pantalla en ${SCRATCH}`)
const failed = results.filter((r) => !r.ok).length
console.log(`\n${results.length - failed}/${results.length} comprobaciones OK`)
process.exit(failed ? 1 : 0)
