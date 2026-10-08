// Arte original del proyecto. Genera Lottie JSON y su equivalente SVG estático.
// Sin imágenes, fuentes, expresiones ni recursos externos.
import fs from 'node:fs'

const dir = new URL('../public/animations/', import.meta.url)
fs.mkdirSync(dir, { recursive: true })
const prop = (k) => ({ a: 0, k })
const tween = (values) => ({ a: 1, k: values.map(([t, s], i) => ({ t, s: Array.isArray(s) ? s : [s], ...(i < values.length - 1 ? { o: { x: 0.33, y: 0 }, i: { x: 0.67, y: 1 } } : {}) })) })
const transform = (extra = {}) => ({ o: prop(100), r: prop(0), p: prop([32, 32, 0]), a: prop([32, 32, 0]), s: prop([100, 100, 100]), ...extra })
const line = (v, closed = false) => ({ ty: 'sh', ks: prop({ i: v.map(() => [0, 0]), o: v.map(() => [0, 0]), v, c: closed }) })
const circle = (x, y, r) => ({ ty: 'el', p: prop([x, y]), s: prop([r * 2, r * 2]) })
const group = (shapes, { draw = false, width = 3, opacity = 100 } = {}) => ({
  ty: 'gr', it: [...shapes, { ty: 'st', c: prop([0.78, 0.08, 0.06, 1]), o: prop(opacity), w: prop(width), lc: 2, lj: 2 },
    ...(draw ? [{ ty: 'tm', s: prop(0), e: tween([[0, 0], [22, 100], [48, 100]]), o: prop(0), m: 1 }] : []),
    { ty: 'tr', ...transform() }],
})
const layer = (name, shapes, ks = {}) => ({ ddd: 0, ind: 1, ty: 4, nm: name, sr: 1, ks: transform(ks), ao: 0, shapes, ip: 0, op: 49, st: 0, bm: 0 })
const pop = { s: tween([[0, [80, 80, 100]], [14, [108, 108, 100]], [24, [100, 100, 100]], [48, [100, 100, 100]]]) }
const doc = [[18, 9], [36, 9], [47, 20], [47, 55], [18, 55]]
const star = Array.from({ length: 10 }, (_, i) => {
  const angle = -Math.PI / 2 + i * Math.PI / 5
  const r = i % 2 ? 10 : 23
  return [32 + Math.cos(angle) * r, 33 + Math.sin(angle) * r]
})
const defs = {
  document: [
    [group([line(doc, true), line([[36, 9], [36, 20], [47, 20]])]), group([line([[25, 30], [40, 30]]), line([[25, 38], [40, 38]]), line([[25, 46], [34, 46]])], { draw: true })],
    {}, '<path d="M18 9h18l11 11v35H18Z M36 9v11h11 M25 30h15 M25 38h15 M25 46h9"/>',
  ],
  success: [
    [group([circle(32, 32, 23)], { opacity: 35 }), group([line([[20, 32], [29, 41], [45, 23]])], { draw: true, width: 4 })],
    pop, '<circle cx="32" cy="32" r="23" opacity=".35"/><path d="m20 32 9 9 16-18" stroke-width="4"/>',
  ],
  warning: [
    [group([circle(32, 32, 23)], { opacity: 40 }), group([line([[32, 19], [32, 34]]), line([[32, 43], [32, 44]])], { width: 4 })],
    pop, '<circle cx="32" cy="32" r="23" opacity=".4"/><path d="M32 19v15 M32 43v1" stroke-width="4"/>',
  ],
  info: [
    [group([circle(32, 32, 23)], { opacity: 40 }), group([line([[32, 30], [32, 45]]), line([[32, 20], [32, 21]])], { width: 4 })],
    pop, '<circle cx="32" cy="32" r="23" opacity=".4"/><path d="M32 30v15 M32 20v1" stroke-width="4"/>',
  ],
  search: [
    [group([circle(27, 27, 16), line([[39, 39], [53, 53]])])],
    { p: tween([[0, [32, 32, 0]], [12, [28, 32, 0]], [27, [36, 32, 0]], [40, [32, 32, 0]], [48, [32, 32, 0]]]) },
    '<circle cx="27" cy="27" r="16"/><path d="m39 39 14 14"/>',
  ],
  favorite: [
    [group([line(star, true)])],
    { ...pop, r: tween([[0, -14], [15, 8], [28, 0], [48, 0]]) },
    `<polygon points="${star.map((p) => p.join(',')).join(' ')}"/>`,
  ],
  history: [
    [group([circle(32, 32, 23)], { opacity: 40 }), group([line([[32, 17], [32, 32], [43, 38]])])],
    { r: tween([[0, -40], [30, 0], [48, 0]]) },
    '<circle cx="32" cy="32" r="23" opacity=".4"/><path d="M32 17v15l11 6"/>',
  ],
  refresh: [
    [group([line(Array.from({ length: 41 }, (_, i) => {
      const angle = (-25 - i * 7.5) * Math.PI / 180
      return [32 + 22 * Math.cos(angle), 32 + 22 * Math.sin(angle)]
    })), line([[40, 23], [52, 23], [52, 11]])])],
    { r: tween([[0, -90], [30, 0], [48, 0]]) },
    '<path d="M52 23a22 22 0 1 0-2 22 M40 23h12V11"/>',
  ],
  save: [
    [group([line([[12, 10], [43, 10], [52, 19], [52, 54], [12, 54]], true), line([[21, 10], [21, 27], [41, 27], [41, 10]]), line([[21, 54], [21, 38], [43, 38], [43, 54]])])],
    pop, '<path d="M12 10h31l9 9v35H12Z M21 10v17h20V10 M21 54V38h22v16"/>',
  ],
  loading: [
    [group([circle(32, 32, 22)], { opacity: 20 }), {
      ty: 'gr', it: [circle(32, 32, 22), { ty: 'st', c: prop([0.78, 0.08, 0.06, 1]), o: prop(100), w: prop(4), lc: 2, lj: 2 },
        { ty: 'tm', s: prop(0), e: prop(28), o: prop(0), m: 1 }, { ty: 'tr', ...transform() }],
    }],
    { r: { a: 1, k: [{ t: 0, s: [0], o: { x: 0, y: 0 }, i: { x: 1, y: 1 } }, { t: 48, s: [360] }] } },
    '<circle cx="32" cy="32" r="22" opacity=".2"/><path d="M32 10a22 22 0 0 1 22 22" stroke-width="4"/>',
  ],
}
const symbols = []
for (const [name, [shapes, ks, svg]] of Object.entries(defs)) {
  const data = { v: '5.13.0', fr: 30, ip: 0, op: 48, w: 64, h: 64, nm: `Make Me YAML! · ${name}`, ddd: 0, assets: [], layers: [layer(name, shapes, ks)], markers: [] }
  fs.writeFileSync(new URL(`${name}.json`, dir), JSON.stringify(data) + '\n')
  symbols.push(`<symbol id="${name}" viewBox="0 0 64 64"><g fill="${name === 'favorite' ? 'inherit' : 'none'}" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${svg}</g></symbol>`)
}
fs.writeFileSync(new URL('icons.svg', dir), `<svg xmlns="http://www.w3.org/2000/svg">${symbols.join('')}</svg>\n`)
