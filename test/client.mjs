/**
 * Load-and-render test for the client bundle.
 *
 * The bundle is a module-loader factory that hands back `apply(ctx)`, so this
 * mounts it on a fake client context with a minimal React and a stub document,
 * then renders the settings page once. It cannot judge layout, but it proves
 * the bundle parses, its slot wiring runs, and the page renders end to end
 * without touching the real Host or browser.
 */
import assert from 'node:assert/strict'

// ── minimal React ──────────────────────────────────────────────────────────
const React = {
  createElement(type, props, ...children) {
    return { type, props: props === null ? {} : props, children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useEffect() {},
  useRef(value) {
    return { current: value }
  },
  useCallback(fn) {
    return fn
  },
}

// ── browser surface the bundle touches ────────────────────────────────────
const style = { textContent: '', setAttribute() {}, remove() {} }
globalThis.document = {
  createElement() {
    return style
  },
  head: { append() {} },
}
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {} },
  setTimeout: () => 0,
  clearTimeout: () => {},
  setInterval: () => 0,
  clearInterval: () => {},
  confirm: () => true,
  alert() {},
}

// ── module loader ─────────────────────────────────────────────────────────
let bundle = null
globalThis.window.__ModuleLoader__ = {
  load({ factory }) {
    bundle = factory((name) => {
      if (name === 'react') return React
      throw new Error(`unexpected require: ${name}`)
    })
  },
}

await import('../src/client/index.js')
assert.ok(bundle !== null, 'the bundle registers with the module loader')
assert.equal(typeof bundle.apply, 'function', 'the bundle exports apply')

// ── mount ─────────────────────────────────────────────────────────────────
let component = null
let slot = null
const ctx = {
  effect(fn) {
    return fn()
  },
  locale: {
    getLocale: () => ({ active: 'zh-CN' }),
    subscribe: () => () => {},
  },
  slots: {
    inject(_name, callback) {
      callback()
    },
    register(meta, render) {
      slot = meta
      component = render
      return { dispose() {} }
    },
  },
}

bundle.apply(ctx)
assert.equal(slot.name, 'settings.section', 'the page registers in the settings slot')
assert.equal(slot.id, 'dsh-toolbox-sessions')
assert.equal(typeof slot.label, 'function')
assert.equal(slot.label(), '会话管理', 'the nav label follows the active locale')
assert.equal(typeof component, 'function', 'a component was registered')

// ── render ────────────────────────────────────────────────────────────────
const tree = component({})

function texts(node, out) {
  if (node === null || node === undefined || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (Array.isArray(node)) {
    for (const child of node) texts(child, out)
    return out
  }
  if (typeof node === 'object' && Array.isArray(node.children)) {
    for (const child of node.children) texts(child, out)
  }
  return out
}

const copy = texts(tree, []).join('\n')
assert.match(copy, /会话管理/, 'the page title renders')
assert.match(copy, /归档是隐藏会话的可逆步骤/, 'the subtitle renders')
assert.match(copy, /工作区/, 'the workspace section renders while loading')
assert.match(copy, /加载中/, 'the loading state is shown before the first read')

// The page is a single root element with the plugin marker the styles use.
assert.equal(tree.props['data-dsh-toolbox'], '')

console.log('client: all assertions passed')
