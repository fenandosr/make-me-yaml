export const MARKER = '__unchanged__'

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

export function getAt(obj, path) {
  let c = obj
  for (const k of path) {
    if (c == null) return undefined
    c = c[k]
  }
  return c
}

/** Asigna en una ruta creando intermedios; value === undefined elimina la clave. */
export function setAt(obj, path, value) {
  let c = obj
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (c[k] == null || typeof c[k] !== 'object') c[k] = typeof path[i + 1] === 'number' ? [] : {}
    c = c[k]
  }
  const last = path[path.length - 1]
  if (value === undefined) {
    if (Array.isArray(c)) c.splice(last, 1)
    else delete c[last]
  } else c[last] = value
}

/** Resuelve $ref locales (#/…) y fusiona allOf; los campos hermanos de $ref (title, default…) mandan. */
export function makeResolver(root) {
  const lookup = (ref) =>
    ref
      .slice(2)
      .split('/')
      .reduce((a, k) => a?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root)
  const resolve = (sch, depth = 0) => {
    if (!sch || typeof sch !== 'object' || depth > 10) return sch && typeof sch === 'object' ? sch : {}
    let out = sch
    if (typeof sch.$ref === 'string' && sch.$ref.startsWith('#/')) {
      const { $ref, ...rest } = sch
      out = { ...resolve(lookup($ref), depth + 1), ...rest }
    }
    if (Array.isArray(out.allOf)) {
      const { allOf, ...rest } = out
      let merged = {}
      for (const part of [...allOf.map((p) => resolve(p, depth + 1)), rest]) {
        merged = {
          ...merged,
          ...part,
          properties: { ...merged.properties, ...part.properties },
          required: [...(merged.required || []), ...(part.required || [])],
        }
      }
      if (!Object.keys(merged.properties).length) delete merged.properties
      out = merged
    }
    return out
  }
  return resolve
}

/** Tipo de control a usar para un schema (y, si el schema no dice, para el valor actual). */
export function kindOf(sch, value) {
  if (sch.const !== undefined) return 'const'
  if (Array.isArray(sch.enum)) return 'enum'
  if (Array.isArray(sch.oneOf) || Array.isArray(sch.anyOf)) return 'variant'
  let t = sch.type
  if (Array.isArray(t)) t = t.find((x) => x !== 'null') ?? 'null'
  if (!t) {
    if ((sch.properties && Object.keys(sch.properties).length) || sch.additionalProperties || sch.patternProperties) t = 'object'
    else if (sch.items) t = 'array'
    else if (value !== undefined) t = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value
  }
  return { string: 'string', number: 'number', integer: 'number', boolean: 'boolean', object: 'object', array: 'array' }[t] ?? 'json'
}

/** Valor inicial razonable para un schema (elementos nuevos de arrays, claves nuevas, variantes). */
export function defaultFor(sch, resolve) {
  sch = resolve(sch)
  if (sch.default !== undefined) return structuredClone(sch.default)
  if (sch.const !== undefined) return sch.const
  if (Array.isArray(sch.enum)) return sch.enum[0]
  const kind = kindOf(sch)
  if (kind === 'object') {
    const out = {}
    for (const k of sch.required || []) if (sch.properties?.[k]) out[k] = defaultFor(sch.properties[k], resolve)
    return out
  }
  if (kind === 'array') return []
  if (kind === 'boolean') return false
  if (kind === 'number') return sch.minimum ?? 0
  if (kind === 'variant') return defaultFor((sch.oneOf || sch.anyOf)[0], resolve)
  return ''
}

const jsType = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)

/** Índice de la variante (oneOf/anyOf) que mejor describe el valor actual. */
export function matchVariant(alts, value) {
  const score = (alt) => {
    const kind = kindOf(alt, value)
    if (alt.const !== undefined) return alt.const === value ? 3 : -1
    if (Array.isArray(alt.enum)) return alt.enum.includes(value) ? 3 : -1
    const t = jsType(value)
    if (!((kind === 'object' && t === 'object') || (kind === 'array' && t === 'array') || (kind === 'number' && t === 'number') || (kind === t))) return -1
    if (kind === 'object' && isObj(value)) {
      let s = 1
      for (const [k, ps] of Object.entries(alt.properties || {})) {
        if (ps.const !== undefined) s += value[k] === ps.const ? 2 : -10
        else if (k in value) s += 0.5
      }
      return s
    }
    return 1
  }
  let best = 0
  let bestScore = -Infinity
  alts.forEach((a, i) => {
    const s = score(a)
    if (s > bestScore) {
      best = i
      bestScore = s
    }
  })
  return best
}
