import { h } from './widgets.js'
import { motion, motionMessage, buttonContent } from './motion.js'

const native = window.go.main.App

export function unwrap(response) {
  if (response.status >= 400) {
    const error = new Error(response.data?.message || 'No se pudo completar la operación.')
    error.status = response.status
    error.code = response.data?.error
    error.data = response.data
    throw error
  }
  return response.data
}

export async function chooseWorkspace() {
  const host = document.getElementById('workspace-start')
  host.hidden = false
  let selection = null
  let revision = 0
  let busy = false
  const folder = h('button', { class: 'btn primary', type: 'button', onclick: pickFolder })
  buttonContent(folder, 'document', 'Elegir carpeta')
  const manifest = h('button', { class: 'btn', type: 'button', onclick: pickManifest })
  buttonContent(manifest, 'document', 'Elegir manifiesto…')
  const pathInput = h('input', { class: 'ctl mono', type: 'text', placeholder: '/ruta/a/configuración', 'aria-label': 'Ruta de la carpeta', autocomplete: 'off', spellcheck: 'false', oninput: invalidate })
  const mode = h('select', { class: 'ctl', 'aria-label': 'Cómo buscar los archivos', onchange: invalidate },
    h('option', { value: 'auto', text: 'Usar manifiesto si existe; si no, descubrir YAML' }),
    h('option', { value: 'discover', text: 'Descubrir YAML sin usar un manifiesto' }))
  const inspect = h('button', { class: 'btn', type: 'button', text: 'Revisar carpeta', onclick: () => review({ directory: pathInput.value.trim(), mode: mode.value, manifestName: 'editor.manifest.yaml' }) })
  const result = h('div', { class: 'workspace-result', 'aria-live': 'polite' })
  const open = h('button', { class: 'btn primary', type: 'button', disabled: true, onclick: enter })
  buttonContent(open, 'document', 'Abrir configuración')
  const controls = [folder, manifest, pathInput, mode, inspect]
  const setBusy = (value) => { busy = value; controls.forEach((el) => { el.disabled = value }); open.disabled = value || !selection }

  function invalidate() {
    revision++
    selection = null
    result.replaceChildren()
    open.disabled = true
  }

  async function review(candidate) {
    const request = ++revision
    selection = null
    setBusy(true)
    result.replaceChildren(motionMessage('loading', 'Buscando archivos YAML…', { compact: true, loading: true }))
    try {
      const info = unwrap(await native.InspectWorkspace(candidate))
      if (request !== revision) return
      selection = { directory: info.directory, mode: info.mode, manifestName: info.manifestName }
      pathInput.value = info.directory
      mode.value = info.mode === 'manifest' ? 'auto' : info.mode
      result.replaceChildren(h('div', { class: 'workspace-summary' },
        motion(info.count ? 'success' : 'document', { size: 'small', autoplay: true }),
        h('div', {}, h('strong', { text: `${info.count} archivo${info.count === 1 ? '' : 's'} YAML encontrado${info.count === 1 ? '' : 's'}` }),
          h('p', { class: 'hint', text: info.source === 'manifest' ? `Manifiesto: ${info.manifestName}` : 'Descubrimiento recursivo desde la carpeta elegida.' }),
          info.invalid ? h('p', { class: 'hint', text: `${info.invalid} archivo${info.invalid === 1 ? '' : 's'} con problemas para revisar en el editor.` }) : null,
          !info.count ? h('p', { class: 'hint', text: 'Puedes abrir esta carpeta vacía y actualizarla después de añadir archivos.' }) : null)))
    } catch (error) {
      result.replaceChildren(h('div', { class: 'banner bad banner-content', role: 'alert' }, motion('warning', { autoplay: true }), h('span', { text: String(error.message || error) })))
    } finally {
      if (request === revision) setBusy(false)
    }
  }

  async function pickFolder() {
    if (busy) return
    setBusy(true)
    try {
      const directory = await native.ChooseDirectory()
      if (directory) await review({ directory, mode: mode.value, manifestName: 'editor.manifest.yaml' })
    } catch (error) { result.replaceChildren(h('p', { class: 'banner bad', text: String(error.message || error) })) }
    finally { setBusy(false) }
  }

  async function pickManifest() {
    if (busy) return
    setBusy(true)
    try {
      const choice = await native.ChooseManifest()
      if (choice?.directory) await review(choice)
    } catch (error) { result.replaceChildren(h('p', { class: 'banner bad', text: String(error.message || error) })) }
    finally { setBusy(false) }
  }

  async function enter() {
    if (!selection || busy) return
    setBusy(true)
    buttonContent(open, 'document', 'Abriendo…', { busy: true })
    try {
      window.yamlWorkspace = unwrap(await native.OpenWorkspace(selection))
      try { localStorage.setItem('yamled.lastWorkspace', JSON.stringify(selection)) } catch { /* opcional */ }
      // Una nueva raíz siempre empieza en Inicio, sin rutas heredadas de otra carpeta.
      history.replaceState(null, '', location.pathname)
      await native.SetDirty(false)
      await import('./app.js')
      host.hidden = true
      host.replaceChildren()
      document.getElementById('app').hidden = false
    } catch (error) {
      result.replaceChildren(h('p', { class: 'banner bad', role: 'alert', text: String(error.message || error) }))
      setBusy(false)
      buttonContent(open, 'document', 'Abrir configuración')
    }
  }

  let last = null
  try { last = JSON.parse(localStorage.getItem('yamled.lastWorkspace')) } catch { /* opcional */ }
  const recent = last?.directory ? h('button', { class: 'workspace-recent', type: 'button', onclick: () => { if (!busy) review(last) } },
    motion('history', { interactive: true }), h('span', {}, h('strong', { text: 'Volver a la última carpeta' }), h('span', { class: 'mono', text: last.directory }))) : null
  if (recent) controls.push(recent)
  host.replaceChildren(h('main', { class: 'workspace-card' },
    h('div', { class: 'workspace-brand' }, h('img', { src: 'brand/logo.webp', alt: 'Make Me YAML!', width: 176, height: 191 })),
    h('h1', { class: 'display', text: '¿Dónde está tu configuración?' }),
    h('p', { class: 'workspace-intro', text: 'Elige una carpeta para empezar. Buscaremos su manifiesto o descubriremos los archivos YAML dentro de ella y sus subcarpetas.' }),
    h('div', { class: 'workspace-options' }, folder, manifest),
    h('label', { class: 'workspace-label' }, 'Carpeta', pathInput),
    h('label', { class: 'workspace-label' }, 'Cómo abrirla', mode),
    h('div', { class: 'workspace-review' }, inspect, h('span', { class: 'hint', text: 'Manifiesto predeterminado: editor.manifest.yaml' })),
    result,
    h('div', { class: 'workspace-footer' }, h('p', { class: 'hint', text: 'Revisar la carpeta no modifica tus archivos.' }), open),
    recent))
}
