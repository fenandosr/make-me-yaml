import { MARKER } from './schema-utils.js'

/** Mini helper de DOM (sin innerHTML: nada del YAML se interpreta como HTML). */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else el.setAttribute(k, v === true ? '' : String(v))
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid)
  return el
}

/** Como Element.append pero ignora null/undefined/false (append nativo los escribiría como texto «null»). */
export function put(el, ...kids) {
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid)
  return el
}

const isIntegerType =(sch) => sch.type === 'integer' || (Array.isArray(sch.type) && sch.type.includes('integer') && !sch.type.includes('number'))

/**
 * Controles de hoja. Cada uno devuelve { el, apply(valor), extra[] }.
 * ctx: { value, required, omitEmpty, set(valor) }  (set(undefined) = quitar la clave)
 */
export function leafFor(kind, sch, ctx) {
  switch (kind) {
    case 'string':
      return stringLeaf(sch, ctx)
    case 'number':
      return numberLeaf(sch, ctx)
    case 'boolean':
      return booleanLeaf(sch, ctx)
    case 'enum':
      return enumLeaf(sch, ctx)
    case 'const':
      return { el: h('code', { class: 'const', text: JSON.stringify(sch.const) }), apply() {}, extra: [] }
    default:
      return jsonLeaf(ctx)
  }
}

function stringLeaf(sch, ctx) {
  const secret = Boolean(sch['x-secret']) || sch.format === 'password'
  const multiline =
    Boolean(sch['x-multiline']) || sch.format === 'textarea' || sch.maxLength > 200 || (typeof ctx.value === 'string' && ctx.value.includes('\n'))
  const el = multiline
    ? h('textarea', { class: 'ctl mono', rows: 4, spellcheck: 'false' })
    : h('input', { class: 'ctl', type: secret ? 'password' : 'text', autocomplete: secret ? 'new-password' : 'off', spellcheck: 'false' })
  const hadSecret = secret && ctx.value === MARKER
  const extra = []
  const apply = (v) => {
    const masked = v === MARKER
    el.value = masked || v == null ? '' : String(v)
    el.placeholder = masked ? '•••••••• (sin cambios; escribe para reemplazar)' : ''
  }
  el.addEventListener('input', () => {
    const v = el.value
    if (hadSecret && v === '') {
      el.placeholder = '•••••••• (sin cambios; escribe para reemplazar)'
      ctx.set(MARKER)
    } else ctx.set(v === '' && ctx.omitEmpty ? undefined : v)
  })
  if (hadSecret)
    extra.push(
      h('button', {
        type: 'button',
        class: 'btn small ghost',
        text: 'Borrar secreto',
        title: 'Eliminar el valor guardado',
        onclick: () => {
          el.value = ''
          el.placeholder = '(vacío)'
          ctx.set(ctx.omitEmpty ? undefined : '')
        },
      }),
    )
  return { el, apply, extra }
}

function numberLeaf(sch, ctx) {
  const el = h('input', {
    class: 'ctl',
    type: 'number',
    step: isIntegerType(sch) ? '1' : (sch.multipleOf ?? 'any'),
    min: sch.minimum,
    max: sch.maximum,
  })
  el.addEventListener('input', () => {
    if (el.value === '') return ctx.set(ctx.omitEmpty ? undefined : null)
    const n = Number(el.value)
    if (!Number.isNaN(n)) ctx.set(n)
  })
  return { el, apply: (v) => (el.value = v == null ? '' : String(v)), extra: [] }
}

function booleanLeaf(sch, ctx) {
  const el = h('input', { type: 'checkbox', class: 'switch', role: 'switch' })
  el.addEventListener('change', () => ctx.set(el.checked))
  return { el, apply: (v) => (el.checked = Boolean(v ?? sch.default ?? false)), extra: [] }
}

function enumLeaf(sch, ctx) {
  const el = h('select', { class: 'ctl' })
  const options = [...sch.enum]
  const build = (current) => {
    el.replaceChildren()
    if (!ctx.required || current === undefined) el.append(h('option', { value: '', text: '— sin definir —' }))
    options.forEach((v, i) => el.append(h('option', { value: String(i), text: String(v) })))
    if (current !== undefined && !options.some((o) => o === current)) {
      options.push(current)
      el.append(h('option', { value: String(options.length - 1), text: `${String(current)} (valor actual, fuera del schema)` }))
    }
  }
  el.addEventListener('change', () => ctx.set(el.value === '' ? undefined : options[Number(el.value)]))
  return {
    el,
    apply(v) {
      build(v)
      const i = options.findIndex((o) => o === v)
      el.value = i >= 0 ? String(i) : ''
    },
    extra: [],
  }
}

/** Respaldo para formas de schema no soportadas: edición como JSON. */
function jsonLeaf(ctx) {
  const el = h('textarea', { class: 'ctl mono', rows: 5, spellcheck: 'false' })
  const note = h('span', { class: 'hint', text: 'Editor JSON (este campo no tiene un control específico).' })
  el.addEventListener('input', () => {
    try {
      ctx.set(el.value.trim() === '' ? undefined : JSON.parse(el.value))
      el.classList.remove('bad')
    } catch {
      el.classList.add('bad')
    }
  })
  return { el, apply: (v) => (el.value = v === undefined ? '' : JSON.stringify(v, null, 2)), extra: [note] }
}
