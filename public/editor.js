import { h } from './widgets.js'
import { createForm, supportsForm } from './form.js'
import { api } from './api.js'
import { fmtDate } from './explorer.js'
import { motion, motionMessage, buttonContent } from './motion.js'

const MAX_DIFF_LINES = 500

function renderDiff(diff) {
  const box = h('div', { class: 'diff', role: 'group', 'aria-label': 'Diferencias en el archivo' })
  let shown = 0
  diff.hunks.forEach((hunk, i) => {
    if (i) box.append(h('div', { class: 'dsep', text: '⋯' }))
    for (const l of hunk) {
      if (++shown > MAX_DIFF_LINES) return
      const cls = l.t === '+' ? 'add' : l.t === '-' ? 'del' : 'ctx'
      box.append(h('div', { class: `dl ${cls}` }, h('span', { class: 'ln', text: String(l.o ?? '') }), h('span', { class: 'ln', text: String(l.n ?? '') }), h('span', { class: 'sg', text: l.t }), h('span', { class: 'tx', text: l.s })))
    }
  })
  if (shown > MAX_DIFF_LINES) box.append(h('div', { class: 'dsep', text: `… ${shown - MAX_DIFF_LINES} líneas más` }))
  return box
}

/**
 * Editor de un archivo. deps: { toast, onSaved(path), onCrumb(dir|null), toggleFav(path), isFav(path), showHistory(path, hash, reload) }
 */
export function createEditor(host, path, deps) {
  const st = { file: null, mode: null, form: null, rawEl: null, seq: 0, loadSeq: 0, disposed: false, saving: false, timer: null, pending: false, preview: null, conflict: false, notice: null, formOk: false, rawOk: false }
  const els = {}
  const dirty = () => st.saving || st.pending || Boolean(st.preview && !st.preview.unchanged)
  const notifyDirty = () => { if (!st.disposed) deps.onDirty?.(dirty()) }

  /* ───────── carga y construcción ───────── */
  async function load({ mode, notice = null, dataOverride = null } = {}) {
    if (st.disposed) return
    const request = ++st.loadSeq
    st.seq++
    clearTimeout(st.timer)
    st.pending = false
    st.preview = null
    notifyDirty()
    st.conflict = false
    st.notice = notice
    host.replaceChildren(motionMessage('loading', 'Abriendo archivo…', { loading: true }))
    let file
    try {
      file = await api.file(path)
    } catch (e) {
      if (st.disposed || request !== st.loadSeq) return
      host.replaceChildren(motionMessage('warning', `No se pudo abrir «${path}»: ${e.message}`), h('button', { class: 'btn small', text: 'Volver al inicio', onclick: () => deps.onCrumb(null) }))
      return
    }
    if (st.disposed || request !== st.loadSeq) return
    st.file = file
    st.formOk = Boolean(file.schema) && file.data !== null && !file.parseErrors.length && supportsForm(file.schema, file.data)
    st.rawOk = file.rawAllowed && file.raw !== null
    st.mode = mode === 'raw' && st.rawOk ? 'raw' : mode === 'form' && st.formOk ? 'form' : st.formOk ? 'form' : 'raw'
    build(dataOverride)
  }

  function build(dataOverride) {
    const f = st.file
    const dirs = f.path.split('/')
    const name = dirs.pop()
    els.fav = h('button', { class: 'star big', 'aria-label': 'Favorito', onclick: () => { deps.toggleFav(path); syncFav(true) } })
    syncFav()
    els.save = h('button', { class: 'btn primary', text: 'Guardar', disabled: true, onclick: save })
    els.discard = h('button', { class: 'btn', text: 'Descartar', disabled: true, onclick: discard })
    buttonContent(els.save, 'save', 'Guardar')
    buttonContent(els.discard, 'refresh', 'Descartar')
    els.status = h('span', { class: 'preview-status', role: 'status', 'aria-live': 'polite', hidden: true })
    els.banners = h('div', { class: 'banners' })
    els.panel = h('section', { class: 'panel', hidden: true })
    els.body = h('div', { class: 'editor-body' })
    els.filter = h('input', { type: 'search', class: 'ctl filter', placeholder: 'Filtrar campos…', 'aria-label': 'Filtrar campos', oninput: (e) => st.form?.filter(e.target.value) })

    const crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Ruta' }, h('button', { class: 'link', text: 'Inicio', onclick: () => deps.onCrumb(null) }))
    dirs.forEach((d, i) => crumbs.append(h('span', { text: '›' }), h('button', { class: 'link', text: d, onclick: () => deps.onCrumb(dirs.slice(0, i + 1).join('/')) })))
    crumbs.append(h('span', { text: '›' }), h('strong', { text: name }))

    const tabs = []
    if (st.formOk && st.rawOk) {
      tabs.push(h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Modo de edición' },
        h('button', { class: 'seg-b' + (st.mode === 'form' ? ' on' : ''), role: 'tab', 'aria-selected': String(st.mode === 'form'), text: 'Formulario', onclick: () => switchMode('form') }),
        h('button', { class: 'seg-b' + (st.mode === 'raw' ? ' on' : ''), role: 'tab', 'aria-selected': String(st.mode === 'raw'), text: 'YAML', onclick: () => switchMode('raw') })))
    }

    host.replaceChildren(
      crumbs,
      h('div', { class: 'ed-head' },
        h('div', {}, h('h1', { text: f.title || name }), f.description ? h('p', { class: 'hint', text: f.description }) : null,
          h('p', { class: 'meta' }, f.schema ? `Schema: ${f.schemaSource}` : 'Sin schema', ` · Modificado ${fmtDate(f.mtime)}`)),
        els.fav),
      h('div', { class: 'toolbar' }, ...tabs, st.mode === 'form' ? els.filter : null,
        h('span', { class: 'spacer' }),
        els.status,
        h('button', { class: 'btn motion-button', onclick: () => deps.showHistory(path, st.file.hash, () => load({ mode: st.mode, notice: 'Versión restaurada.' })) }, motion('history', { interactive: true }), 'Historial'),
        els.discard, els.save),
      els.banners, els.body, els.panel)

    if (st.mode === 'form') {
      st.form = createForm({ schema: f.schema, data: dataOverride ?? f.data, original: f.data, onChange: () => schedulePreview() })
      els.body.append(st.form.el)
      if (dataOverride) schedulePreview(0)
      else st.form.setErrors(f.errors)
    } else if (st.rawOk) {
      st.form = null
      st.rawEl = h('textarea', { class: 'raw mono', spellcheck: 'false', wrap: 'off', 'aria-label': 'Contenido YAML', oninput: () => schedulePreview() })
      st.rawEl.value = typeof dataOverride === 'string' ? dataOverride : f.raw
      els.body.append(st.rawEl)
    } else els.body.append(motionMessage('warning', 'No hay un modo de edición disponible para este archivo (contiene campos secretos y el formulario no lo soporta).'))
    renderBanners()
    if (st.mode === 'raw' && typeof dataOverride === 'string') schedulePreview(0)
    else if (st.mode === 'form' && !dataOverride) renderPanel(null)
  }

  const syncFav = (animate = false) => {
    const on = deps.isFav(path)
    els.fav.replaceChildren(motion('favorite', { interactive: true, autoplay: animate && on }))
    els.fav.classList.toggle('on', on)
    els.fav.setAttribute('aria-pressed', String(on))
    els.fav.title = on ? 'Quitar de favoritos' : 'Marcar como favorito'
    els.fav.setAttribute('aria-label', els.fav.title)
  }

  /* ───────── avisos ───────── */
  function renderBanners() {
    const f = st.file
    const add = (cls, ...kids) => els.banners.append(h('div', { class: `banner ${cls} banner-content` }, motion(cls === 'ok' ? 'success' : cls === 'bad' || cls === 'warn' ? 'warning' : 'info', { autoplay: cls !== 'info' }), h('div', { class: 'banner-copy' }, ...kids)))
    els.banners.replaceChildren()
    if (st.notice) add('ok', st.notice)
    if (st.conflict) add('bad', 'El archivo cambió en disco mientras lo editabas. Para no pisar esos cambios, no se puede guardar. ', h('button', { class: 'btn small', text: 'Recargar desde disco', onclick: () => load({ mode: st.mode }) }))
    if (f.readonly) add('warn', 'Archivo de solo lectura: puedes probar cambios y ver el diff, pero no guardarlos.')
    if (f.parseErrors.length) add('bad', `El YAML tiene errores de sintaxis: ${f.parseErrors.slice(0, 3).map((e) => (e.line ? `línea ${e.line}: ` : '') + e.message).join(' · ')}. Corrígelo en modo YAML.`)
    for (const w of f.warnings) add('info', w)
    if (!f.schema && !f.parseErrors.length) add('info', `Este archivo no tiene schema, así que se edita como texto. Para obtener un formulario, añade «${f.path.split('/').pop().replace(/\.ya?ml$/i, '')}.schema.json» junto al archivo o una primera línea «# yaml-language-server: $schema=./ruta.json».`)
    if (!f.rawAllowed && st.formOk) add('info', 'Contiene campos secretos: el modo YAML crudo está desactivado para no mostrarlos.')
    if (!f.roundtripStable && st.mode === 'form') add('info', 'Al guardar, el formato de algunas líneas que no edites podría normalizarse. Revisa «Cambios» antes de guardar.')
  }

  /* ───────── vista previa / validación ───────── */
  const currentBody = () => ({ path, baseHash: st.file.hash, ...(st.mode === 'raw' ? { raw: st.rawEl.value } : { data: st.form.getData() }) })

  function schedulePreview(delay = 350) {
    if (st.saving || st.disposed) return
    st.seq++
    st.pending = true
    notifyDirty()
    els.save.disabled = true
    els.discard.disabled = false
    previewStatus('loading', 'Validando…')
    clearTimeout(st.timer)
    st.timer = setTimeout(runPreview, delay)
  }

  async function runPreview() {
    if (st.disposed || st.saving) return
    const seq = ++st.seq
    let res
    try {
      res = await api.preview(currentBody())
    } catch (e) {
      if (seq !== st.seq) return
      st.pending = false
      previewStatus('warning', 'No se pudo validar')
      if (e.status === 409) {
        st.conflict = true
        renderBanners()
      }
      st.preview = { unchanged: false, valid: false, errors: [], parseErrors: [], warnings: [], failure: e.message }
      notifyDirty()
      renderPanel(st.preview)
      return
    }
    if (seq !== st.seq) return
    st.pending = false
    st.preview = res
    notifyDirty()
    const unplaced = st.form ? st.form.setErrors(res.errors) : res.errors
    renderPanel(res, unplaced)
  }

  const canSave = () => !st.saving && !st.disposed && !st.file.readonly && !st.conflict && !st.pending && st.preview && !st.preview.unchanged && !st.preview.failure && !st.preview.parseErrors.length && (!st.preview.errors.length || els.allow?.checked)

  function previewStatus(name, text) {
    if (els.status.dataset.kind === name && els.status.textContent === text) return
    els.status.dataset.kind = name
    els.status.hidden = false
    els.status.className = `preview-status ${name === 'success' ? 'ok' : name === 'warning' ? 'warn' : ''}`
    els.status.replaceChildren(motion(name, { autoplay: true, loop: name === 'loading' }), h('span', { text }))
  }

  function renderPanel(res, unplaced = []) {
    const p = els.panel
    p.replaceChildren()
    els.allow = null
    if (!res) {
      p.hidden = true
      els.save.disabled = true
      buttonContent(els.save, 'save', 'Guardar')
      els.discard.disabled = true
      return
    }
    p.hidden = false
    const n = res.changeCount
    buttonContent(els.save, 'save', res.unchanged ? 'Guardar' : n ? `Guardar (${n} cambio${n === 1 ? '' : 's'})` : 'Guardar')
    els.discard.disabled = res.unchanged
    const invalid = st.conflict || res.failure || res.parseErrors?.length || res.errors?.length
    previewStatus(invalid ? 'warning' : 'success', invalid ? 'Revisar cambios' : res.unchanged ? 'Sin cambios' : 'Validado')
    const head = h('div', { class: 'panel-head' }, h('strong', { text: res.unchanged ? 'Sin cambios' : 'Cambios' }), res.unchanged || !res.diff ? null : h('span', { class: 'hint', text: `+${res.diff.added} −${res.diff.removed} líneas` }))
    p.append(head)
    if (res.failure) p.append(h('div', { class: 'banner bad' }, res.failure))
    if (res.parseErrors?.length) p.append(h('div', { class: 'banner bad' }, `YAML inválido: ${res.parseErrors.slice(0, 3).map((e) => (e.line ? `línea ${e.line}: ` : '') + e.message).join(' · ')}`))
    if (res.errors?.length) {
      const list = h('ul', { class: 'errors' })
      for (const e of res.errors) list.append(h('li', {}, h('button', { class: 'link', text: e.path.join(' › ') || '(documento)', onclick: () => st.form?.focusPath(e.path) }), ` — ${e.message}`))
      els.allow = h('input', { type: 'checkbox', onchange: () => (els.save.disabled = !canSave()) })
      p.append(h('div', { class: 'banner warn' }, h('strong', { text: `${res.errors.length} problema${res.errors.length === 1 ? '' : 's'} con el schema` }), list,
        h('label', { class: 'check' }, els.allow, ' Guardar de todos modos (no recomendado)')))
    }
    for (const w of res.warnings || []) p.append(h('div', { class: 'banner info' }, w))
    if (res.restartRequired && !res.unchanged) p.append(h('div', { class: 'banner info' }, 'Este cambio requiere reiniciar o recargar el servicio que usa el archivo.'))
    if (!res.unchanged && res.diff) p.append(renderDiff(res.diff))
    els.save.disabled = !canSave()
  }

  /* ───────── acciones ───────── */
  async function flushPreview() {
    if (st.pending) {
      clearTimeout(st.timer)
      await runPreview()
    }
    return st.preview
  }

  async function switchMode(mode) {
    if (st.saving || mode === st.mode) return
    const res = await flushPreview()
    if (mode === 'raw') {
      const text = res && !res.unchanged && !res.failure && res.text != null ? res.text : st.file.raw
      return load({ mode: 'raw', dataOverride: text === st.file.raw ? null : text })
    }
    if (res?.parseErrors?.length || res?.failure) return deps.toast('Corrige el YAML antes de volver al formulario.', 'bad')
    const data = res && !res.unchanged ? res.data : null
    return load({ mode: 'form', dataOverride: data })
  }

  function discard() {
    if (st.saving) return
    if (st.preview && !st.preview.unchanged && !confirm('¿Descartar los cambios sin guardar?')) return
    load({ mode: st.mode })
  }

  async function save() {
    if (!canSave()) return
    st.saving = true
    notifyDirty()
    st.seq++
    els.save.disabled = true
    els.discard.disabled = true
    els.body.inert = true
    host.querySelectorAll('.seg-b').forEach((button) => { button.disabled = true })
    buttonContent(els.save, 'save', 'Guardando…', { busy: true })
    try {
      const r = await api.save({ ...currentBody(), allowInvalid: Boolean(els.allow?.checked) })
      if (st.disposed) return
      deps.toast(r.unchanged ? 'No había cambios que guardar.' : 'Guardado.', 'ok')
      deps.onSaved(path)
      const extra = r.restartRequired ? ' Este cambio requiere reiniciar o recargar el servicio que usa el archivo.' : ''
      const atomic = r.atomic === false ? ' (el archivo está montado individualmente: se sobrescribió en sitio, no de forma atómica).' : ''
      await load({ mode: st.mode, notice: r.unchanged ? null : `Guardado correctamente.${extra}${atomic}` })
    } catch (e) {
      if (st.disposed) return
      if (e.status === 409) {
        st.conflict = true
        renderBanners()
      } else if (e.code === 'SCHEMA_INVALID' && e.data?.errors) {
        st.preview = { ...(st.preview || {}), errors: e.data.errors, unchanged: false, parseErrors: [], warnings: [], diff: st.preview?.diff ?? { hunks: [], added: 0, removed: 0 }, changeCount: st.preview?.changeCount }
        renderPanel(st.preview, st.form ? st.form.setErrors(e.data.errors) : e.data.errors)
      } else deps.toast(e.message, 'bad')
    } finally {
      st.saving = false
      notifyDirty()
      if (!st.disposed && els.save.isConnected) {
        els.body.inert = false
        host.querySelectorAll('.seg-b').forEach((button) => { button.disabled = false })
        renderPanel(st.preview)
      }
    }
  }

  load()
  return {
    path,
    save,
    isDirty: dirty,
    isBusy: () => st.saving,
    destroy: () => {
      clearTimeout(st.timer)
      st.seq++
      st.loadSeq++
      st.disposed = true
    },
  }
}
