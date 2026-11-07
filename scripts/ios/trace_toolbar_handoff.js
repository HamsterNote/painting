// Optional, passive DOM geometry evidence for HAM-175 targeted cases only.
// Install after the untouched acceptance matrix. Never focus, click, repair
// scope, prevent defaults, or read typed values. Reinstall replaces our listener.
(() => {
  window.__ham175HandoffTrace?.stop();
  const rows = [];
  const frames = new Set();
  const element = (node) => {
    if (!(node instanceof Element)) return null;
    const rect = node.isConnected ? node.getBoundingClientRect().toJSON() : null;
    return {
      tag: node.tagName,
      type: node.getAttribute('type'),
      checked: node.matches('input[type=radio],input[type=checkbox]') ? node.checked : null,
      rect,
    };
  };
  const record = (type, phase, target, point) => {
    rows.push({
      at: new Date().toISOString(),
      type,
      phase,
      point,
      target: element(target),
      active: element(document.activeElement),
      innerHeight: window.innerHeight,
      viewport: { height: window.visualViewport?.height, top: window.visualViewport?.offsetTop },
      panel: element(document.querySelector('.hn-painting-panel')),
      labels: [...document.querySelectorAll('.hn-painting-panel label')].map((label) => ({
        ...element(label),
        control: element(label.control),
      })),
      bridge: window.__paintingToolbarKeyboard?.snapshot(),
    });
    if (rows.length > 300) rows.shift();
  };
  const events = [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mouseup',
    'click',
    'focusin',
    'focusout',
  ];
  const observe = (event) => {
    const point = 'clientX' in event ? { x: event.clientX, y: event.clientY } : null;
    record(event.type, 'event', event.target, point);
    if (event.type === 'pointerup' || event.type === 'click') {
      const frame = requestAnimationFrame(() => {
        frames.delete(frame);
        record(event.type, 'frame', event.target, point);
      });
      frames.add(frame);
    }
  };
  const resize = () => record('resize', 'event', null, null);
  events.forEach((type) =>
    document.addEventListener(type, observe, { capture: true, passive: true })
  );
  window.addEventListener('resize', resize, { passive: true });
  window.visualViewport?.addEventListener('resize', resize, { passive: true });
  window.__ham175HandoffTrace = {
    snapshot: () => rows.slice(),
    stop: () => {
      events.forEach((type) => document.removeEventListener(type, observe, true));
      window.removeEventListener('resize', resize);
      window.visualViewport?.removeEventListener('resize', resize);
      frames.forEach(cancelAnimationFrame);
      frames.clear();
    },
  };
})();
