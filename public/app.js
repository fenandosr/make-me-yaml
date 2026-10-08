import { api } from './api.js'
import { h } from './widgets.js'
import { renderSidebar, renderHome, fmtDate } from './explorer.js'
import { createEditor } from './editor.js'
import { motion, motionMessage, buttonContent } from './motion.js'

const $ = (id) => document.getElementById(id)
const storagePrefix = window.yamlWorkspace ? `yamled.workspace.${encodeURIComponent(window.yamlWorkspace.directory)}.` : 'yamled.'

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem(storagePrefix + k)
      return v == null ? d : JSON.parse(v)
    } catch {
      return d
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(storagePrefix + k, JSON.stringify(v))
    } catch {
      /* almacenamiento no disponible: se pierde solo la comodidad */
    }
  },
}

const S = {
  root: '',
  folders: {},
  files: [],
  byPath: new Map(),
  query: '',
  tab: 'all',
  view: store.get('view', 'tree'),
  current: null,
  recents: store.get('recents', []),
  favs: new Set(store.get('favs', [])),
  open: new Set(store.get('open', [])),
  openInit: store.get('open', null) !== null,
  loading: false,
  loadError: null,
}
let editor = null
let lastHash = ''
let suppress = false

/* ───────── utilidades ───────── */
function toast(msg, kind = '') {
  const t = $('toast')
  t.replaceChildren(motion(kind === 'bad' ? 'warning' : kind === 'ok' ? 'success' : 'info', { autoplay: true }), h('span', { text: msg }))
  t.className = `toast ${kind}`
  t.hidden = false
  clearTimeout(toast.timer)
  toast.timer = setTimeout(() => { t.hidden = true; t.replaceChildren() }, 4000)
}

const hashPath = () => {
  const m = /^#\/f\/(.+)$/.exec(location.hash)
  try {
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}
const navigate = (path) => (location.hash = path ? '#/f/' + encodeURIComponent(path).replace(/%2F/g, '/') : '#/')

/* ───────── datos ───────── */
async function loadFiles() {
  if (S.loading) return false
  S.loading = true
  S.loadError = null
  $('refresh').disabled = true
  buttonContent($('refresh'), 'refresh', '', { busy: true })
  render()
  try {
    const d = await api.files()
    S.root = d.root
    S.folders = d.folders || {}
    S.files = d.files
    S.byPath = new Map(d.files.map((f) => [f.path, f]))
    S.recents = S.recents.filter((p) => S.byPath.has(p))
    S.favs = new Set([...S.favs].filter((p) => S.byPath.has(p)))
    if (!S.openInit) {
      for (const f of S.files) {
        const parts = f.dir ? f.dir.split('/') : []
        parts.forEach((_, i) => S.open.add(parts.slice(0, i + 1).join('/')))
      }
      S.openInit = true
      store.set('open', [...S.open])
    }
  } catch (e) {
    S.loadError = e.message
    if (S.current) toast(`No se pudo actualizar la lista: ${e.message}`, 'bad')
  } finally {
    S.loading = false
    $('refresh').disabled = false
    buttonContent($('refresh'), 'refresh', '')
    render()
  }
  return !S.loadError
}

function render() {
  renderSidebar(S, handlers)
  if (!S.current) renderHome(S, handlers)
}

/* ───────── interacciones del explorador ───────── */
const handlers = {
  open: navigate,
  toggleFav(path) {
    const fromSidebar = $('tree').contains(document.activeElement)
    S.favs.has(path) ? S.favs.delete(path) : S.favs.add(path)
    store.set('favs', [...S.favs])
    render()
    const favorite = $('tree').querySelector(`[data-favorite="${CSS.escape(path)}"]`)
    if (fromSidebar) favorite?.focus({ preventScroll: true })
    if (S.favs.has(path)) favorite?.querySelector('yaml-motion')?.replay()
  },
  toggleFolder(path) {
    S.open.has(path) ? S.open.delete(path) : S.open.add(path)
    store.set('open', [...S.open])
    renderSidebar(S, handlers)
    $('tree').querySelector(`[data-folder="${CSS.escape(path)}"]`)?.focus()
  },
}

function revealFolder(dir) {
  S.tab = 'all'
  S.query = ''
  $('search').value = ''
  S.view = 'tree'
  $('view').value = 'tree'
  dir.split('/').forEach((_, i, a) => S.open.add(a.slice(0, i + 1).join('/')))
  store.set('open', [...S.open])
  syncTabs()
  renderSidebar(S, handlers)
  $('app').classList.add('show-side')
  const row = $('tree').querySelector(`[data-folder="${CSS.escape(dir)}"]`)
  row?.scrollIntoView({ block: 'center' })
  row?.focus()
}

function syncTabs() {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === S.tab))
}

/* ───────── navegación entre inicio y editor ───────── */
const deps = {
  toast,
  onDirty: (dirty) => window.go?.main?.App.SetDirty(dirty).catch(() => {}),
  onSaved: () => loadFiles(),
  onCrumb: (dir) => (dir === null ? navigate(null) : revealFolder(dir)),
  toggleFav: (p) => handlers.toggleFav(p),
  isFav: (p) => S.favs.has(p),
  showHistory,
}

function show(path) {
  editor?.destroy()
  editor = null
  deps.onDirty(false)
  S.current = path
  lastHash = location.hash
  $('app').classList.remove('show-side')
  $('home').hidden = Boolean(path)
  $('editor').hidden = !path
  if (path) {
    $('home').replaceChildren()
    S.recents = [path, ...S.recents.filter((p) => p !== path)].slice(0, 8)
    store.set('recents', S.recents)
    editor = createEditor($('editor'), path, deps)
  } else {
    $('editor').replaceChildren()
    renderHome(S, handlers)
  }
  renderSidebar(S, handlers)
  $('main').scrollTo?.(0, 0)
}

window.addEventListener('hashchange', () => {
  if (suppress) {
    suppress = false
    return
  }
  const next = hashPath()
  if (editor?.isDirty() && next !== S.current && !confirm('Hay cambios sin guardar en este archivo. ¿Salir y descartarlos?')) {
    suppress = true
    location.hash = lastHash
    return
  }
  show(next)
})

window.addEventListener('beforeunload', (e) => {
  if (editor?.isDirty()) {
    e.preventDefault()
    e.returnValue = ''
  }
})

/* ───────── historial ───────── */
let historyRequest = 0
$('history-dialog').addEventListener('close', () => {
  historyRequest++
  $('history-list').replaceChildren()
})
async function showHistory(path, hash, onRestored) {
  const request = ++historyRequest
  const dlg = $('history-dialog')
  const list = $('history-list')
  list.replaceChildren(motionMessage('loading', 'Cargando historial…', { compact: true, loading: true }))
  dlg.showModal()
  try {
    const { versions } = await api.history(path)
    if (request !== historyRequest || !dlg.open) return
    list.replaceChildren()
    if (!versions.length) list.append(motionMessage('history', 'Aún no hay versiones: se crean al guardar.'))
    for (const v of versions) {
      const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/.exec(v.version)
      const when = m ? fmtDate(Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`)) : v.version
      list.append(
        h('div', { class: 'hist-row' }, h('span', { text: when }), h('span', { class: 'hint', text: `${v.size} bytes` }),
          h('button', {
            type: 'button',
            class: 'btn small motion-button',
            onclick: async (event) => {
              if (!confirm(`¿Restaurar la versión del ${when}? La versión actual se conserva en el historial.`)) return
              const button = event.currentTarget
              const buttons = [...list.querySelectorAll('button')]
              buttons.forEach((b) => { b.disabled = true })
              buttonContent(button, 'history', 'Restaurando…', { busy: true })
              try {
                await api.restore({ path, baseHash: hash, version: v.version })
                dlg.close()
                toast('Versión restaurada.', 'ok')
                loadFiles()
                if (S.current === path) onRestored()
              } catch (e) {
                toast(e.status === 409 ? 'El archivo cambió en disco; recárgalo antes de restaurar.' : e.message, 'bad')
              } finally {
                buttons.forEach((b) => { b.disabled = false })
                buttonContent(button, 'history', 'Restaurar')
              }
            },
          }, motion('history', { interactive: true }), ' Restaurar')),
      )
    }
  } catch (e) {
    if (request === historyRequest && dlg.open) list.replaceChildren(motionMessage('warning', e.message))
  }
}

/* ───────── barra lateral ───────── */
$('search').addEventListener('input', (e) => {
  S.query = e.target.value
  renderSidebar(S, handlers)
})
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.target.value = ''
    S.query = ''
    renderSidebar(S, handlers)
  } else if (e.key === 'ArrowDown') {
    e.preventDefault()
    $('tree').querySelector('.row')?.focus()
  } else if (e.key === 'Enter') {
    const first = $('tree').querySelector('.row.file')
    if (first) first.click()
  }
})
document.querySelectorAll('.tab').forEach((b) =>
  b.addEventListener('click', () => {
    S.tab = b.dataset.tab
    syncTabs()
    renderSidebar(S, handlers)
  }),
)
$('view').value = S.view
$('view').addEventListener('change', (e) => {
  S.view = e.target.value
  store.set('view', S.view)
  renderSidebar(S, handlers)
})
$('home-btn').addEventListener('click', () => navigate(null))
$('refresh').addEventListener('click', async () => {
  if (await loadFiles()) toast('Lista actualizada.', 'ok')
})
$('menu-toggle').addEventListener('click', () => $('app').classList.toggle('show-side'))

$('tree').addEventListener('keydown', (e) => {
  const rows = [...$('tree').querySelectorAll('.row')]
  const i = rows.indexOf(document.activeElement)
  if (i < 0) return
  const row = rows[i]
  if (e.key === 'ArrowDown') rows[i + 1]?.focus()
  else if (e.key === 'ArrowUp') (i === 0 ? $('search') : rows[i - 1]).focus()
  else if (e.key === 'ArrowRight' && row.classList.contains('folder') && row.getAttribute('aria-expanded') === 'false') row.click()
  else if (e.key === 'ArrowLeft' && row.classList.contains('folder') && row.getAttribute('aria-expanded') === 'true') row.click()
  else return
  e.preventDefault()
})

document.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)
  const mod = e.ctrlKey || e.metaKey
  if ((e.key === '/' && !typing) || (mod && e.key.toLowerCase() === 'k')) {
    e.preventDefault()
    $('app').classList.add('show-side')
    $('search').focus()
    $('search').select()
  } else if (mod && e.key.toLowerCase() === 's' && editor) {
    e.preventDefault()
    editor.save()
  }
})

/* ───────── arranque ───────── */
if (window.yamlWorkspace) {
  const change = $('change-workspace')
  change.hidden = false
  change.title = window.yamlWorkspace.directory
  buttonContent(change, 'document', 'Cambiar carpeta')
  change.addEventListener('click', async () => {
    if (editor?.isBusy()) return toast('Espera a que termine el guardado.')
    if (editor?.isDirty() && !confirm('Hay cambios sin guardar. ¿Descartarlos y elegir otra carpeta?')) return
    editor?.destroy()
    editor = null
    await window.go.main.App.SetDirty(false)
    location.reload()
  })
}
$('refresh').setAttribute('aria-label', 'Actualizar archivos')
await loadFiles()
const initial = hashPath()
if (initial) show(initial)
else show(null)
