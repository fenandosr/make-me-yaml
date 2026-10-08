import { h, put } from './widgets.js'
import { motion, motionMessage } from './motion.js'

const STATUS = {
  ok: { text: 'válido', cls: 'ok' },
  invalid: { text: 'con errores', cls: 'warn' },
  noschema: { text: 'sin schema', cls: 'muted' },
  parse_error: { text: 'YAML inválido', cls: 'bad' },
  schema_error: { text: 'schema roto', cls: 'bad' },
  error: { text: 'error', cls: 'bad' },
}

export function statusBadge(f) {
  const s = STATUS[f.status] ?? STATUS.error
  const n = f.status === 'invalid' || f.status === 'parse_error' ? ` (${f.errorCount})` : ''
  return h('span', { class: `badge ${s.cls}`, title: f.error || '' }, s.text + n)
}

export const fmtDate = (ms) =>
  ms ? new Date(ms).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

/** Puntuación difusa: todas las palabras deben aparecer (como subcadena o subsecuencia). */
export function score(query, f) {
  const hay = `${f.path} ${f.title ?? ''} ${f.description ?? ''} ${f.group ?? ''}`.toLowerCase()
  const near = `${f.path} ${f.title ?? ''}`.toLowerCase() // la tolerancia a erratas solo aplica al nombre y título
  let total = 0
  for (const term of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const at = hay.indexOf(term)
    if (at >= 0) {
      total += 100 - Math.min(at, 90)
      continue
    }
    if (term.length < 3) return -1
    // subsecuencia compacta (p. ej. «ngnx» → nginx): las letras deben aparecer muy juntas
    let i = 0
    let first = -1
    let last = -1
    for (const ch of term) {
      const j = near.indexOf(ch, i)
      if (j < 0) return -1
      if (first < 0) first = j
      last = j
      i = j + 1
    }
    if (last - first + 1 > term.length + 2) return -1
    total += 20 - (last - first + 1 - term.length)
  }
  return total
}

function buildTree(files) {
  const root = { dirs: new Map(), files: [] }
  for (const f of files) {
    let node = root
    if (f.dir)
      for (const part of f.dir.split('/')) {
        if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] })
        node = node.dirs.get(part)
      }
    node.files.push(f)
  }
  return root
}

const countFiles = (n) => n.files.length + [...n.dirs.values()].reduce((a, d) => a + countFiles(d), 0)

function fileRow(S, f, hd, { showPath = false } = {}) {
  const fav = S.favs.has(f.path)
  return h(
    'div',
    { class: 'rowwrap' },
    h(
      'button',
      { class: 'row file' + (S.current === f.path ? ' active' : ''), role: 'treeitem', 'data-path': f.path, onclick: () => hd.open(f.path), title: f.description || f.path },
      h('span', { class: 'name' }, h('span', { class: 't', text: f.title || f.name }), h('span', { class: 's', text: showPath || f.title ? f.path : (f.description ?? '') })),
      f.readonly ? h('span', { class: 'lock', title: 'Solo lectura', text: '🔒' }) : null,
      statusBadge(f),
    ),
    h('button', { class: 'star' + (fav ? ' on' : ''), title: fav ? 'Quitar de favoritos' : 'Marcar como favorito', 'aria-label': fav ? 'Quitar de favoritos' : 'Marcar como favorito', 'aria-pressed': String(fav), 'data-favorite': f.path, onclick: () => hd.toggleFav(f.path) }, motion('favorite', { interactive: true })),
  )
}

function renderTreeNode(S, node, prefix, hd) {
  const out = []
  for (const [name, child] of [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const path = prefix ? `${prefix}/${name}` : name
    const open = S.open.has(path)
    const meta = S.folders[path]
    out.push(
      h(
        'button',
        { class: 'row folder', role: 'treeitem', 'aria-expanded': String(open), 'data-folder': path, title: meta?.description || path, onclick: () => hd.toggleFolder(path) },
        h('span', { class: 'chev', text: open ? '▾' : '▸' }),
        h('span', { class: 'name' }, h('span', { class: 't', text: meta?.title || name }), meta?.title && meta.title !== name ? h('span', { class: 's', text: name }) : null),
        h('span', { class: 'count', text: String(countFiles(child)) }),
      ),
    )
    if (open) out.push(h('div', { class: 'children', role: 'group' }, ...renderTreeNode(S, child, path, hd)))
  }
  for (const f of node.files.sort((a, b) => a.name.localeCompare(b.name))) out.push(fileRow(S, f, hd))
  return out
}

/** Lista de archivos de la barra lateral según pestaña, búsqueda y vista. */
export function renderSidebar(S, hd) {
  const tree = document.getElementById('tree')
  tree.replaceChildren()
  if (S.loading && !S.files.length) return tree.append(motionMessage('loading', 'Cargando archivos…', { compact: true, loading: true }))
  if (S.loadError && !S.files.length) return tree.append(motionMessage('warning', 'No se pudo leer la carpeta. Vuelve a intentarlo con el botón Actualizar.', { compact: true }))
  const q = S.query.trim()
  let list = null
  if (q) {
    list = S.files
      .map((f) => [score(q, f), f])
      .filter(([s]) => s >= 0)
      .sort((a, b) => b[0] - a[0])
      .map(([, f]) => f)
  } else if (S.tab === 'recent') list = S.recents.map((p) => S.byPath.get(p)).filter(Boolean)
  else if (S.tab === 'fav') list = [...S.favs].map((p) => S.byPath.get(p)).filter(Boolean)
  else if (S.view === 'list') list = [...S.files].sort((a, b) => a.path.localeCompare(b.path))

  if (list) {
    if (!list.length) tree.append(motionMessage(q ? 'search' : S.tab === 'fav' ? 'favorite' : S.tab === 'recent' ? 'history' : 'document', q ? 'Sin coincidencias.' : S.tab === 'fav' ? 'Aún no hay favoritos (usa ☆).' : S.tab === 'recent' ? 'Aún no abriste archivos.' : 'No hay archivos.', { compact: true }))
    for (const f of list) tree.append(fileRow(S, f, hd, { showPath: true }))
    return
  }
  if (!S.files.length) return tree.append(motionMessage('document', 'No se encontraron archivos YAML en la carpeta raíz.', { compact: true }))
  tree.append(...renderTreeNode(S, buildTree(S.files), '', hd))
}

/** Menú de inicio: tarjetas agrupadas según el manifiesto o la estructura de carpetas. */
export function renderHome(S, hd) {
  const home = document.getElementById('home')
  home.replaceChildren()
  if (S.loading && !S.files.length) return home.append(motionMessage('loading', 'Cargando configuración…', { loading: true }))
  if (S.loadError) {
    home.append(h('div', { class: 'banner bad banner-content' }, motion('warning', { autoplay: true }), h('span', { text: `No se pudo leer la lista de archivos: ${S.loadError}` })))
    if (!S.files.length) return
  }
  const card = (f) =>
    h(
      'article',
      { class: 'card', tabindex: '0', role: 'button', onclick: () => hd.open(f.path), onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), hd.open(f.path)) },
      h('div', { class: 'card-top' }, h('div', { class: 'card-title' }, motion('document', { interactive: true }), h('strong', { text: f.title || f.name })), S.favs.has(f.path) ? h('span', { class: 'fav', text: '★' }) : null),
      f.description ? h('p', { class: 'desc', text: f.description }) : null,
      h('div', { class: 'card-meta' }, h('code', { text: f.path }), f.readonly ? h('span', { text: '🔒' }) : null, statusBadge(f)),
      h('div', { class: 'card-foot', text: `Modificado ${fmtDate(f.mtime)}` }),
    )
  const section = (title, files, sub) =>
    files.length
      ? h('section', { class: 'home-group' }, h('h2', { text: title }), sub ? h('p', { class: 'hint', text: sub }) : null, h('div', { class: 'cards' }, ...files.map(card)))
      : null

  const groups = new Map()
  for (const f of S.files) {
    const top = f.dir.split('/')[0]
    const key = f.group || (top ? S.folders[top]?.title || top : 'General')
    const sub = f.group ? null : top ? S.folders[top]?.description : null
    if (!groups.has(key)) groups.set(key, { files: [], sub })
    groups.get(key).files.push(f)
  }
  const invalid = S.files.filter((f) => ['invalid', 'parse_error', 'schema_error', 'error'].includes(f.status)).length
  put(
    home,
    h('div', { class: 'home-head home-heading' }, motion('document', { size: 'small', autoplay: true }), h('div', {}, h('h1', { class: 'display', text: 'Configuración' }), h('p', { class: 'hint', text: `${S.files.length} archivo${S.files.length === 1 ? '' : 's'} en «${S.root}»${invalid ? ` · ${invalid} con problemas` : ''}` }))),
    section('Favoritos', [...S.favs].map((p) => S.byPath.get(p)).filter(Boolean)),
    section('Recientes', S.recents.map((p) => S.byPath.get(p)).filter(Boolean).slice(0, 6)),
    ...[...groups.entries()].map(([title, g]) => section(title, g.files, g.sub)),
    !S.files.length ? motionMessage('document', 'No se encontraron archivos YAML en la carpeta raíz.') : null,
  )
}
