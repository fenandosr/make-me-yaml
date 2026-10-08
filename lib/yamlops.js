import { isDeepStrictEqual } from 'node:util'
import { parseDocument, isScalar, isAlias, isMap, isSeq, visit, Scalar } from 'yaml'
import { HttpError } from './util.js'

export const MARKER = '__unchanged__'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/* ───────────── lectura ───────────── */

export function parseYaml(text) {
  const doc = parseDocument(text.replace(/^﻿/, ''), { prettyErrors: true, merge: true })
  const errors = doc.errors.map((e) => ({ message: e.message.split('\n')[0], line: e.linePos?.[0]?.line ?? null }))
  return { doc, errors }
}

/** Anclas, alias y claves de mezcla (<<): editar un valor heredado le da valor propio. */
export function inspectFeatures(doc, text) {
  let anchors = 0
  let aliases = 0
  visit(doc, {
    Node(_k, node) {
      if (node.anchor) anchors++
    },
    Alias() {
      aliases++
    },
  })
  return { anchors, aliases, merge: /^\s*<<\s*:/m.test(text) }
}

/* ───────────── estilo (para respetar el formato del archivo) ───────────── */

export function detectStyle(text) {
  const lines = text.split(/\r?\n/)
  let indent = 0
  let votesIndented = 0
  let votesFlush = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^( +)\S/.exec(lines[i])
    if (m && !lines[i].trimStart().startsWith('#') && !lines[i].trimStart().startsWith('- ')) {
      if (!indent || m[1].length < indent) indent = m[1].length
    }
    const k = /^( *)[^\s#-][^#]*:\s*$/.exec(lines[i])
    if (k && lines[i + 1] !== undefined) {
      const d = /^( *)- /.exec(lines[i + 1])
      if (d) (d[1].length > k[1].length ? votesIndented++ : votesFlush++)
    }
  }
  if (indent < 2 || indent > 8) indent = 2
  return {
    indent,
    indentSeq: votesFlush > votesIndented ? false : true,
    crlf: text.includes('\r\n'),
    bom: text.startsWith('﻿'),
  }
}

export function serialize(doc, style) {
  let out = doc.toString({ indent: style.indent, indentSeq: style.indentSeq, lineWidth: 0 })
  if (style.crlf) out = out.replace(/\r?\n/g, '\r\n')
  return (style.bom ? '﻿' : '') + out
}

/* ───────────── diff y aplicación de cambios ───────────── */

/** Lista de operaciones {op:'set'|'delete', path, value} que llevan a -> b. */
export function diffData(a, b, path = [], out = []) {
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) if (!Object.hasOwn(b, k)) out.push({ op: 'delete', path: [...path, k] })
    for (const k of Object.keys(b)) {
      if (!Object.hasOwn(a, k)) out.push({ op: 'set', path: [...path, k], value: b[k] })
      else diffData(a[k], b[k], [...path, k], out)
    }
  } else if (Array.isArray(a) && Array.isArray(b)) {
    const common = Math.min(a.length, b.length)
    for (let i = 0; i < common; i++) diffData(a[i], b[i], [...path, i], out)
    for (let i = a.length - 1; i >= b.length; i--) out.push({ op: 'delete', path: [...path, i] })
    for (let i = a.length; i < b.length; i++) out.push({ op: 'set', path: [...path, i], value: b[i] })
  } else if (!isDeepStrictEqual(a, b)) {
    out.push({ op: 'set', path, value: b })
  }
  return out
}

function retype(node, value) {
  if (typeof node.value !== typeof value) {
    node.type = undefined
    node.format = undefined
    node.minFractionDigits = undefined
  } else if (typeof value !== 'string' && (node.type === Scalar.BLOCK_LITERAL || node.type === Scalar.BLOCK_FOLDED)) {
    node.type = undefined
  }
}

/**
 * Las claves de un objeto JS son siempre texto, pero en el YAML pueden ser números o
 * booleanos (`443: https`). Traduce la ruta del formulario a las claves reales del documento
 * para editar `443` en lugar de añadir una clave `"443"` duplicada.
 */
function realPath(doc, path) {
  const out = []
  let node = doc.contents
  for (const seg of path) {
    if (isAlias(node)) node = node.resolve(doc)
    if (isMap(node)) {
      const pair = node.items.find((p) => isScalar(p.key) && String(p.key.value) === String(seg))
      out.push(pair ? pair.key.value : seg)
      node = pair?.value
    } else {
      out.push(seg)
      node = isSeq(node) && typeof seg === 'number' ? node.items[seg] : undefined
    }
  }
  return out
}

/** Aplica los cambios sobre el documento conservando comentarios, comillas y orden. */
export function applyChanges(doc, changes) {
  const warnings = []
  for (const change of changes) {
    const { op, value } = change
    const label = change.path.join('.') || '(raíz)'
    const path = realPath(doc, change.path)
    if (op === 'delete') {
      doc.deleteIn(path)
      continue
    }
    if (path.length === 0) {
      doc.contents = doc.createNode(value)
      continue
    }
    const node = doc.getIn(path, true)
    if (isAlias(node)) warnings.push(`«${label}» heredaba su valor de un alias; ahora tiene valor propio.`)
    if (isScalar(node) && (value === null || typeof value !== 'object')) {
      if (node.anchor) warnings.push(`«${label}» tiene el ancla &${node.anchor}: los alias que la usan verán el nuevo valor.`)
      retype(node, value)
      node.value = value
    } else {
      doc.setIn(path, doc.createNode(value))
    }
  }
  return warnings
}

/* ───────────── secretos (x-secret) ───────────── */

function deref(sch, root) {
  let s = sch
  for (let i = 0; i < 10 && s && typeof s === 'object' && typeof s.$ref === 'string'; i++) {
    if (!s.$ref.startsWith('#/')) return s
    s = s.$ref
      .slice(2)
      .split('/')
      .reduce((acc, k) => acc?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root)
  }
  return s
}

function propSchema(sch, key, root) {
  for (const s of [sch, ...(sch.allOf || [])]) {
    const d = deref(s, root)
    if (d?.properties && Object.hasOwn(d.properties, key)) return d.properties[key]
    for (const [pat, ps] of Object.entries(d?.patternProperties || {})) {
      try {
        if (new RegExp(pat).test(key)) return ps
      } catch {
        /* patrón inválido */
      }
    }
    if (isObj(d?.additionalProperties)) return d.additionalProperties
  }
  return undefined
}

/** Sustituye los valores marcados x-secret por MARKER antes de enviarlos al navegador. */
export function redact(value, schema, root = schema) {
  const sch = deref(schema, root)
  if (!sch || typeof sch !== 'object') return value
  if (sch['x-secret'] && value !== undefined && value !== null && value !== '') return MARKER
  if (isObj(value)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      const ps = propSchema(sch, k, root)
      out[k] = ps ? redact(v, ps, root) : v
    }
    return out
  }
  if (Array.isArray(value)) {
    const items = sch.items
    return value.map((v, i) => (Array.isArray(items) ? (items[i] ? redact(v, items[i], root) : v) : items ? redact(v, items, root) : v))
  }
  return value
}

/** Restaura el valor real donde el cliente devolvió MARKER (el secreto no se tocó). */
export function unredact(next, prev, path = []) {
  if (next === MARKER) {
    if (prev === undefined) throw new HttpError(400, 'BAD_SECRET', `El campo secreto «${path.join('.')}» no tiene valor previo`)
    return prev
  }
  if (isObj(next)) {
    const out = {}
    for (const [k, v] of Object.entries(next)) out[k] = unredact(v, isObj(prev) ? prev[k] : undefined, [...path, k])
    return out
  }
  if (Array.isArray(next)) return next.map((v, i) => unredact(v, Array.isArray(prev) ? prev[i] : undefined, [...path, i]))
  return next
}

/** ¿Alguno de los cambios toca un campo marcado x-restart-required (o hereda la marca)? */
export function restartNeeded(schema, changes) {
  return changes.some(({ path }) => {
    let sch = schema
    if (deref(sch, schema)?.['x-restart-required']) return true
    for (const key of path) {
      const d = deref(sch, schema)
      if (!d) return false
      sch = typeof key === 'number' ? (Array.isArray(d.items) ? d.items[key] : d.items) : propSchema(d, key, schema)
      if (!sch) return false
      if (deref(sch, schema)?.['x-restart-required']) return true
    }
    return false
  })
}

export function hasSecrets(data, schema) {
  return !isDeepStrictEqual(redact(data, schema), data)
}
