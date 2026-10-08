/**
 * Diff de líneas. Recorta prefijo y sufijo comunes y resuelve el centro con LCS.
 * Devuelve la lista completa de operaciones { t: ' ' | '-' | '+', s: línea }.
 */
export function diffOps(oldText, newText) {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--
    endB--
  }
  const ma = a.slice(start, endA)
  const mb = b.slice(start, endB)

  const ops = []
  for (let i = 0; i < start; i++) ops.push({ t: ' ', s: a[i] })
  if (ma.length * mb.length > 4_000_000) {
    ma.forEach((s) => ops.push({ t: '-', s }))
    mb.forEach((s) => ops.push({ t: '+', s }))
  } else {
    const n = ma.length
    const m = mb.length
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--) dp[i][j] = ma[i] === mb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (ma[i] === mb[j]) {
        ops.push({ t: ' ', s: ma[i] })
        i++
        j++
      } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: '-', s: ma[i++] })
      else ops.push({ t: '+', s: mb[j++] })
    }
    while (i < n) ops.push({ t: '-', s: ma[i++] })
    while (j < m) ops.push({ t: '+', s: mb[j++] })
  }
  for (let i = endA; i < a.length; i++) ops.push({ t: ' ', s: a[i] })
  return ops
}

/** Hunks con contexto para mostrar en la interfaz. */
export function lineDiff(oldText, newText, context = 3) {
  const ops = diffOps(oldText, newText)
  let oldNo = 1
  let newNo = 1
  const numbered = ops.map((o) => {
    const line = { ...o, o: o.t === '+' ? null : oldNo, n: o.t === '-' ? null : newNo }
    if (o.t !== '+') oldNo++
    if (o.t !== '-') newNo++
    return line
  })
  const keep = new Array(numbered.length).fill(false)
  numbered.forEach((l, idx) => {
    if (l.t === ' ') return
    for (let k = Math.max(0, idx - context); k <= Math.min(numbered.length - 1, idx + context); k++) keep[k] = true
  })
  const hunks = []
  let cur = null
  numbered.forEach((l, idx) => {
    if (!keep[idx]) {
      cur = null
      return
    }
    if (!cur) hunks.push((cur = []))
    cur.push(l)
  })
  return {
    hunks,
    added: ops.filter((o) => o.t === '+').length,
    removed: ops.filter((o) => o.t === '-').length,
  }
}

// Ignora diferencias puramente cosméticas: sangría, espacios antes de un comentario y espacios finales.
const cosmetic = (s) => s.trim().replace(/\s+#/g, ' #')

/** Separa «código   # comentario» (división ingenua en el primer « #»; el llamador verifica). */
const splitComment = (s) => {
  const m = /^(.*?\S)(\s+)(#.*)$/.exec(s)
  return m ? { code: m[1], gap: m[2], comment: m[3] } : null
}

/**
 * El serializador de YAML normaliza espacios (alinear comentarios, sangrías…).
 * Para cada línea «nueva» que solo difiere de una línea «vieja» del mismo bloque
 * de cambios en espacio en blanco, se restaura la línea original, de modo que
 * solo cambien las líneas que realmente se editaron. El llamador debe verificar
 * después que el resultado sigue significando lo mismo.
 */
export function restoreCosmetic(oldText, newText) {
  const ops = diffOps(oldText, newText)
  const out = []
  let i = 0
  while (i < ops.length) {
    if (ops[i].t === ' ') {
      out.push(ops[i++].s)
      continue
    }
    const removed = []
    const added = []
    while (i < ops.length && ops[i].t !== ' ') (ops[i].t === '-' ? removed : added).push(ops[i++].s)
    const used = new Set()
    for (let a = 0; a < added.length; a++) {
      const line = added[a]
      // «clave:   # nota» → el serializador baja la nota a su propia línea; se vuelve a unir.
      const next = added[a + 1]
      if (next !== undefined && next.trim().startsWith('#')) {
        const m = removed.findIndex((r, idx) => {
          const rc = splitComment(r)
          return !used.has(idx) && rc && rc.code.trim() === line.trim() && rc.comment === next.trim()
        })
        if (m >= 0) {
          used.add(m)
          out.push(removed[m])
          a++
          continue
        }
      }
      const key = cosmetic(line)
      const j = removed.findIndex((r, idx) => !used.has(idx) && cosmetic(r) === key)
      if (j >= 0) {
        used.add(j)
        out.push(removed[j])
        continue
      }
      // Línea editada con comentario al final: conserva la columna del comentario original.
      const sc = splitComment(line)
      const k = sc ? removed.findIndex((r, idx) => !used.has(idx) && splitComment(r)?.comment === sc.comment) : -1
      if (k >= 0) {
        used.add(k)
        const rc = splitComment(removed[k])
        const col = rc.code.length + rc.gap.length
        out.push(sc.code.length < col ? sc.code + ' '.repeat(col - sc.code.length) + sc.comment : line)
      } else out.push(line)
    }
  }
  return out.join('\n')
}
