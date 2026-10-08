import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspectWorkspace, createWorkspaceManager } from '../lib/workspace.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yaml-workspace-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
const write = (root, name, content) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
  fs.writeFileSync(path.join(root, name), content)
}

test('el escritorio requiere selección antes de leer archivos', async () => {
  await assert.rejects(createWorkspaceManager().request({ method: 'GET', url: '/api/files' }), { code: 'NO_WORKSPACE' })
})

test('sin manifiesto descubre YAML y YML recursivamente y excluye directorios internos', (t) => {
  const root = fixture(t)
  write(root, 'a.yaml', '# comentario\na: 1\n')
  write(root, 'sub/b.yml', 'b: true\n')
  for (const dir of ['.git', 'node_modules', '.yaml-editor']) write(root, `${dir}/oculto.yaml`, 'no: true\n')
  const { info, service } = inspectWorkspace({ directory: root })
  assert.equal(info.source, 'discovery')
  assert.equal(info.count, 2)
  assert.deepEqual(service.listFiles().files.map((f) => f.path), ['a.yaml', 'sub/b.yml'])
  assert.equal(fs.readFileSync(path.join(root, 'a.yaml'), 'utf8'), '# comentario\na: 1\n')
})

test('detecta el manifiesto y aplica only_listed, títulos y exclusiones', (t) => {
  const root = fixture(t)
  write(root, 'editor.manifest.yaml', 'only_listed: true\nfiles:\n  a.yaml:\n    title: Uno\n')
  write(root, 'a.yaml', 'a: 1\n')
  write(root, 'b.yaml', 'b: 2\n')
  const { info, service } = inspectWorkspace({ directory: root })
  assert.equal(info.source, 'manifest')
  assert.equal(info.count, 1)
  assert.equal(service.listFiles().files[0].title, 'Uno')
  assert.equal(inspectWorkspace({ directory: root, mode: 'discover' }).info.count, 2)
})

test('admite un manifiesto elegido con nombre personalizado', (t) => {
  const root = fixture(t)
  write(root, 'configuracion.yml', 'include: ["sub/*.yml"]\n')
  write(root, 'a.yaml', 'a: 1\n')
  write(root, 'sub/b.yml', 'b: 2\n')
  const { info } = inspectWorkspace({ directory: root, mode: 'manifest', manifestName: 'configuracion.yml' })
  assert.equal(info.source, 'manifest')
  assert.equal(info.count, 1)
  assert.throws(() => inspectWorkspace({ directory: root, mode: 'manifest' }), { code: 'INVALID_MANIFEST' })
})

test('rechaza manifiesto roto en vez de abrir silenciosamente otra selección', (t) => {
  const root = fixture(t)
  write(root, 'a.yaml', 'a: 1\n')
  for (const text of ['files: [', '- no es un objeto', 'false', '0', 'include: [42]', 'files: false', 'only_listed: sí']) {
    write(root, 'editor.manifest.yaml', text)
    assert.throws(() => inspectWorkspace({ directory: root }), { code: 'INVALID_MANIFEST' })
  }
  assert.equal(inspectWorkspace({ directory: root, mode: 'discover' }).info.count, 1)
})

test('rutas inválidas y manifiestos fuera de la raíz se rechazan', (t) => {
  const root = fixture(t)
  write(root, 'a.yaml', 'a: 1\n')
  for (const directory of ['', 'relativa', path.join(root, 'missing'), path.join(root, 'a.yaml')]) assert.throws(() => inspectWorkspace({ directory }), { code: 'BAD_DIRECTORY' })
  assert.throws(() => inspectWorkspace({ directory: root, manifestName: '../fuera.yaml' }), { code: 'BAD_MANIFEST' })
  const outside = fixture(t)
  write(outside, 'manifest.yaml', 'only_listed: true\n')
  fs.symlinkSync(path.join(outside, 'manifest.yaml'), path.join(root, 'editor.manifest.yaml'))
  assert.throws(() => inspectWorkspace({ directory: root }), { code: 'INVALID_MANIFEST' })
})

test('una carpeta vacía es válida y revisar no crea historial', (t) => {
  const root = fixture(t)
  assert.equal(inspectWorkspace({ directory: root }).info.count, 0)
  assert.deepEqual(fs.readdirSync(root), [])
})

test('inspección o apertura fallida conserva la sesión; cambiar raíz invalida peticiones antiguas', async (t) => {
  const a = fixture(t)
  const b = fixture(t)
  write(a, 'same.yaml', '# carpeta A\nvalue: 1\n')
  write(b, 'same.yaml', '# carpeta B\nvalue: 2\n')
  const manager = createWorkspaceManager()
  const first = manager.open({ directory: a })
  const request = { workspaceId: first.id, method: 'GET', url: '/api/file?path=same.yaml' }
  const file = await manager.request(request)
  manager.inspect({ directory: b })
  assert.match((await manager.request(request)).raw, /carpeta A/)
  assert.throws(() => manager.open({ directory: 'inexistente' }))
  assert.match((await manager.request(request)).raw, /carpeta A/)
  const second = manager.open({ directory: b })
  await assert.rejects(manager.request({ ...request, method: 'PUT', url: '/api/file', body: { path: 'same.yaml', baseHash: file.hash, raw: 'value: 999\n' } }), { code: 'WORKSPACE_CHANGED' })
  assert.match((await manager.request({ ...request, workspaceId: second.id })).raw, /value: 2/)
})
