import { h, put, leafFor } from './widgets.js'
import { isObj, deepEqual, getAt, setAt, makeResolver, kindOf, defaultFor, matchVariant } from './schema-utils.js'
import { motionMessage } from './motion.js'

const keyOf = (p) => JSON.stringify(p)

/** ¿Se puede generar un formulario para este schema? (la raíz debe ser objeto o lista) */
export function supportsForm(schema, data) {
  const kind = kindOf(makeResolver(schema)(schema), data)
  return kind === 'object' || kind === 'array'
}

/**
 * Formulario generado desde JSON Schema. Mantiene su propio estado (copia de los datos),
 * lo muta in situ y avisa con onChange(estado, ruta). No valida: la validación y el diff
 * los hace el servidor (/api/preview), así que no hay dos validadores que puedan discrepar.
 */
export function createForm({ schema, data, original: originalData, onChange }) {
  const resolve = makeResolver(schema)
  const state = structuredClone(data ?? {})
  const original = structuredClone(originalData ?? data ?? {})
  const registry = new Map() // ruta → { path, wrap, errEl }
  const el = h('div', { class: 'form' })
  const emptyFilter = motionMessage('search', 'No hay campos que coincidan con la búsqueda.', { compact: true })
  emptyFilter.classList.add('form-empty')
  emptyFilter.hidden = true

  const register = (path, entry) => registry.set(keyOf(path), { path, ...entry })
  function clearBelow(path) {
    const k = keyOf(path)
    const prefix = path.length ? k.slice(0, -1) + ',' : '['
    for (const key of [...registry.keys()]) if (key !== k && key.startsWith(prefix)) registry.delete(key)
  }
  function refreshMarks() {
    for (const { path, wrap } of registry.values()) wrap.classList.toggle('changed', !deepEqual(getAt(state, path), getAt(original, path)))
  }
  const notify = (path) => {
    refreshMarks()
    onChange(state, path)
  }

  /* ── piezas comunes ── */
  const errBox = () => Object.assign(h('p', { class: 'err', role: 'alert' }), { hidden: true })
  const hint = (sch) => (sch.description ? h('p', { class: 'hint', text: sch.description }) : null)
  const searchText = (sch, label, path) => `${label} ${path[path.length - 1] ?? ''} ${sch.title ?? ''} ${sch.description ?? ''}`.toLowerCase()
  const btn = (text, title, onclick, extra = '') =>
    h('button', { type: 'button', class: `btn small ghost ${extra}`.trim(), text, title, 'aria-label': title, onclick })

  function header(label, path, opts) {
    const key = path[path.length - 1]
    return h(
      'div',
      { class: 'field-head' },
      h('span', { class: 'label' }, label, opts.required ? h('span', { class: 'req', text: ' *' }) : null),
      typeof key === 'string' && label !== key ? h('code', { class: 'key', text: key }) : null,
      h('span', { class: 'dot', title: 'Modificado respecto al archivo' }),
      opts.onRemove
        ? btn('✕', 'Quitar', (e) => {
            e.preventDefault()
            e.stopPropagation()
            opts.onRemove()
          }, 'danger')
        : null,
    )
  }

  function field(rawSch, path, opts = {}) {
    const sch = resolve(rawSch)
    const kind = kindOf(sch, getAt(state, path))
    const label = opts.label ?? sch.title ?? String(path[path.length - 1] ?? '')
    const build = { object: objectField, array: arrayField, variant: variantField }[kind] ?? leafField
    return build(sch, kind, path, { ...opts, label })
  }

  /* ── hojas ── */
  function leafField(sch, kind, path, opts) {
    const wrap = h('div', { class: `field kind-${kind}${opts.compact ? ' compact' : ''}` })
    wrap.dataset.search = searchText(sch, opts.label, path)
    const errEl = errBox()
    const value = getAt(state, path)
    const leaf = leafFor(kind, sch, {
      value,
      required: Boolean(opts.required),
      omitEmpty: !opts.required && !opts.inArray,
      set: (v) => {
        setAt(state, path, v)
        notify(path)
      },
    })
    leaf.apply(value)
    const actions = []
    if (!opts.compact && kind !== 'const') {
      actions.push(
        h('button', {
          type: 'button',
          class: 'btn small ghost reset',
          text: '↺ restaurar',
          title: 'Volver al valor del archivo',
          onclick: () => {
            const o = getAt(original, path)
            setAt(state, path, o === undefined ? undefined : structuredClone(o))
            leaf.apply(o)
            notify(path)
          },
        }),
      )
      if (sch.default !== undefined && kind !== 'json' && typeof sch.default !== 'object')
        actions.push(
          h('button', {
            type: 'button',
            class: 'btn small ghost',
            text: `por defecto: ${String(sch.default)}`,
            onclick: () => {
              setAt(state, path, sch.default)
              leaf.apply(sch.default)
              notify(path)
            },
          }),
        )
    }
    put(
      wrap,
      opts.compact && !opts.onRemove ? null : header(opts.compact ? '' : opts.label, path, opts),
      h('div', { class: 'controls' }, leaf.el, ...leaf.extra),
      opts.compact ? null : hint(sch),
      actions.length ? h('div', { class: 'actions' }, ...actions) : null,
      errEl,
    )
    register(path, { wrap, errEl })
    return wrap
  }

  /* ── objetos (con propiedades declaradas + mapas de claves libres) ── */
  function objectField(sch, kind, path, opts) {
    const props = sch.properties || {}
    const required = new Set(sch.required || [])
    const body = h('div', { class: 'group-body' })
    const errEl = errBox()
    const canAdd = isObj(sch.additionalProperties) || sch.additionalProperties === true || Boolean(sch.patternProperties)
    const valueSchemaFor = (k) => {
      if (props[k]) return props[k]
      for (const [pat, ps] of Object.entries(sch.patternProperties || {})) {
        try {
          if (new RegExp(pat).test(k)) return ps
        } catch {
          /* patrón inválido: se ignora */
        }
      }
      return isObj(sch.additionalProperties) ? sch.additionalProperties : {}
    }
    const addRow = () => {
      const input = h('input', { class: 'ctl', placeholder: 'nombre de la nueva clave', 'aria-label': 'Nueva clave' })
      const msg = h('span', { class: 'hint' })
      const add = () => {
        const k = input.value.trim()
        if (!k) return
        const cur = getAt(state, path)
        if ((isObj(cur) && Object.hasOwn(cur, k)) || Object.hasOwn(props, k)) {
          msg.textContent = 'Esa clave ya existe'
          return
        }
        setAt(state, [...path, k], defaultFor(valueSchemaFor(k), resolve))
        fill()
        notify(path)
      }
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          add()
        }
      })
      return h('div', { class: 'add-row' }, input, h('button', { type: 'button', class: 'btn small', text: '+ Añadir', onclick: add }), msg)
    }
    function fill() {
      clearBelow(path)
      body.replaceChildren()
      const cur = getAt(state, path)
      const order = Object.keys(props).sort((a, b) => (resolve(props[a])['x-order'] ?? 1e9) - (resolve(props[b])['x-order'] ?? 1e9))
      for (const k of order) body.append(field(props[k], [...path, k], { required: required.has(k) }))
      const extras = isObj(cur) ? Object.keys(cur).filter((k) => !Object.hasOwn(props, k)) : []
      for (const k of extras)
        body.append(
          field(valueSchemaFor(k), [...path, k], {
            label: k,
            onRemove: () => {
              setAt(state, [...path, k], undefined)
              fill()
              notify(path)
            },
          }),
        )
      if (canAdd) body.append(addRow())
      refreshMarks()
    }
    let wrap
    if (opts.root) wrap = h('div', { class: 'group root' }, hint(sch), body, errEl)
    else {
      wrap = h('details', { class: 'field group', open: path.length <= 1 }, h('summary', {}, header(opts.label, path, opts)), h('div', { class: 'group-inner' }, hint(sch), body, errEl))
      wrap.dataset.search = searchText(sch, opts.label, path)
    }
    register(path, { wrap, errEl })
    fill()
    return wrap
  }

  /* ── listas ── */
  function arrayField(sch, kind, path, opts) {
    const list = h('div', { class: 'list' })
    const errEl = errBox()
    const itemSchema = (i) => (Array.isArray(sch.items) ? (sch.items[i] ?? sch.additionalItems ?? {}) : (sch.items ?? {}))
    const ensure = () => {
      let a = getAt(state, path)
      if (!Array.isArray(a)) setAt(state, path, (a = []))
      return a
    }
    const nameOf = (item) => {
      if (!isObj(item)) return ''
      for (const k of ['nombre', 'name', 'id', 'title', 'titulo', 'host']) if (typeof item[k] === 'string' && item[k]) return ` — ${item[k]}`
      return ''
    }
    const row = (i, item) => {
      const isc = resolve(itemSchema(i))
      const primitive = !['object', 'array', 'variant'].includes(kindOf(isc, item))
      const move = (d) => {
        const a = ensure()
        const j = i + d
        if (j < 0 || j >= a.length) return
        const t = a[i]
        a[i] = a[j]
        a[j] = t
        fill()
        notify(path)
      }
      const remove = () => {
        ensure().splice(i, 1)
        fill()
        notify(path)
      }
      const tools = h('div', { class: 'item-tools' }, btn('▲', 'Subir', () => move(-1)), btn('▼', 'Bajar', () => move(1)), btn('✕', 'Quitar', remove, 'danger'))
      const inner = field(itemSchema(i), [...path, i], { label: `${isc.title || 'Elemento'} ${i + 1}${nameOf(item)}`, required: true, inArray: true, compact: primitive })
      return h('div', { class: 'item' + (primitive ? ' primitive' : '') }, inner, tools)
    }
    function fill() {
      clearBelow(path)
      list.replaceChildren()
      const arr = getAt(state, path)
      ;(Array.isArray(arr) ? arr : []).forEach((item, i) => list.append(row(i, item)))
      if (!Array.isArray(arr) || !arr.length) list.append(motionMessage('document', 'La lista está vacía. Añade el primer elemento.', { compact: true }))
      refreshMarks()
    }
    const add = () => {
      const a = ensure()
      a.push(defaultFor(itemSchema(a.length), resolve))
      fill()
      notify(path)
    }
    const addBtn = h('button', { type: 'button', class: 'btn small', text: '+ Añadir elemento', onclick: add })
    let wrap
    if (opts.root) wrap = h('div', { class: 'group root' }, hint(sch), list, addBtn, errEl)
    else {
      wrap = h('details', { class: 'field group', open: path.length <= 1 }, h('summary', {}, header(opts.label, path, opts)), h('div', { class: 'group-inner' }, hint(sch), list, addBtn, errEl))
      wrap.dataset.search = searchText(sch, opts.label, path)
    }
    register(path, { wrap, errEl })
    fill()
    return wrap
  }

  /* ── variantes (oneOf / anyOf) ── */
  function variantField(sch, kind, path, opts) {
    const alts = (sch.oneOf || sch.anyOf).map((a) => resolve(a))
    let idx = matchVariant(alts, getAt(state, path))
    const sel = h('select', { class: 'ctl', 'aria-label': 'Variante' })
    alts.forEach((a, i) => sel.append(h('option', { value: String(i), text: a.title || (a.const !== undefined ? String(a.const) : `Variante ${i + 1} (${kindOf(a)})`) })))
    sel.value = String(idx)
    const body = h('div', { class: 'variant-body' })
    const errEl = errBox()
    const wrap = h('div', { class: 'field kind-variant' }, header(opts.label, path, opts), hint(sch), h('div', { class: 'controls' }, sel), body, errEl)
    wrap.dataset.search = searchText(sch, opts.label, path)
    const draw = () => {
      body.replaceChildren(field({ ...alts[idx], title: undefined, description: undefined }, path, { required: opts.required, inArray: opts.inArray, compact: true, root: true, label: '' }))
      register(path, { wrap, errEl }) // la hoja interna comparte ruta: el aviso se muestra bajo el selector
    }
    sel.addEventListener('change', () => {
      idx = Number(sel.value)
      setAt(state, path, defaultFor(alts[idx], resolve))
      clearBelow(path)
      draw()
      notify(path)
    })
    draw()
    return wrap
  }

  /* ── API pública ── */
  function setErrors(errors) {
    for (const r of registry.values()) {
      r.errEl.hidden = true
      r.errEl.textContent = ''
      r.wrap.classList.remove('invalid')
    }
    const unplaced = []
    for (const e of errors) {
      let p = e.path
      let reg = registry.get(keyOf(p))
      while (!reg && p.length) {
        p = p.slice(0, -1)
        reg = registry.get(keyOf(p))
      }
      if (!reg) {
        unplaced.push(e)
        continue
      }
      const prefix = p.length === e.path.length ? '' : `${e.path.slice(p.length).join('.')}: `
      reg.errEl.textContent = (reg.errEl.textContent ? reg.errEl.textContent + ' · ' : '') + prefix + e.message
      reg.errEl.hidden = false
      reg.wrap.classList.add('invalid')
    }
    return unplaced
  }

  function focusPath(path) {
    let p = path
    let reg = registry.get(keyOf(p))
    while (!reg && p.length) {
      p = p.slice(0, -1)
      reg = registry.get(keyOf(p))
    }
    if (!reg) return
    for (let n = reg.wrap; n && n !== el; n = n.parentElement) if (n.tagName === 'DETAILS') n.open = true
    reg.wrap.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
    reg.wrap.querySelector('input,select,textarea')?.focus({ preventScroll: true })
  }

  function filter(text) {
    const q = text.trim().toLowerCase()
    emptyFilter.hidden = true
    el.querySelectorAll('.field, .item').forEach((n) => (n.hidden = false))
    if (!q) return
    const matches = (n) => (n.dataset.search || '').includes(q)
    el.querySelectorAll('.field:not(.group):not(.compact)').forEach((n) => (n.hidden = !matches(n)))
    ;[...el.querySelectorAll('.group.field, .item')].reverse().forEach((c) => {
      const self = c.classList.contains('field') && matches(c)
      if (self) c.querySelectorAll('.field, .item').forEach((n) => (n.hidden = false))
      const anyVisible = [...c.querySelectorAll('.field:not(.group):not(.compact)')].some((n) => !n.hidden)
      c.hidden = !self && !anyVisible
      if (!c.hidden && c.tagName === 'DETAILS') c.open = true
    })
    emptyFilter.hidden = [...el.querySelectorAll('.field')].some((node) => !node.closest('[hidden]'))
  }

  el.append(field(schema, [], { root: true, label: '' }), emptyFilter)
  refreshMarks()
  return { el, getData: () => state, setErrors, focusPath, filter }
}
