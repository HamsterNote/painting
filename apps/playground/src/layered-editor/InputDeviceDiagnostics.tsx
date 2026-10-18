import { useLayoutEffect, useState } from 'react';

const phases = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;

/** Observe before arbitration, including hits blocked by pointer-events or browser gestures. */
export function InputDeviceDiagnostics() {
  const [output, setOutput] = useState('Input diagnostics: waiting for mount');
  useLayoutEffect(() => {
    const counts = Object.fromEntries(
      ['touch', 'pen', 'mouse', 'unknown'].map((s) => [s, [0, 0, 0, 0]])
    );
    const contacts = new Set<number>();
    let last = 'none';
    let lastDown = 'none';
    let error = 'none';
    let touchEvents = 0;
    const surface = () => document.querySelector<HTMLElement>('[data-testid="layered-surface"]');
    function pointer(event: PointerEvent) {
      const host = surface();
      if (!host) return;
      const rect = host.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (event.type === 'pointerdown') {
        if (!inside) return;
        contacts.add(event.pointerId);
      } else if (!contacts.has(event.pointerId)) return;
      const source = ['touch', 'pen', 'mouse'].includes(event.pointerType)
        ? event.pointerType
        : 'unknown';
      counts[source][phases.indexOf(event.type as (typeof phases)[number])]++;
      last = `${event.type} ${event.pointerType} id=${event.pointerId} button=${event.button} pressure=${event.pressure} time=${event.timeStamp} trusted=${event.isTrusted} hit=${host.contains(event.target as Node)}`;
      if (event.type === 'pointerdown') lastDown = last;
      if (event.type === 'pointerup' || event.type === 'pointercancel')
        contacts.delete(event.pointerId);
    }
    const onError = (event: ErrorEvent) => {
      error = event.message.slice(0, 240);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      error = String(event.reason).slice(0, 240);
    };
    const onTouch = () => {
      touchEvents++;
    };
    function update() {
      const host = surface();
      setOutput(
        [
          `Input ready=${host?.dataset.inputReady ?? 'missing'} mode=${host?.dataset.inputMode ?? 'missing'} arbiter=${host?.dataset.inputArbiter ?? 'missing'} pointer-events=${host ? getComputedStyle(host).pointerEvents : 'missing'}`,
          `PointerEvent=${typeof PointerEvent !== 'undefined'} touch-events=${touchEvents} (down/move/up/cancel)`,
          Object.entries(counts)
            .map(([source, count]) => `${source}=${count.join('/')}`)
            .join(' '),
          `last: ${last}`,
          `down: ${lastDown}`,
          `window.error: ${error}`,
          navigator.userAgent,
        ].join('\n')
      );
    }
    for (const phase of phases) window.addEventListener(phase, pointer, true);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('touchstart', onTouch, { capture: true, passive: true });
    update();
    const timer = window.setInterval(update, 250);
    return () => {
      window.clearInterval(timer);
      for (const phase of phases) window.removeEventListener(phase, pointer, true);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('touchstart', onTouch, true);
    };
  }, []);
  return (
    <pre
      data-testid="input-device-diagnostics"
      style={{
        margin: 0,
        padding: 4,
        flexShrink: 0,
        maxHeight: 160,
        overflow: 'auto',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        fontSize: 12,
        background: '#f2f4f5',
        color: '#172026',
        pointerEvents: 'none',
      }}
    >
      {output}
    </pre>
  );
}
