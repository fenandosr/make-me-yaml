// Protocolo JSONL privado por stdin/stdout: no abre puertos ni servicios de red.
import readline from 'node:readline'
import { createWorkspaceManager } from '../lib/workspace.js'

const workspace = createWorkspaceManager()
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
async function run() {
  for await (const line of input) {
    let response
    try {
      const request = JSON.parse(line)
      let data
      switch (request.op) {
        case 'inspect': data = workspace.inspect(request.selection); break
        case 'open': data = workspace.open(request.selection); break
        case 'api': data = await workspace.request(request); break
        default: throw new Error('Operación desconocida')
      }
      response = { status: 200, data }
    } catch (error) {
      response = { status: error.status || 500, data: { error: error.code || 'INTERNAL', message: error.message } }
    }
    process.stdout.write(JSON.stringify(response) + '\n')
  }
}
run().catch((error) => { console.error(error); process.exitCode = 1 })
