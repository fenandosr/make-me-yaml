/** Lottie local, bajo demanda. Los SVG estáticos también funcionan si falla la carga. */
const names = new Set(['document', 'success', 'warning', 'info', 'search', 'favorite', 'history', 'refresh', 'save', 'loading'])
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
const instances = new Set()
const dataCache = new Map()
let playerPromise

function getPlayer() {
  // La versión light no usa expresiones/eval y respeta la CSP de la app.
  return playerPromise ??= import('/vendor/lottie-light.min.js').then(() => window.lottie)
}

function getData(name) {
  if (!dataCache.has(name)) {
    const promise = fetch(`/animations/${name}.json`).then((res) => {
      if (!res.ok) throw new Error('No se pudo cargar la animación')
      return res.json()
    }).catch((error) => { dataCache.delete(name); throw error })
    dataCache.set(name, promise)
  }
  return dataCache.get(name)
}

const visibility = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    target.visible = isIntersecting
    target.sync()
  }
})

class YamlMotion extends HTMLElement {
  connectedCallback() {
    this.name = names.has(this.getAttribute('name')) ? this.getAttribute('name') : 'document'
    this.setAttribute('aria-hidden', 'true')
    this.visible = false
    this.requested = this.hasAttribute('autoplay')
    this.finished = false
    this.failed = false
    this.generation = (this.generation || 0) + 1
    this.dataset.state = 'static'
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 64 64')
    svg.setAttribute('focusable', 'false')
    svg.classList.add('motion-fallback')
    const use = document.createElementNS(svg.namespaceURI, 'use')
    use.setAttribute('href', `/animations/icons.svg#${this.name}`)
    svg.append(use)
    this.canvas = document.createElement('span')
    this.canvas.className = 'motion-canvas'
    this.replaceChildren(svg, this.canvas)
    this.trigger = this.hasAttribute('interactive') ? this.closest('button, [role="button"]') : null
    this.onInteract = () => this.replay()
    this.trigger?.addEventListener('pointerenter', this.onInteract)
    this.trigger?.addEventListener('focusin', this.onInteract)
    instances.add(this)
    visibility.observe(this)
  }

  disconnectedCallback() {
    this.generation++
    visibility.unobserve(this)
    instances.delete(this)
    this.trigger?.removeEventListener('pointerenter', this.onInteract)
    this.trigger?.removeEventListener('focusin', this.onInteract)
    this.animation?.destroy()
    this.animation = null
    this.loading = false
  }

  replay() {
    if (reducedMotion.matches || this.trigger?.disabled) return
    this.requested = true
    this.finished = false
    this.animation?.goToAndStop(0, true)
    this.sync()
  }

  sync() {
    if (!this.isConnected) return
    if (reducedMotion.matches) {
      this.animation?.pause()
      this.dataset.state = 'static'
      return
    }
    const active = this.visible && !document.hidden && this.requested && !this.finished
    if (this.animation) {
      this.dataset.state = active ? 'playing' : 'paused'
      if (active) this.animation.play()
      else this.animation.pause()
    } else if (active && !this.loading && !this.failed) this.load()
  }

  async load() {
    this.loading = true
    const generation = this.generation
    try {
      const [player, data] = await Promise.all([getPlayer(), getData(this.name)])
      if (!this.isConnected || generation !== this.generation) return
      if (reducedMotion.matches) return
      this.animation = player.loadAnimation({
        container: this.canvas, renderer: 'svg', loop: this.hasAttribute('loop'), autoplay: false,
        animationData: structuredClone(data), rendererSettings: { progressiveLoad: false, hideOnTransparent: true },
      })
      this.animation.addEventListener('complete', () => {
        this.finished = true
        this.sync()
      })
      this.animation.addEventListener('data_failed', () => this.fail())
      this.animation.addEventListener('error', () => this.fail())
      this.sync()
    } catch {
      if (generation === this.generation) this.fail()
    } finally {
      if (generation === this.generation) this.loading = false
    }
  }

  fail() {
    this.failed = true
    this.animation?.destroy()
    this.animation = null
    this.dataset.state = 'static'
  }
}

customElements.define('yaml-motion', YamlMotion)
reducedMotion.addEventListener('change', () => { for (const item of instances) item.sync() })
document.addEventListener('visibilitychange', () => { for (const item of instances) item.sync() })

export function motion(name, { size = 'icon', autoplay = false, loop = false, interactive = false } = {}) {
  const el = document.createElement('yaml-motion')
  el.setAttribute('name', name)
  el.className = `motion-${size}`
  if (autoplay) el.setAttribute('autoplay', '')
  if (loop) el.setAttribute('loop', '')
  if (interactive) el.setAttribute('interactive', '')
  return el
}

export function motionMessage(name, text, { compact = false, loading = false } = {}) {
  const el = document.createElement('div')
  el.className = `motion-message empty${compact ? ' compact' : ''}`
  if (loading) el.setAttribute('role', 'status')
  const label = document.createElement('p')
  label.textContent = text
  el.append(motion(name, { size: compact ? 'small' : 'illustration', autoplay: true, loop: loading }), label)
  return el
}

export function buttonContent(button, name, text, { busy = false, autoplay = false } = {}) {
  button.classList.add('motion-button')
  button.setAttribute('aria-busy', String(busy))
  const label = document.createElement('span')
  label.textContent = text
  button.replaceChildren(motion(busy ? 'loading' : name, { autoplay: busy || autoplay, loop: busy, interactive: !busy }), label)
}
