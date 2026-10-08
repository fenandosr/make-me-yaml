import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadSettings } from '../lib/config.js'
import { createService } from '../lib/documents.js'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-editor-fmt-'))
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
fs.writeFileSync(path.join(tmp, 'any.schema.json'), '{"type":"object"}')
const svc = createService(loadSettings({ YAML_ROOT: tmp }))

/** Crea un YAML con schema abierto, aplica `edit` a sus datos y devuelve { before, after, changed }. */
async function edit(name, text, mutate) {
  fs.writeFileSync(path.join(tmp, name), text)
  fs.copyFileSync(path.join(tmp, 'any.schema.json'), path.join(tmp, name.replace(/\.yaml$/, '.schema.json')))
  const f = svc.getFile(name)
  const data = structuredClone(f.data)
  mutate(data)
  await svc.save(name, { baseHash: f.hash, data })
  const after = fs.readFileSync(path.join(tmp, name), 'utf8')
  const bl = text.split('\n')
  const al = after.split('\n')
  return { f, after, changed: al.filter((l, i) => l !== bl[i]) }
}

test('listas sin sangría y sangría de 4: solo cambia la línea editada', async () => {
  const src = 'servicio:\n    nombre: web\n    puertos:\n    - 80\n    - 443\n    activo: true\n'
  const { f, changed } = await edit('a.yaml', src, (d) => (d.servicio.nombre = 'api'))
  assert.equal(f.roundtripStable, true)
  assert.deepEqual(changed, ['    nombre: api'])
})

test('CRLF y BOM se conservan', async () => {
  const src = '﻿# cabecera\r\nnombre: web\r\nlista:\r\n  - a\r\n  - b\r\n'
  const { after } = await edit('b.yaml', src, (d) => (d.nombre = 'api'))
  assert.ok(after.startsWith('﻿# cabecera\r\n'))
  assert.ok(after.includes('nombre: api\r\n'))
  assert.ok(!/[^\r]\n/.test(after), 'no deben aparecer saltos de línea sueltos')
})

test('comillas simples y bloques literales de otros campos no se tocan', async () => {
  const src = "titulo: 'Hola: mundo'\nnota: |\n  línea uno\n  línea dos\ncontador: 1\n"
  const { f, changed, after } = await edit('c.yaml', src, (d) => (d.contador = 2))
  assert.equal(f.roundtripStable, true)
  assert.deepEqual(changed, ['contador: 2'])
  assert.match(after, /titulo: 'Hola: mundo'/)
})

test('editar una cadena entre comillas dobles conserva el estilo', async () => {
  const src = 'a: "uno"   # nota\nb: dos\n'
  const { after } = await edit('d.yaml', src, (d) => (d.a = 'tres'))
  // el comentario conserva su columna (el valor es un carácter más largo → un espacio menos)
  assert.match(after, /^a: "tres" {2}# nota$/m)
})

test('claves numéricas del YAML se editan y borran sin duplicarse como «"443"»', async () => {
  const src = 'puertos:\n  80: http\n  443: https   # seguro\n'
  const { after, changed } = await edit('n.yaml', src, (d) => (d.puertos['443'] = 'tls'))
  assert.equal(after.match(/443/g).length, 1, after)
  assert.deepEqual(changed, ['  443: tls     # seguro'])
  const f = svc.getFile('n.yaml')
  const data = structuredClone(f.data)
  delete data.puertos['80']
  await svc.save('n.yaml', { baseHash: f.hash, data })
  assert.ok(!fs.readFileSync(path.join(tmp, 'n.yaml'), 'utf8').includes('80'))
})

test('un cambio sin diferencias no escribe ni crea historial', async () => {
  const src = 'x: 1\n'
  fs.writeFileSync(path.join(tmp, 'e.yaml'), src)
  fs.copyFileSync(path.join(tmp, 'any.schema.json'), path.join(tmp, 'e.schema.json'))
  const f = svc.getFile('e.yaml')
  const r = await svc.save('e.yaml', { baseHash: f.hash, data: f.data })
  assert.equal(r.unchanged, true)
  assert.deepEqual(await svc.history('e.yaml'), [])
})

test('valores heredados por alias o mezcla (<<) se editan sin romper el archivo', async () => {
  const src = 'base: &b\n  a: 1\n  b: 2\nitem:\n  <<: *b\n  c: 3\n'
  const { after } = await edit('f.yaml', src, (d) => (d.item.a = 9))
  assert.match(after, /<<: \*b/)
  assert.match(after, /^ {2}a: 9$/m)
  const f2 = svc.getFile('f.yaml')
  assert.equal(f2.data.item.a, 9)
  assert.equal(f2.data.base.a, 1)
})

test('borrar una clave heredada por mezcla se rechaza en lugar de guardar algo distinto', async () => {
  const src = 'base: &b\n  a: 1\nitem:\n  <<: *b\n'
  fs.writeFileSync(path.join(tmp, 'g.yaml'), src)
  fs.copyFileSync(path.join(tmp, 'any.schema.json'), path.join(tmp, 'g.schema.json'))
  const f = svc.getFile('g.yaml')
  const data = structuredClone(f.data)
  delete data.item.a
  await assert.rejects(svc.save('g.yaml', { baseHash: f.hash, data }), (e) => e.code === 'CANNOT_APPLY')
  assert.equal(fs.readFileSync(path.join(tmp, 'g.yaml'), 'utf8'), src)
})
