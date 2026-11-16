import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const filename = new URL('../client.js', import.meta.url)
const source = readFileSync(filename, 'utf8')
const originalReturn = "return { name: namespace, inject: ['slots', 'locale', 'configForms'], apply }"

function eventTarget() {
  const listeners = new Map()
  return {
    listeners,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(listener)
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    emit(type, event) { for (const listener of listeners.get(type) ?? []) listener(event) },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0) },
  }
}

function dom() {
  const panels = []
  const styles = []
  const body = { querySelectorAll: () => panels }
  const document = {
    ...eventTarget(), body,
    head: { append(style) { styles.push(style) } },
    createElement(tag) {
      assert.equal(tag, 'style')
      const style = { dataset: {}, textContent: '', remove() { styles.splice(styles.indexOf(style), 1) } }
      return style
    },
  }
  const viewport = { ...eventTarget(), offsetLeft: 20, offsetTop: 10, width: 400, height: 300 }
  const window = { ...eventTarget(), visualViewport: viewport, innerWidth: 800, innerHeight: 600 }
  const mutations = []
  const resizes = []
  class MutationObserver {
    constructor(callback) { this.callback = callback; mutations.push(this) }
    observe(target, options) { this.target = target; this.options = options }
    disconnect() { this.disconnected = true }
  }
  class ResizeObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); resizes.push(this) }
    observe(target) { this.observed.add(target) }
    unobserve(target) { this.observed.delete(target) }
    disconnect() { this.disconnected = true; this.observed.clear() }
  }
  function panel(usage = true) {
    const properties = new Map()
    return {
      parentElement: body, dataset: {}, offsetWidth: 100, offsetHeight: 80, properties,
      style: { setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key) },
      querySelector: () => usage ? {} : null,
      getBoundingClientRect: () => ({ left: 390, top: 280 }),
    }
  }
  return { document, window, panels, styles, mutations, resizes, panel, MutationObserver, ResizeObserver,
    getComputedStyle: () => ({ getPropertyValue: () => '40px' }) }
}

function load({ expose = true, react = {}, environment = dom(), clock = { mono: 0, wall: 10000 } } = {}) {
  const registrations = []
  const requires = []
  const timers = new Map()
  let timerId = 0
  environment.window.__ModuleLoader__ = { load: entry => registrations.push(entry) }
  // Only the VM input is changed: the original disk source remains untouched.
  const code = expose ? source.replace(originalReturn,
    'return { name: namespace, inject: ["slots", "locale", "configForms"], apply, duration, stepReading, countReplyCharacters, replyRate, useMeter, pinUsageDialogs, StatsDialog, Activity }') : source
  if (expose) assert.equal(source.split(originalReturn).length, 2, 'unique factory return for VM-only exports')
  const sandbox = { ...environment, performance: { now: () => clock.mono },
    Date: { now: () => clock.wall },
    setInterval(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id },
    clearInterval: id => timers.delete(id),
  }
  vm.runInNewContext(code, sandbox, { filename: filename.pathname })
  assert.equal(registrations.length, 1)
  const registration = registrations[0]
  const plugin = registration.factory(name => {
    requires.push(name)
    if (name === 'react') return { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }), ...react }
    if (name === 'react-dom') return { createPortal: node => node }
    throw new Error('Unexpected dependency: ' + name)
  })
  return { plugin, registration, requires, environment, timers }
}

function hooks() {
  const state = []
  const effects = []
  let cursor = 0
  let pending = []
  const react = {
    useRef(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = { current: initial }
      return state[index]
    },
    useId() {
      const index = cursor++
      return 'test-id-' + index
    },
    useMemo(callback, dependencies) {
      const index = cursor++
      const previous = state[index]
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        state[index] = { dependencies, value: callback() }
      }
      return state[index].value
    },
    useLayoutEffect(callback, dependencies) { react.useEffect(callback, dependencies) },
    useState(initial) {
      const index = cursor++
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value }]
    },
    useEffect(callback, dependencies) {
      const index = cursor++
      const previous = effects[index]
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        pending.push(() => { previous?.cleanup?.(); effects[index] = { dependencies, cleanup: callback() } })
      }
    },
  }
  return { react,
    // Attach refs during the simulated commit, before layout/passive effects run.
    render(callback, commit = () => {}) { cursor = 0; pending = []; const value = callback(); commit(value); for (const effect of pending) effect(); return value },
    unmount() { for (const effect of effects) effect?.cleanup?.() },
  }
}

test('duration formats boundaries, rounding and invalid timings', () => {
  const { duration } = load().plugin
  for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, '100']) assert.equal(duration(value), null)
  for (const [input, expected] of [[0, '0 ms'], [12.6, '13 ms'], [999, '999 ms'], [1000, '1.0 s'],
    [12345, '12.3 s'], [59999, '60.0 s'], [60000, '1 min 0 s'], [119600, '2 min 0 s']]) {
    assert.equal(duration(input), expected)
  }
})

test('stepReading separates first-token latency from provider output throughput', () => {
  const { stepReading } = load().plugin
  const reading = stepReading({ timing: { stepStartTime: 1000, firstTokenTime: 1250, completedTime: 3250 }, usage: { outputTokens: 100 } })
  assert.equal(reading.firstMs, 250)
  assert.equal(reading.rate, 50)
  for (const node of [undefined, {}, { timing: {} }]) {
    assert.equal(stepReading(node).firstMs, null)
    assert.equal(stepReading(node).rate, null)
  }
  for (const outputTokens of [0, -1, NaN, Infinity, '10', undefined]) {
    assert.equal(stepReading({ timing: { firstTokenTime: 100, completedTime: 200 }, usage: { outputTokens } }).rate, null)
  }
  for (const completedTime of [100, 99, NaN, Infinity, undefined]) {
    assert.equal(stepReading({ timing: { firstTokenTime: 100, completedTime }, usage: { outputTokens: 10 } }).rate, null)
  }
  assert.equal(stepReading({ timing: { stepStartTime: 100, firstTokenTime: 99 } }).firstMs, null)
  assert.equal(stepReading({ timing: { stepStartTime: 0, firstTokenTime: 0 } }).firstMs, 0)
})

test('countReplyCharacters counts Unicode code points and Markdown, excluding reasoning/tools', () => {
  const { countReplyCharacters } = load().plugin
  assert.equal(countReplyCharacters(), 0)
  assert.equal(countReplyCharacters({}), 0)
  assert.equal(countReplyCharacters({ blocks: [] }), 0)
  assert.equal(countReplyCharacters({ blocks: [
    { kind: 'text', text: '**中😀**\ne\u0301' },
    { kind: 'reasoning', text: 'not visible' },
    { kind: 'tool_use', text: 'not reply', input: { argument: 'ignored' } },
    { kind: 'text', text: '👩‍💻' },
  ] }), 12)
})

test('replyRate waits for 300ms and counts cumulative samples', () => {
  const { replyRate } = load().plugin
  assert.equal(replyRate(null, 1000), null)
  assert.equal(replyRate({ samples: [] }, 1000), null)
  const meter = { samples: [{ time: 0, characters: 0 }, { time: 200, characters: 30 }] }
  assert.equal(replyRate(meter, 299), null)
  assert.equal(replyRate(meter, 300), 100)
  assert.equal(replyRate({ samples: [{ time: 100, characters: 0 }, { time: 1100, characters: 25 }] }, 1100), 25)
})

test('replyRate interpolates the window boundary rather than overcounting old text', () => {
  const { replyRate } = load().plugin
  const meter = { samples: [{ time: 0, characters: 0 }, { time: 2000, characters: 100 }, { time: 3000, characters: 200 }] }
  assert.equal(replyRate(meter, 3000), 70)
  assert.equal(replyRate(meter, 4000), 50)
  assert.equal(replyRate(meter, 4500), 40)
  assert.equal(replyRate(meter, 5501), 0)
  assert.equal(replyRate(meter, 10000), 0)
})

test('useMeter creates the initial zero sample, resets attempts, and releases its interval', () => {
  const hook = hooks()
  const clock = { mono: 0, wall: 10000 }
  const { plugin, timers } = load({ react: hook.react, clock })
  const render = (attempt, characters) => hook.render(() => plugin.useMeter(attempt, characters))
  render('step/0', 0)
  let value = render('step/0', 0)
  assert.equal(value.meter.samples.length, 1)
  assert.equal(value.meter.samples[0].time, 0)
  assert.equal(value.meter.samples[0].characters, 0)
  assert.equal(timers.size, 1)
  assert.equal([...timers.values()][0].delay, 180)
  clock.mono = 1000
  render('step/0', 40)
  value = render('step/0', 40)
  assert.equal(plugin.replyRate(value.meter, 1000), 40)
  assert.equal(value.meter.samples.length, 2, 'unchanged renders do not duplicate samples')
  clock.mono = 1200
  render('step/1', 0)
  value = render('step/1', 0)
  assert.equal(value.meter.samples.length, 1)
  assert.equal(value.meter.samples[0].characters, 0)
  assert.equal(value.meter.samples[0].time, 1200)
  assert.equal(timers.size, 1, 'retry clears old timer')
  clock.mono = 1300
  clock.wall = 11300
  for (const timer of timers.values()) timer.callback()
  value = render('step/1', 0)
  assert.equal(value.now.mono, 1300)
  assert.equal(value.now.wall, 11300)
  render(null, 0)
  assert.equal(render(null, 0).meter, null)
  assert.equal(timers.size, 0)
  render('next/0', 0)
  assert.equal(timers.size, 1)
  hook.unmount()
  assert.equal(timers.size, 0)
})

test('original loader registers plugin, locale, slot, styles and disposes every effect', () => {
  const { plugin, registration, requires, environment } = load({ expose: false })
  assert.equal(registration.id, 'dsh-live-speed')
  assert.deepEqual(requires, ['react', 'react-dom'])
  assert.equal(plugin.name, 'dsh-live-speed')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale', 'configForms'])
  const cleanups = []
  const released = []
  let locales, slot, component, modeValue
  const subscriber = () => {}
  const form = { getSnapshot: () => ({ value: modeValue }), subscribe(listener) { assert.equal(listener, subscriber); return 'subscription' } }
  const ctx = {
    effect(callback) { cleanups.push(callback()) },
    locale: { register(namespace, value) { assert.equal(namespace, 'dsh-live-speed'); locales = value; return () => released.push('locale') } },
    configForms: { get(name) { assert.equal(name, 'ui-chat'); return form } },
    slots: {
      inject(name, callback) { assert.equal(name, 'conversation.composer.dock'); const cleanup = callback(); return () => { cleanup(); released.push('inject') } },
      register(spec, entry) { slot = spec; component = entry; return () => released.push('slot') },
    },
  }
  plugin.apply(ctx)
  assert.equal(cleanups.length, 4)
  assert.equal(locales.zh.title, '生成速度')
  assert.equal(locales.en.title, 'Generation speed')
  assert.deepEqual(Object.keys(locales.zh).sort(), Object.keys(locales.en).sort())
  assert.equal(locales.zh.charactersPerSecond, '{value} 字符/s')
  assert.equal(locales.en.charactersPerSecond, '{value} chars/s')
  assert.equal(slot.name, 'conversation.composer.dock')
  assert.equal(slot.id, 'activity')
  assert.equal(slot.order, 0)
  assert.equal(slot.priority, -10)
  assert.equal(slot.locale, 'dsh-live-speed')
  assert.equal(typeof component, 'function')
  const { mode } = slot.inject().hooks
  assert.equal(mode.getSnapshot(), 'detailed')
  modeValue = { performanceUsage: 'compact' }
  assert.equal(mode.getSnapshot(), 'compact')
  assert.equal(mode.subscribe(subscriber), 'subscription')
  assert.equal(environment.styles.length, 1)
  assert.equal(environment.styles[0].dataset.dshLiveSpeed, '')
  assert.match(environment.styles[0].textContent, /@keyframes dsh-speed-pulse/)
  assert.match(environment.styles[0].textContent, /--dsw-alias-label-tertiary/)
  assert.match(environment.styles[0].textContent, /data-dsh-speed-pinned-usage/)
  for (const cleanup of cleanups.reverse()) cleanup()
  assert.deepEqual(released, ['slot', 'inject', 'locale'])
  assert.equal(environment.styles.length, 0)
  assert.equal(environment.window.listenerCount(), 0)
  assert.equal(environment.window.visualViewport.listenerCount(), 0)
  assert.ok(environment.mutations[0].disconnected)
  assert.ok(environment.resizes[0].disconnected)
})

test('pinUsageDialogs pins only usage panels, responds to viewport, and cleans removed panels', () => {
  const environment = dom()
  const usage = environment.panel()
  const unrelated = environment.panel(false)
  environment.panels.push(usage, unrelated)
  const { pinUsageDialogs } = load({ environment }).plugin
  const cleanup = pinUsageDialogs()
  assert.equal(usage.dataset.dshSpeedPinnedUsage, '')
  assert.equal(unrelated.dataset.dshSpeedPinnedUsage, undefined)
  assert.equal(usage.properties.get('--dsh-speed-pin-left'), '308px')
  assert.equal(usage.properties.get('--dsh-speed-pin-top'), '218px')
  assert.equal(usage.properties.get('--dsh-speed-pin-width'), '376px')
  assert.equal(usage.properties.get('--dsh-speed-pin-height'), '258px')
  assert.equal(environment.window.listenerCount(), 1)
  assert.equal(environment.window.visualViewport.listenerCount(), 2)
  environment.window.visualViewport.height = 200
  environment.window.visualViewport.emit('resize')
  assert.equal(usage.properties.get('--dsh-speed-pin-top'), '118px')
  usage.parentElement = null
  environment.panels.splice(0, 1)
  environment.mutations[0].callback()
  assert.equal(usage.dataset.dshSpeedPinnedUsage, undefined)
  assert.equal(usage.properties.size, 0)
  assert.equal(environment.resizes[0].observed.size, 0)
  const remaining = environment.panel()
  environment.panels.push(remaining)
  environment.mutations[0].callback()
  assert.equal(remaining.dataset.dshSpeedPinnedUsage, '')
  cleanup()
  assert.equal(remaining.dataset.dshSpeedPinnedUsage, undefined)
  assert.equal(remaining.properties.size, 0)
  assert.ok(environment.mutations[0].disconnected)
  assert.ok(environment.resizes[0].disconnected)
  assert.equal(environment.window.listenerCount(), 0)
  assert.equal(environment.window.visualViewport.listenerCount(), 0)
})

test('useMeter treats already-present text as a baseline, not newly received text', () => {
  const hook = hooks()
  const clock = { mono: 0, wall: 10000 }
  const { plugin } = load({ react: hook.react, clock })
  const render = characters => hook.render(() => plugin.useMeter('existing/0', characters))
  render(100)
  let value = render(100)
  assert.equal(value.meter.samples.length, 1)
  assert.equal(value.meter.samples[0].characters, 100)
  assert.equal(plugin.replyRate(value.meter, 0), null)
  assert.equal(plugin.replyRate(value.meter, 500), 0, 'existing 100 characters never imply received throughput')
  clock.mono = 1000
  render(120)
  value = render(120)
  assert.equal(plugin.replyRate(value.meter, 1000), 20, 'only the new 20 characters count')
  hook.unmount()
})

test('StatsDialog focuses only after its visible commit, handles Escape and releases listeners', () => {
  const hook = hooks()
  const environment = dom()
  const { StatsDialog } = load({ react: hook.react, environment }).plugin
  const closed = []
  const focused = []
  let committedStyle
  const insidePanel = {}
  const insideRoot = {}
  const panel = {
    offsetWidth: 100,
    contains: target => target === insidePanel,
    focus(options) {
      assert.notEqual(committedStyle.visibility, 'hidden', 'focus must happen after visible DOM commit')
      focused.push(options.preventScroll)
    },
  }
  const props = {
    id: 'dialog', rootRef: { current: { contains: target => target === insideRoot } },
    anchorRef: { current: { getBoundingClientRect: () => ({ left: 390, top: 280 }) } },
    close: restore => closed.push(restore), t: key => key, rows: [['first', '250 ms']],
  }
  const render = () => hook.render(() => StatsDialog(props), tree => {
    committedStyle = tree.props.style
    tree.props.ref.current = panel
  })
  let tree = render()
  assert.equal(tree.props.role, 'dialog')
  assert.equal(tree.props.tabIndex, -1)
  assert.equal(tree.props.style.visibility, 'hidden')
  assert.equal(focused.length, 0)
  tree = render()
  assert.equal(tree.props.style.left, 308)
  assert.equal(tree.props.style.bottom, 328)
  assert.deepEqual(focused, [true])
  render()
  assert.equal(focused.length, 1, 'unrelated renders do not steal focus')
  assert.equal(environment.document.listenerCount(), 3)
  assert.equal(environment.window.listenerCount(), 1)
  assert.equal(environment.window.visualViewport.listenerCount(), 2)
  environment.document.emit('pointerdown', { target: insidePanel })
  environment.document.emit('click', { target: insideRoot })
  environment.document.emit('keydown', { key: 'Enter' })
  assert.deepEqual(closed, [])
  let prevented = 0
  let stopped = 0
  environment.document.emit('keydown', { key: 'Escape', preventDefault() { prevented++ }, stopPropagation() { stopped++ } })
  assert.deepEqual(closed, [true])
  assert.equal(prevented, 1)
  assert.equal(stopped, 1)
  environment.document.emit('pointerdown', { target: {} })
  assert.deepEqual(closed, [true, false])
  environment.window.visualViewport.width = 300
  environment.window.visualViewport.emit('resize')
  assert.equal(render().props.style.left, 208)
  assert.equal(focused.length, 1, 'repositioning does not refocus the dialog')
  hook.unmount()
  assert.equal(environment.document.listenerCount(), 0)
  assert.equal(environment.window.listenerCount(), 0)
  assert.equal(environment.window.visualViewport.listenerCount(), 0)
  environment.document.emit('keydown', { key: 'Escape' })
  assert.equal(closed.length, 2)
})

test('Activity retains step TTFT during retry and memoizes actual character reads across timer renders', () => {
  const hook = hooks()
  const clock = { mono: 0, wall: 11000 }
  const { plugin, timers } = load({ react: hook.react, clock })
  let reads = 0
  const partial = text => ({ turn: 'turn', step: 0, blocks: [{ kind: 'text', get text() { reads++; return text } }] })
  const step = { status: 'open', turn: 'turn', step: 0, start: { seq: 1, time: 10000 } }
  const snapshot = {
    timeline: { turnOrder: ['turn'], turns: new Map([['turn', { status: 'open', steps: [step] }]]) },
    legacy: { partial: partial('hello'), nodes: [] },
  }
  const props = {
    useChat: selector => selector(snapshot), useSession: selector => selector({ running: true }),
    useProjection: () => null, useMode: selector => selector('detailed'),
    t: (key, values) => values ? key + ' ' + Object.values(values).join(' ') : key,
    timing: { turn: 'turn', step: 0, timing: { firstTokenTime: 10250 } },
    nativeRetry: { turn: 'turn', step: 0, status: 'running', retry: 1 },
  }
  const render = () => hook.render(() => plugin.Activity(props))
  render()
  let tree = render()
  assert.match(tree.children[0].props.title, /first 250 ms/)
  assert.doesNotMatch(tree.children[0].props.title, /retrying|generating/)
  const firstReads = reads
  assert.ok(firstReads > 0, 'the actual text getter was read by character counting')
  clock.mono = 1000
  clock.wall = 12000
  for (const timer of timers.values()) timer.callback()
  tree = render()
  assert.equal(reads, firstReads, 'timer state rerender does not recount unchanged partial')
  assert.match(tree.children[0].props.title, /first 250 ms/)
  snapshot.legacy.partial = partial('hello world')
  render()
  assert.ok(reads > firstReads, 'a replaced partial is actually recounted')
  const replacementReads = reads
  render()
  assert.equal(reads, replacementReads)
  props.nativeRetry = { ...props.nativeRetry, retry: 2 }
  tree = render()
  assert.match(tree.children[0].props.title, /first 250 ms/)
  assert.equal(reads, replacementReads, 'retry with unchanged text reuses the memoized count')
  hook.unmount()
  assert.equal(timers.size, 0)
})

test('pinUsageDialogs also supports browsers without visualViewport', () => {
  const environment = dom()
  delete environment.window.visualViewport
  const panel = environment.panel()
  environment.panels.push(panel)
  const cleanup = load({ environment }).plugin.pinUsageDialogs()
  assert.equal(panel.properties.get('--dsh-speed-pin-width'), '776px')
  cleanup()
  assert.equal(panel.properties.size, 0)
  assert.equal(environment.window.listenerCount(), 0)
})
