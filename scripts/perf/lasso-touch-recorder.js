// Diagnostic service only. Installed before the frozen application bundle.
(() => {
  const events = [];
  const limit = 5000;
  let total = 0;
  let status = '请选择套索，复现选不中后点“保存诊断”。';
  let label;
  const snapshot = () => {
    const c = window.__layeredEditor;
    if (!c) return null;
    const bounds = document
      .querySelector('[data-testid="layered-surface"]')
      ?.getBoundingClientRect();
    return {
      revision: c.getSnapshot('document').documentRevision,
      objects: c.getSnapshot('document').objects.length,
      selected: [...c.getSnapshot('selection')],
      tool: c.getSnapshot('tools').activeTool,
      input: c.getSnapshot('input'),
      viewport: c.getSnapshot('viewport'),
      surfaceBounds: bounds
        ? { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height }
        : null,
      pending: Boolean(c.getSnapshot('preview').lassoPending),
    };
  };
  function record(event) {
    events[total % limit] = { sequence: ++total, at: performance.now(), ...event };
  }
  function show(text) {
    status = text;
    if (label) label.textContent = text;
  }
  const previous = window.__paintingTestLassoPerf;
  window.__paintingTestLassoPerf = (event) => {
    previous?.(event);
    const terminal = ['query-start', 'query-complete', 'selection-submit', 'cancel'].includes(
      event.event
    );
    record({ kind: 'query', ...event, ...(terminal ? { state: snapshot() } : {}) });
    if (event.event === 'query-start') show('已松手，正在计算选区。');
    if (event.event === 'query-complete' && !event.ok) show('查询返回失败，请保存诊断。');
    if (event.event === 'selection-submit')
      show(`结果已提交：${snapshot()?.selected.length ?? 0} 个对象。`);
    if (event.event === 'cancel') show('套索已取消，请保存诊断。');
  };
  const tracked = new Set();
  for (const type of [
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'gotpointercapture',
    'lostpointercapture',
  ]) {
    window.addEventListener(
      type,
      (event) => {
        const surface = document.querySelector('[data-testid="layered-surface"]');
        if (type === 'pointerdown' && surface?.contains(event.target)) {
          tracked.add(event.pointerId);
          if (tracked.size > 32) tracked.delete(tracked.values().next().value);
          show('正在绘制轨迹。');
        }
        if (!tracked.has(event.pointerId)) return;
        let samples = [event];
        try {
          const coalesced = event.getCoalescedEvents?.();
          if (coalesced?.length) samples = coalesced;
        } catch {
          /* parent sample */
        }
        record({
          kind: 'pointer',
          type,
          id: event.pointerId,
          source: event.pointerType,
          trusted: event.isTrusted,
          captured: surface?.hasPointerCapture?.(event.pointerId),
          target: event.target === surface ? 'surface' : event.target?.tagName,
          samples: Array.from(samples).map((p) => ({
            x: p.clientX,
            y: p.clientY,
            time: p.timeStamp,
            pressure: p.pressure,
          })),
          ...(type !== 'pointermove' ? { state: snapshot() } : {}),
        });
        if (type === 'pointerup') show('已收到松手，等待最终查询。');
        if (type === 'pointercancel') show('浏览器取消了触摸，请保存诊断。');
        // Retain the last ID so normal post-up capture release is observable.
      },
      true
    );
  }
  for (const type of ['touchend', 'touchcancel', 'blur', 'pagehide', 'visibilitychange']) {
    window.addEventListener(
      type,
      (e) =>
        record({
          kind: 'lifecycle',
          type,
          trusted: e.isTrusted,
          target: e.target === window ? 'window' : e.target?.tagName,
          touches: e.touches?.length,
          visibility: document.visibilityState,
          state: snapshot(),
        }),
      true
    );
  }
  window.addEventListener('error', (e) => record({ kind: 'error', message: e.message }));
  const poll = setInterval(() => {
    const c = window.__layeredEditor;
    if (!c) return;
    clearInterval(poll);
    for (const channel of ['document', 'selection', 'tools', 'input'])
      c.subscribe(channel, () => record({ kind: 'state', channel, state: snapshot() }));
    record({ kind: 'ready', state: snapshot() });
  }, 100);
  window.__lassoTouchExport = () => ({
    version: 1,
    productCommit: 'd8189c2',
    createdAt: new Date().toISOString(),
    environment: {
      userAgent: navigator.userAgent,
      maxTouchPoints: navigator.maxTouchPoints,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      url: location.href,
    },
    state: snapshot(),
    total,
    dropped: Math.max(0, total - limit),
    events:
      total <= limit
        ? [...events]
        : [...events.slice(total % limit), ...events.slice(0, total % limit)],
  });
  window.addEventListener('DOMContentLoaded', () => {
    const panel = document.createElement('aside');
    panel.dataset.testid = 'lasso-touch-recorder';
    panel.style.cssText =
      'position:fixed;top:8px;right:8px;z-index:99999;max-width:340px;padding:8px;background:#fff7dc;border:1px solid #aa8d44;border-radius:8px;font:14px system-ui;box-shadow:0 2px 8px #0002';
    label = document.createElement('div');
    label.textContent = status;
    const button = document.createElement('button');
    button.textContent = '保存诊断';
    button.style.cssText = 'margin-top:6px;min-height:40px;padding:4px 16px';
    const save = async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const response = await fetch('/__lasso_diagnostics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(window.__lassoTouchExport()),
        });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const result = await response.json();
        show(`已保存诊断 ${result.id}。请在评论里回复这个编号。`);
      } catch (error) {
        show(`保存失败：${String(error)}。请重试。`);
      } finally {
        button.disabled = false;
      }
    };
    button.onclick = save;
    // The tested page suppresses compatibility clicks after a drawing touch.
    // Handle a touch release on this standalone diagnostic control directly.
    button.addEventListener(
      'touchend',
      (event) => {
        const touch = event.changedTouches[0];
        const rect = button.getBoundingClientRect();
        if (
          !touch ||
          touch.clientX < rect.left ||
          touch.clientX > rect.right ||
          touch.clientY < rect.top ||
          touch.clientY > rect.bottom
        )
          return;
        event.preventDefault();
        void save();
      },
      { passive: false }
    );
    const note = document.createElement('small');
    note.textContent = '仅此诊断页记录事件；点保存后发送到测试机器。';
    note.style.display = 'block';
    panel.append(label, button, note);
    document.body.append(panel);
  });
})();
