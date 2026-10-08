// La marca se añade al empaquetar; evita arrancar el modo web si el puente tarda.
const desktop = document.querySelector('meta[name="desktop-shell"]') || window.go?.main?.App
try {
  if (desktop) {
    const deadline = Date.now() + 10000
    while (!window.go?.main?.App) {
      if (Date.now() > deadline) throw new Error('No se pudo iniciar la conexión con la aplicación. Cierra y vuelve a abrir Make Me YAML!')
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const { chooseWorkspace } = await import('./desktop.js')
    await chooseWorkspace()
  } else {
    document.getElementById('app').hidden = false
    await import('./app.js')
  }
} catch (error) {
  const host = document.getElementById('workspace-start')
  const message = document.createElement('p')
  message.className = 'banner bad'
  message.setAttribute('role', 'alert')
  message.textContent = error.message || String(error)
  host.replaceChildren(message)
  host.hidden = false
}
