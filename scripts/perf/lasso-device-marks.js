// Test-only bootstrap: paste in Web Inspector on ?lassoPerf=1, or install as a
// WKUserScript atDocumentStart in the test host. Never include in release apps.
(() => {
  window.__paintingLassoPerfStop?.();
  const marks = [],
    pointers = [],
    frames = [];
  const previous = window.__paintingTestLassoPerf;
  let running = true;
  const record = (detail) => {
    const time = performance.now();
    marks.push({ time, ...detail });
    try {
      performance.mark('painting:test:lasso', { detail });
    } catch {
      /* Older User Timing implementation. */
    }
    return time;
  };
  window.__paintingTestLassoPerf = (detail) => {
    if (!running) return;
    const submittedAt = record(detail);
    if (detail.event === 'selection-submit')
      requestAnimationFrame(() => {
        if (running) record({ ...detail, event: 'selection-opportunity', submittedAt });
      });
  };
  const frame = () => {
    if (!running) return;
    frames.push(performance.now());
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const pointer = (event) => {
    let samples = [event];
    try {
      if (event.type === 'pointermove' && event.getCoalescedEvents?.().length)
        samples = event.getCoalescedEvents();
    } catch {
      /* Parent sample fallback. */
    }
    pointers.push({
      phase: event.type,
      delivered: performance.now(),
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      isTrusted: event.isTrusted,
      samples: [...samples].map((sample) => ({
        time:
          sample.timeStamp > 1e12 ? sample.timeStamp - performance.timeOrigin : sample.timeStamp,
        x: sample.clientX,
        y: sample.clientY,
        pressure: sample.pressure,
      })),
    });
  };
  const phases = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
  phases.forEach((phase) => window.addEventListener(phase, pointer, true));
  window.__paintingLassoPerfExport = () =>
    JSON.stringify({
      userAgent: navigator.userAgent,
      timeOrigin: performance.timeOrigin,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
      visibility: document.visibilityState,
      marks,
      pointers,
      frames,
    });
  window.__paintingLassoPerfStop = () => {
    running = false;
    phases.forEach((phase) => window.removeEventListener(phase, pointer, true));
    window.__paintingTestLassoPerf = previous;
  };
})();
