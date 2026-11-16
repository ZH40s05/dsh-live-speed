window.__ModuleLoader__.load({
  id: 'dsh-live-speed',
  factory: require => {
    const { createElement: h, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } = require('react')
    const { createPortal } = require('react-dom')

    const namespace = 'dsh-live-speed'
    const windowMs = 2500
    const zh = {
      title: '生成速度', waiting: '等待首 token', generating: '生成中', retrying: '等待重试',
      first: '首 token', live: '正文 {rate}', charactersPerSecond: '{value} 字符/s',
      liveText: '实时正文速度', last: '上一步模型吞吐', lastPill: '上一步 {rate}', lastFirst: '上一步首 token',
      average: '会话平均模型吞吐', meanFirst: '平均首 token', model: '模型', tools: '工具',
      modelTotal: '模型总耗时', toolTotal: '工具总耗时', counts: '{turns} 轮 / {steps} 步', turnsSteps: '轮次和步骤',
      close: '关闭', note: '正文速度按浏览器最近收到的正文字数计算。模型吞吐按服务商上报的总输出 token 和 DSH 记录的生成时长计算，可能包含推理和工具参数。',
    }
    const en = {
      title: 'Generation speed', waiting: 'Waiting for first token', generating: 'Generating', retrying: 'Waiting to retry',
      first: 'First token', live: 'Text {rate}', charactersPerSecond: '{value} chars/s',
      liveText: 'Live reply text', last: 'Last step throughput', lastPill: 'Last step {rate}', lastFirst: 'Last step first token',
      average: 'Session throughput', meanFirst: 'Avg. first token', model: 'Model', tools: 'Tools',
      modelTotal: 'Total model time', toolTotal: 'Total tool time', counts: '{turns} turns / {steps} steps', turnsSteps: 'Turns and steps',
      close: 'Close', note: 'Live text speed counts recent reply characters received by this browser. Throughput uses provider-reported output tokens and DSH generation time. It can include reasoning and tool arguments.',
    }

    function duration(ms) {
      if (!Number.isFinite(ms) || ms < 0) return null
      if (ms < 1000) return Math.round(ms) + ' ms'
      if (ms < 60000) return (ms / 1000).toFixed(1) + ' s'
      const seconds = Math.round(ms / 1000)
      return Math.floor(seconds / 60) + ' min ' + seconds % 60 + ' s'
    }

    function tokenRateText(rate) {
      return Number.isFinite(rate) && rate >= 0 ? rate.toFixed(1) + ' tok/s' : null
    }

    function stepOf(snapshot) {
      const timeline = snapshot.timeline
      const turn = timeline.turns.get(timeline.turnOrder.at(-1))
      if (turn?.status !== 'open') return null
      const step = turn.steps.at(-1)
      return step?.status === 'open' && step.start ? step : null
    }

    function stepReading(node) {
      const timing = node?.timing
      const start = timing?.stepStartTime
      const first = timing?.firstTokenTime
      const end = timing?.completedTime
      const output = node?.usage?.outputTokens
      return {
        firstMs: Number.isFinite(start) && Number.isFinite(first) && first >= start ? first - start : null,
        rate: Number.isFinite(first) && Number.isFinite(end) && end > first && Number.isFinite(output) && output > 0
          ? output * 1000 / (end - first)
          : null,
      }
    }

    function windowStart(samples, now) {
      const boundary = samples.findLastIndex(point => point.time <= now - windowMs)
      return Math.max(0, boundary)
    }

    function replyRate(meter, now) {
      const samples = meter?.samples
      if (!samples?.length) return null
      const index = windowStart(samples, now)
      const start = samples[index]
      const boundary = Math.max(start.time, now - windowMs)
      const elapsed = now - boundary
      const next = samples[index + 1]
      // Estimate cumulative characters at the window boundary, rather than
      // counting an entire interval that began before the rolling window.
      const fraction = next && next.time > start.time
        ? Math.min(1, Math.max(0, (boundary - start.time) / (next.time - start.time))) : 0
      const baseline = start.characters + (next ? (next.characters - start.characters) * fraction : 0)
      const characters = samples.at(-1).characters - baseline
      return elapsed >= 300 ? Math.max(0, characters) * 1000 / elapsed : null
    }

    function countReplyCharacters(partial) {
      let total = 0
      for (const block of partial?.blocks ?? []) {
        if (block.kind !== 'text') continue
        total += block.text.length
        for (const character of block.text) total -= character.length - 1
      }
      return total
    }

    function useMeter(attempt, characters) {
      const [meter, setMeter] = useState(null)
      const [now, setNow] = useState(() => ({ wall: Date.now(), mono: performance.now() }))
      useEffect(() => {
        if (attempt === null) {
          setMeter(null)
          return
        }
        const time = performance.now()
        const wall = Date.now()
        setNow({ wall, mono: time })
        setMeter(before => {
          const same = before?.attempt === attempt && characters >= before.characters
          const samples = same ? before.samples.slice(windowStart(before.samples, time)) : [{ time, characters }]
          if (same && characters > before.characters) {
            samples.push({ time, characters })
          }
          return { attempt, characters, samples }
        })
      }, [attempt, characters])
      useEffect(() => {
        if (attempt === null) return
        const timer = setInterval(() => setNow({ wall: Date.now(), mono: performance.now() }), 180)
        return () => clearInterval(timer)
      }, [attempt])
      return { meter: meter?.attempt === attempt ? meter : null, now }
    }

    function StatIcon({ children }) {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
        strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, children)
    }

    function Glyph() {
      return h(StatIcon, null, h('path', { d: 'm12 14 4-4M3.34 19a10 10 0 1 1 17.32 0' }))
    }

    function ChipIcon() {
      return h(StatIcon, null,
        h('rect', { x: 7, y: 7, width: 10, height: 10, rx: 2 }),
        h('rect', { x: 10.5, y: 10.5, width: 3, height: 3 }),
        h('path', { d: 'M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3' }))
    }

    function WrenchIcon() {
      return h(StatIcon, null,
        h('path', { d: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z' }))
    }

    function pinUsageDialogs() {
      const body = document.body
      const viewport = window.visualViewport
      const positions = new Map()
      const usageDetails = '[data-session-stats-usage], [data-turn-usage-details]'

      function place() {
        const leftEdge = viewport?.offsetLeft ?? 0
        const topEdge = viewport?.offsetTop ?? 0
        const right = leftEdge + (viewport?.width ?? window.innerWidth) - 12
        const bottom = topEdge + (viewport?.height ?? window.innerHeight) - 12
        const frameTop = parseFloat(getComputedStyle(body).getPropertyValue('--dsh-frame-overlay-top')) || 0
        const top = Math.max(topEdge + 12, frameTop)
        for (const [panel, origin] of positions) {
          panel.style.setProperty('--dsh-speed-pin-width', Math.max(0, right - leftEdge - 12) + 'px')
          panel.style.setProperty('--dsh-speed-pin-height', Math.max(0, bottom - top) + 'px')
          panel.style.setProperty('--dsh-speed-pin-left', Math.max(leftEdge + 12, Math.min(origin.left, right - panel.offsetWidth)) + 'px')
          panel.style.setProperty('--dsh-speed-pin-top', Math.max(top, Math.min(origin.top, bottom - panel.offsetHeight)) + 'px')
        }
      }

      const resize = new ResizeObserver(place)
      function unpin(panel) {
        resize.unobserve(panel)
        positions.delete(panel)
        delete panel.dataset.dshSpeedPinnedUsage
        for (const field of ['width', 'height', 'left', 'top']) panel.style.removeProperty('--dsh-speed-pin-' + field)
      }

      function sync() {
        for (const panel of positions.keys()) {
          if (panel.parentElement !== body) unpin(panel)
        }
        // The stock dialog is portaled directly into body. Capture its native
        // placement once, while the trigger is still in view.
        for (const panel of body.querySelectorAll(':scope > [role="dialog"]')) {
          if (positions.has(panel) || !panel.querySelector(usageDetails)) continue
          const { left, top } = panel.getBoundingClientRect()
          positions.set(panel, { left, top })
          panel.dataset.dshSpeedPinnedUsage = ''
          resize.observe(panel)
        }
        if (positions.size) place()
      }

      const observer = new MutationObserver(sync)
      observer.observe(body, { childList: true })
      window.addEventListener('resize', place)
      viewport?.addEventListener('resize', place)
      viewport?.addEventListener('scroll', place)
      sync()
      return () => {
        observer.disconnect()
        for (const panel of positions.keys()) unpin(panel)
        resize.disconnect()
        window.removeEventListener('resize', place)
        viewport?.removeEventListener('resize', place)
        viewport?.removeEventListener('scroll', place)
      }
    }

    function StatsDialog({ id, rootRef, anchorRef, close, t, rows }) {
      const panel = useRef(null)
      const [position, setPosition] = useState(null)
      useLayoutEffect(() => {
        function place() {
          if (!anchorRef.current || !panel.current) return
          const anchor = anchorRef.current.getBoundingClientRect()
          const viewport = window.visualViewport
          const offset = viewport?.offsetLeft ?? 0
          const width = viewport?.width ?? window.innerWidth
          const panelWidth = panel.current.offsetWidth
          const left = Math.max(offset + 12, Math.min(anchor.left, offset + width - panelWidth - 12))
          const viewportTop = viewport?.offsetTop ?? 0
          const maxHeight = Math.min((viewport?.height ?? window.innerHeight) * 0.62, Math.max(0, anchor.top - viewportTop - 20))
          setPosition({ left, bottom: window.innerHeight - anchor.top + 8, maxHeight })
        }
        place()
        const viewport = window.visualViewport
        window.addEventListener('resize', place)
        viewport?.addEventListener('resize', place)
        viewport?.addEventListener('scroll', place)
        return () => {
          window.removeEventListener('resize', place)
          viewport?.removeEventListener('resize', place)
          viewport?.removeEventListener('scroll', place)
        }
      }, [anchorRef])
      // Wait for the visible positioned DOM commit before moving focus.
      useLayoutEffect(() => {
        if (position !== null) panel.current?.focus({ preventScroll: true })
      }, [position !== null])
      useEffect(() => {
        function outside(event) {
          if (!rootRef.current?.contains(event.target) && !panel.current?.contains(event.target)) close(false)
        }
        function escape(event) {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          close(true)
        }
        document.addEventListener('pointerdown', outside)
        document.addEventListener('click', outside, true)
        document.addEventListener('keydown', escape, true)
        return () => {
          document.removeEventListener('pointerdown', outside)
          document.removeEventListener('click', outside, true)
          document.removeEventListener('keydown', escape, true)
        }
      }, [close, rootRef])
      return createPortal(h('div', { id, ref: panel, className: 'dsh-speed-panel', role: 'dialog', tabIndex: -1,
        'aria-label': t('title'), style: position ?? { visibility: 'hidden' } },
        h('header', null, h(Glyph), h('strong', null, t('title')),
          h('button', { type: 'button', onClick: () => close(true), 'aria-label': t('close') },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor',
              strokeWidth: 1.6, strokeLinecap: 'round', 'aria-hidden': true },
              h('path', { d: 'M3.5 3.5l9 9m0-9-9 9' })))),
        h('dl', null, rows.filter(([, value]) => value != null).map(([key, value, accent]) =>
          h('div', { key, className: 'dsh-speed-row', 'data-accent': accent || undefined },
            h('dt', null, t(key)), h('dd', null, value)))),
        h('p', null, t('note'))), document.body)
    }

    function Activity({ useChat, useSession, useProjection, useMode, t, timing, nativeRetry, trajectoryLast }) {
      const step = useChat(stepOf)
      const partial = useChat(snapshot => snapshot.legacy.partial)
      const chatLast = useChat(snapshot => snapshot.legacy.nodes.findLast(node => node.kind === 'assistant' && !node.interrupted))
      const running = useSession(snapshot => snapshot.running)
      const stats = useProjection('sessionStats')
      const compact = useMode(value => value) === 'compact'
      const last = trajectoryLast && (!chatLast || trajectoryLast.seq >= chatLast.seq) ? trajectoryLast : chatLast
      const settled = step && last?.turn === step.turn && last.step === step.step
      const active = running && step && !settled
      const retrying = active && nativeRetry?.turn === step.turn && nativeRetry.step === step.step
        && nativeRetry.status === 'running' ? nativeRetry.retry : undefined
      const attempt = active ? String(step.start.seq) + '/' + (retrying ?? 0) : null
      const current = active && partial?.turn === step.turn && partial.step === step.step ? partial : null
      const characters = useMemo(() => countReplyCharacters(current), [current])
      const { meter, now } = useMeter(attempt, characters)
      const liveRate = replyRate(meter, now.mono)
      const liveRateLabel = liveRate === null ? null : t('charactersPerSecond', { value: liveRate.toFixed(1) })
      const lastReading = stepReading(last)
      const elapsed = active ? Math.max(0, now.wall - step.start.time) : 0
      // Native timing is step-level (including retries), not per-attempt TTFT.
      const recordedFirst = timing?.turn === step?.turn && timing?.step === step?.step
        ? timing?.timing?.firstTokenTime : null
      const liveFirst = active && Number.isFinite(recordedFirst) ? Math.max(0, recordedFirst - step.start.time) : null
      const waiting = active && characters === 0 && liveFirst === null
      const speedStatus = active ? (waiting ? 'waiting' : 'live') : 'idle'
      const firstLabel = waiting
        ? retrying ? t('retrying') : t('waiting') + ' ' + duration(elapsed)
        : active ? (liveFirst === null ? t('generating') : t('first') + ' ' + duration(liveFirst))
          : lastReading.firstMs === null ? null : t('first') + ' ' + duration(lastReading.firstMs)
      const lastRate = tokenRateText(lastReading.rate)
      const rate = active
        ? liveRateLabel && t('live', { rate: liveRateLabel })
        : lastRate && t('lastPill', { rate: lastRate })
      const modelMs = stats ? stats.llmMs + elapsed : active ? elapsed : null
      const tools = duration(stats?.toolMs)
      const model = duration(modelMs)
      const average = stats?.decodeMs > 0 ? tokenRateText(stats.decodeTokens * 1000 / stats.decodeMs) : null
      const count = stats?.steps > 0 ? t('counts', { turns: stats.turns, steps: stats.steps }) : null
      const segments = [firstLabel, rate].filter(Boolean)

      const [open, setOpen] = useState(false)
      const panelId = useId()
      const rootRef = useRef(null)
      const anchorRef = useRef(null)
      useEffect(() => { if (compact) setOpen(false) }, [compact])
      function close(restore) {
        setOpen(false)
        if (restore) anchorRef.current?.focus()
      }
      if (!segments.length && (compact || !count)) return null
      const label = segments.join(' · ') || count
      const reading = segments.length === 2
        ? h('span', { className: 'dsh-speed-label' }, segments[0],
            h('span', { className: 'dsh-speed-separator', 'aria-hidden': true }, '·'), segments[1])
        : h('span', { className: 'dsh-speed-label' }, label)
      const common = [active ? h('span', { className: 'dsh-speed-dot', 'aria-hidden': true }) : h(Glyph), reading]
      return h('span', { ref: rootRef, className: 'dsh-speed-root', 'data-composer-stat': 'activity',
        'data-live-speed': true, 'data-speed-state': speedStatus,
        'data-speed-cps': active ? liveRate ?? undefined : undefined,
        'data-speed-tps': active ? undefined : lastReading.rate ?? undefined },
        compact ? h('span', { className: 'dsh-speed-pill', title: label }, ...common)
          : h('button', { ref: anchorRef, type: 'button', className: 'dsh-speed-pill',
              title: label, 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': open, 'aria-controls': open ? panelId : undefined,
              onClick: () => setOpen(value => !value) }, ...common),
        !compact && model && modelMs > 0 ? h('span', { className: 'dsh-speed-extra', title: t('modelTotal') },
          h(ChipIcon), h('span', { className: 'dsh-speed-label' }, t('model') + ' ' + model)) : null,
        !compact && tools && (active || count) ? h('span', { className: 'dsh-speed-extra', title: t('toolTotal') },
          h(WrenchIcon), h('span', { className: 'dsh-speed-label' }, t('tools') + ' ' + tools)) : null,
        !compact && open ? h(StatsDialog, { id: panelId, anchorRef, rootRef, close, t, rows: [
          ['liveText', active ? liveRateLabel : null, true], ['first', active ? duration(liveFirst) : null, true],
          ['last', lastRate], ['lastFirst', duration(lastReading.firstMs), !active], ['average', average],
          ['turnsSteps', count], ['modelTotal', model], ['toolTotal', tools],
          ['meanFirst', stats?.ttftSteps > 0 ? duration(stats.ttftMs / stats.ttftSteps) : null],
        ] }) : null)
    }

    function TimedActivity({ useTrajectory, ...props }) {
      const timing = useTrajectory(snapshot => snapshot.partial)
      const retry = useTrajectory(snapshot => snapshot.requests.findLast(item => item.purpose === 'assistant') ?? null)
      const trajectoryLast = useTrajectory(snapshot => snapshot.eventNodes.findLast(node => node.kind === 'assistant' && !node.interrupted))
      return h(Activity, { ...props, timing, nativeRetry: retry, trajectoryLast })
    }

    function Entry(props) {
      return h(typeof props.useTrajectory === 'function' ? TimedActivity : Activity, { ...props, key: props.sessionId })
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(namespace, { zh, en }))
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshLiveSpeed = ''
        style.textContent = styles
        document.head.append(style)
        return () => style.remove()
      })
      ctx.effect(pinUsageDialogs)
      const form = ctx.configForms.get('ui-chat')
      const mode = {
        getSnapshot: () => form.getSnapshot().value?.performanceUsage ?? 'detailed',
        subscribe: listener => form.subscribe(listener),
      }
      ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock', id: 'activity', order: 0, priority: -10, locale: namespace,
        inject: () => ({ hooks: { mode } }),
      }, Entry)))
    }

    const styles = [
      '.dsh-speed-root{display:inline-flex;align-items:center;gap:6px;min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}',
      '.dsh-speed-pill,.dsh-speed-extra{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;box-sizing:border-box;white-space:nowrap;border:0;border-radius:var(--dsw-radius-sm);padding:1px 8px;color:var(--dsw-alias-label-tertiary);background:transparent;font:inherit;font-variant-numeric:tabular-nums;line-height:inherit}',
      '.dsh-speed-label{min-width:0;overflow:hidden;text-overflow:ellipsis}.dsh-speed-separator{color:var(--dsw-alias-separator-primary);margin-inline:6px}.dsh-speed-pill>svg,.dsh-speed-extra>svg,.dsh-speed-dot{flex:none}',
      'button.dsh-speed-pill{cursor:pointer}button.dsh-speed-pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '@media(hover:hover){button.dsh-speed-pill:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}}',
      '.dsh-speed-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-accent-label-primary,#4c8dff);animation:dsh-speed-pulse 1s ease-in-out infinite}',
      '@keyframes dsh-speed-pulse{0%,100%{opacity:.25}50%{opacity:1}}',
      '@media(prefers-reduced-motion:reduce){.dsh-speed-dot{animation:none;opacity:1}}',
      '@media(max-width:720px){.dsh-speed-extra{display:none}}',
      '.dsh-speed-panel{position:fixed;z-index:1100;width:min(322px,calc(100vw - 24px));max-height:62vh;overflow:auto;box-sizing:border-box;padding:12px;display:flex;flex-direction:column;gap:8px;border-radius:var(--dsw-radius-lg,16px);background:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-2,Canvas));backdrop-filter:var(--dsw-menu-backdrop-filter);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary,CanvasText);font-size:12.5px;line-height:1.5}',
      '@supports not (backdrop-filter:blur(1px)){.dsh-speed-panel{background:var(--dsw-alias-bg-layer-2,Canvas)}}',
      '.dsh-speed-panel header{display:flex;gap:8px;align-items:center;font-size:13px}',
      '.dsh-speed-panel header button{display:inline-flex;margin-inline-start:auto;padding:4px;border:0;border-radius:8px;background:transparent;color:inherit;cursor:pointer}.dsh-speed-panel header button:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.dsh-speed-panel dl{display:grid;gap:6px;margin:0}.dsh-speed-row{display:flex;align-items:baseline;justify-content:space-between;gap:12px;border-radius:8px;padding:5px 8px;background:var(--dsw-alias-interactive-bg-hover-solid,rgba(130,140,160,.12))}.dsh-speed-row dt,.dsh-speed-panel p{color:var(--dsw-alias-label-secondary,inherit)}.dsh-speed-row dd{margin:0;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}.dsh-speed-row[data-accent=true] dd{color:var(--dsw-alias-accent-label-primary,#4c8dff)}.dsh-speed-panel p{margin:0;font-size:11px;line-height:1.5}',
      '[data-dsh-speed-pinned-usage]{position:fixed!important;position-anchor:auto!important;position-area:none!important;position-try-fallbacks:none!important;place-self:auto!important;inset:var(--dsh-speed-pin-top) auto auto var(--dsh-speed-pin-left)!important;max-height:var(--dsh-speed-pin-height)!important;min-width:min(300px,var(--dsh-speed-pin-width))!important;max-width:min(440px,var(--dsh-speed-pin-width))!important}',
    ].join('\n')

    return { name: namespace, inject: ['slots', 'locale', 'configForms'], apply }
  },
})

