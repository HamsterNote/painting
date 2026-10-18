import type { GestureTraceEntry, LayeredEditorController } from '@hamster-note/painting/layered';

export const GESTURE_TRACE_LIMIT = 2048;

/** Fixed-size ring: pointer moves do not cause React renders or copy the stroke/document. */
export function createGestureTrace(controller: LayeredEditorController) {
  type Entry = GestureTraceEntry & { sequence: number; at: number };
  const entries: Entry[] = [];
  const counts: Record<string, number> = {};
  const startedAt = new Date().toISOString();
  let total = 0;
  const record = (entry: GestureTraceEntry) => {
    const key = `${entry.scope}:${entry.action}:${entry.reason ?? ''}`;
    counts[key] = (counts[key] ?? 0) + 1;
    entries[total % GESTURE_TRACE_LIMIT] = { ...entry, sequence: ++total, at: performance.now() };
  };
  const snapshot = () => {
    const interaction = controller.getSnapshot('interaction');
    const active = interaction.activeFreehand;
    const surface = document.querySelector('[data-testid="layered-surface"]');
    const rect = surface?.getBoundingClientRect();
    return {
      version: 1,
      startedAt,
      exportedAt: new Date().toISOString(),
      environment: {
        userAgent: navigator.userAgent,
        maxTouchPoints: navigator.maxTouchPoints,
        devicePixelRatio: window.devicePixelRatio,
        secureContext: window.isSecureContext,
        width: rect?.width,
        height: rect?.height,
        touchAction: surface ? getComputedStyle(surface).touchAction : undefined,
      },
      state: {
        tool: controller.getSnapshot('tools').activeTool,
        viewport: controller.getSnapshot('viewport'),
        navigation: controller.getSnapshot('navigation'),
        objectCount: controller.getSnapshot('document').objects.length,
        pendingCommits: interaction.pendingCandidates.map((candidate) => candidate.commitId),
        active:
          active?.status === 'collecting'
            ? {
                sessionId: active.sessionId,
                pointerId: active.pointerId,
                source: active.source,
                sampleCount: active.samples.length,
              }
            : null,
      },
      limit: GESTURE_TRACE_LIMIT,
      total,
      dropped: Math.max(0, total - GESTURE_TRACE_LIMIT),
      counts: { ...counts },
      entries:
        total <= GESTURE_TRACE_LIMIT
          ? [...entries]
          : [
              ...entries.slice(total % GESTURE_TRACE_LIMIT),
              ...entries.slice(0, total % GESTURE_TRACE_LIMIT),
            ],
    };
  };
  return { record, snapshot };
}

export type GestureTrace = ReturnType<typeof createGestureTrace>;
