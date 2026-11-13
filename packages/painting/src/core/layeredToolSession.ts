import {
  deriveLayeredSelectionGeometry,
  hitLayeredSelectionGeometry,
} from './layeredSelectionGeometry';
import type { LayeredEditorController, LayeredEditorTool } from './layeredEditorController';
import {
  prepareLayeredObjectQuery,
  createControllerObjectQuery,
  createLayeredLassoQuery,
  warmLayeredLasso,
  primeLayeredLassoIndex,
  queryObjectPoint,
  queryObjectSweep,
} from './layeredObjectQuery';
import { layeredGeometryCache } from './layeredGeometryCache';
import type { LayeredSelectionFrame } from './layeredSelectionFrame';
import { applyAffine, composeAffine } from '../geometry/affine';
import { deriveShapeGeometry } from '../geometry/shape';
import {
  IDENTITY_TRANSFORM,
  type DocumentObject,
  type Point,
  type ShapeObject,
} from '../model/document';

export type SelectionOperation = 'move' | 'resize' | 'rotate';
type ToolGesture = {
  tool: LayeredEditorTool;
  operation: SelectionOperation;
  revision: number;
  frame?: LayeredSelectionFrame;
  nextFrame?: LayeredSelectionFrame;
  angle: number;
  lastAngle?: number;
  points: Point[];
  originals: readonly DocumentObject[];
  replacements: readonly DocumentObject[];
  hidden: Set<string>;
  previousSelection: readonly string[];
  pathVersion: number;
  perfSession: number;
  pending?: boolean;
  placement?: {
    stage: number;
    anchors: Point[];
    cursor: Point;
    addedVertex?: boolean;
  };
};

export type LayeredToolScheduler = {
  frame(callback: () => void): () => void;
  work(callback: () => void): () => void;
  now(): number;
  idle?(callback: (budgetMs: number) => void): () => void;
};

/** Internal, opt-in measurement hook. No clock/marks/observer runs unless installed by a test. */
export type LassoPerformanceEvent = {
  event:
    'input' | 'query-start' | 'query-complete' | 'selection-submit' | 'cancel' | 'phase' | 'warmup';
  phase?:
    | 'prepare'
    | 'canonicalize'
    | 'candidates'
    | 'exact'
    | 'fallback'
    | 'warmup-synthetic'
    | 'warmup-prepare'
    | 'warmup-index';
  complete?: boolean;
  durationMs?: number;
  count?: number;
  session: number;
  version: number;
  pointCount: number;
  final: boolean;
  ok?: boolean;
};

/** The same geometry-driven gesture path is used by DOM and future semantic batches. */
export function createLayeredToolSession(
  controller: LayeredEditorController,
  allocateId: () => string,
  options: {
    scheduler?: LayeredToolScheduler;
    onError?: (error: unknown) => void;
    onPerf?: (event: LassoPerformanceEvent) => void;
  } = {}
) {
  const cache = layeredGeometryCache(controller);
  let gesture: ToolGesture | undefined;
  let prepared: ReturnType<typeof prepareLayeredObjectQuery>;
  let preparedDocument: ReturnType<LayeredEditorController['getSnapshot']> | undefined;
  let stopFrame: (() => void) | undefined;
  let stopWork: (() => void) | undefined;
  let stopIdle: (() => void) | undefined;
  let idleEpoch = 0;
  let inputBusy = false;
  let syntheticReady = false;
  let idleNeedsIndex = false;
  let idlePreparation: ReturnType<typeof createControllerObjectQuery> | undefined;
  let idleDocument: ReturnType<LayeredEditorController['getSnapshot']> | undefined;
  let destroyed = false;
  let perfSession = 0;
  const perf = (
    current: ToolGesture,
    event: LassoPerformanceEvent['event'],
    final = false,
    version = current.pathVersion,
    pointCount = current.points.length,
    ok?: boolean
  ) => {
    if (!options.onPerf || current.tool !== 'lasso') return;
    // Diagnostics must never cancel or otherwise change a user's gesture.
    try {
      options.onPerf({ event, session: current.perfSession, version, pointCount, final, ok });
    } catch {
      /* Test observer errors are isolated from editing. */
    }
  };
  const scheduler = options.scheduler;
  const clearScheduled = () => {
    stopFrame?.();
    stopFrame = undefined;
    stopWork?.();
    stopWork = undefined;
  };
  const requireValue = <T>(
    result: { ok: true; value: T } | { ok: false; error: { code: string } }
  ): T => {
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };
  const cancel = () => {
    const previous = gesture;
    if (previous) perf(previous, 'cancel');
    clearScheduled();
    gesture = undefined;
    if (
      previous?.tool === 'lasso' &&
      previous.revision === controller.getSnapshot('document').documentRevision
    )
      controller.setSelection(previous.previousSelection);
    controller.setPreview(null);
    resumeWarmup();
  };
  const unsubscribeTools = controller.subscribe('tools', () => {
    if (gesture && controller.getSnapshot('tools').activeTool !== gesture.tool) cancel();
  });
  const unsubscribeSelection = controller.subscribe('selection', () => {
    if (
      gesture?.tool === 'selection' &&
      gesture.frame?.sessionId !== controller.getSnapshot('selectionFrame')?.sessionId
    )
      cancel();
  });
  let inputMode = controller.getSnapshot('input').mode;
  const unsubscribeInput = controller.subscribe('input', () => {
    const next = controller.getSnapshot('input').mode;
    if (next !== inputMode) {
      inputMode = next;
      if (gesture) cancel();
    }
  });
  const unsubscribeDocument = controller.subscribe('document', () => {
    clearScheduled();
    gesture = undefined;
    preparedDocument = undefined;
    cache.syncDocument(controller.getSnapshot('document'));
    idlePreparation = undefined;
    idleDocument = undefined;
    idleNeedsIndex = false;
    stopIdle?.();
    stopIdle = undefined;
    idleEpoch++;
    scheduleWarmup();
  });

  const active = (current: ToolGesture) =>
    gesture === current &&
    current.revision === controller.getSnapshot('document').documentRevision &&
    !destroyed;
  function pauseWarmup() {
    inputBusy = true;
    idleEpoch++;
    stopIdle?.();
    stopIdle = undefined;
  }
  function resumeWarmup() {
    inputBusy = false;
    scheduleWarmup();
  }
  function scheduleWarmup() {
    if (!scheduler?.idle || stopIdle || destroyed || inputBusy || gesture) return;
    if (
      syntheticReady &&
      !idleNeedsIndex &&
      preparedDocument === controller.getSnapshot('document')
    )
      return;
    const epoch = idleEpoch;
    let called = false;
    stopIdle = scheduler.idle((available) => {
      if (called || epoch !== idleEpoch || destroyed || inputBusy || gesture) return;
      called = true;
      stopIdle = undefined;
      // Native input may not deliver DOM pointerdown. Check only at idle, never
      // subscribe to every sample and copy the accumulating interaction snapshot.
      if (controller.getSnapshot('interaction').activeFreehand) return;
      const budget = Math.min(8, Math.max(0, available));
      if (budget < 1) {
        scheduleWarmup();
        return;
      }
      const start = scheduler.now();
      let phase: LassoPerformanceEvent['phase'];
      let complete = false;
      try {
        if (!syntheticReady) {
          phase = 'warmup-synthetic';
          syntheticReady = warmLayeredLasso(scheduler.now, budget);
          complete = syntheticReady;
        } else if (idleNeedsIndex) {
          phase = 'warmup-index';
          primeLayeredLassoIndex(requireValue(prepared));
          idleNeedsIndex = false;
          complete = true;
        } else {
          const document = controller.getSnapshot('document');
          if (idleDocument !== document) {
            idlePreparation = createControllerObjectQuery(controller, cache);
            idleDocument = document;
          }
          phase = 'warmup-prepare';
          const result = idlePreparation!.step(scheduler.now, budget);
          if (result) {
            requireValue(result);
            prepared = result;
            idleNeedsIndex = true;
            preparedDocument = document;
            idlePreparation = undefined;
            idleDocument = undefined;
            complete = true;
          }
        }
        try {
          options.onPerf?.({
            event: 'warmup',
            phase,
            durationMs: scheduler.now() - start,
            complete,
            session: 0,
            version: controller.getSnapshot('document').documentRevision,
            pointCount: 0,
            final: false,
          });
        } catch {
          /* instrumentation never changes editing */
        }
        if (epoch === idleEpoch) scheduleWarmup();
      } catch {
        // Idle preparation is optional. A real query retains the existing error path.
        idlePreparation = undefined;
        idleDocument = undefined;
      }
    });
  }

  function prepareQuery() {
    const document = controller.getSnapshot('document');
    if (preparedDocument !== document) {
      prepared = createControllerObjectQuery(controller, cache).step(() => 0, Infinity)!;
      requireValue(prepared);
      preparedDocument = document;
    }
    return requireValue(prepared);
  }

  function finishLasso(current: ToolGesture) {
    current.pending = true;
    const document = controller.getSnapshot('document');
    // Transfer ownership of partial idle preparation to this final query. Input
    // has paused the idle callback; never repeat work or share a mutable cursor.
    let preparation = idleDocument === document ? idlePreparation : undefined;
    idlePreparation = undefined;
    idleDocument = undefined;
    let query: ReturnType<typeof createLayeredLassoQuery> | undefined;
    let started = false;
    let exactMs = 0,
      exactCount = 0;
    const phase = (phase: LassoPerformanceEvent['phase'], durationMs: number, count?: number) => {
      try {
        options.onPerf?.({
          event: 'phase',
          phase,
          durationMs,
          count,
          session: current.perfSession,
          version: current.pathVersion,
          pointCount: current.points.length,
          final: true,
        });
      } catch {
        /* observer isolation */
      }
    };
    const now = scheduler?.now ?? (() => 0);
    const budget = scheduler ? 8 : Infinity;
    const enqueue = () => {
      let called = false;
      stopWork = scheduler!.work(() => {
        if (called || !active(current)) return;
        called = true;
        stopWork = undefined;
        run();
      });
    };
    const run = () => {
      if (!active(current)) return;
      try {
        if (!started) {
          started = true;
          perf(current, 'query-start', true);
          if (!active(current)) return;
        }
        if (preparedDocument !== document) {
          preparation ??= createControllerObjectQuery(controller, cache);
          const before = options.onPerf ? now() : 0;
          const result = preparation.step(now, budget);
          if (options.onPerf) phase('prepare', now() - before);
          if (!active(current)) return;
          if (!result) return enqueue();
          prepared = result;
          requireValue(prepared);
          preparedDocument = document;
          // Let input/paint run between preparation and exact testing.
          if (scheduler) return enqueue();
        }
        query ??= createLayeredLassoQuery(
          requireValue(prepared),
          current.points,
          options.onPerf
            ? {
                now,
                onPhase: phase,
                onObject: (_id, ms) => {
                  exactMs += ms;
                  exactCount++;
                },
                onFallback: (_id, ms) => phase('fallback', ms, 1),
              }
            : undefined
        );
        const result = query.ok ? query.value.step(now, budget) : query;
        if (!result) return enqueue();
        if (options.onPerf) phase('exact', exactMs, exactCount);
        perf(current, 'query-complete', true, undefined, undefined, result.ok);
        if (!active(current)) return;
        gesture = undefined;
        clearScheduled();
        if (result.ok) {
          const selected = result.value.map((hit) => hit.objectId);
          controller.setSelection(selected);
          perf(current, 'selection-submit', true, undefined, undefined, true);
          if (selected.length) controller.setTool('selection');
        }
        controller.setPreview(null);
        resumeWarmup();
      } catch (error) {
        if (active(current)) cancel();
        options.onError?.(error);
      }
    };
    if (!scheduler) run();
    else {
      requireValue(
        controller.setPreview({
          objects: [],
          hiddenIds: [],
          path: current.points,
          lassoPending: true,
        })
      );
      // The path is already visible and pending state is published above. Yield
      // out of input handling, then do bounded work without waiting an extra
      // animation frame before the first chunk. Paint can run between chunks.
      enqueue();
    }
  }

  function scheduleLasso(current: ToolGesture) {
    const publish = () => {
      // A cancelled frame may still arrive after end, a new session or a document edit.
      if (!active(current) || current.pending) return;
      stopFrame = undefined;
      try {
        controller.setPreview({ objects: [], hiddenIds: [], path: current.points });
      } catch (error) {
        cancel();
        options.onError?.(error);
      }
    };
    // Sampling only records the path. Geometry preparation and selection both wait for end.
    if (!scheduler) publish();
    else if (!stopFrame) stopFrame = scheduler.frame(publish);
  }

  function pointHits(point: Point) {
    const document = controller.getSnapshot('document');
    const query = requireValue(prepareLayeredObjectQuery(document, cache));
    return requireValue(
      queryObjectPoint(query, point, 3 / controller.getSnapshot('viewport').viewport.scale)
    );
  }

  function previewShape(shapeType: ShapeObject['shapeType'], points: readonly Point[]) {
    const shape: ShapeObject = {
      kind: 'shape',
      objectId: 'preview-shape',
      objectRevision: 1,
      transformRevision: 1,
      transform: IDENTITY_TRANSFORM,
      shapeType,
      points,
      style: controller.getSnapshot('tools').settings.shape,
    };
    return deriveShapeGeometry(shape) ? [shape] : [];
  }

  function updatePlacement(point: Point) {
    const current = gesture!;
    const draft = current.placement!;
    draft.cursor = { ...point };
    if (current.tool === 'polygon') {
      requireValue(
        controller.setPreview({
          objects: [],
          hiddenIds: [],
          path: [...draft.anchors, draft.cursor],
        })
      );
      return;
    }
    const index = draft.stage === 0 ? 3 : draft.stage;
    draft.anchors[index] = draft.cursor;
    if (draft.stage === 0) draft.anchors[2] = draft.cursor;
    current.replacements = previewShape(
      draft.stage === 0 ? 'line' : 'bezier',
      draft.stage === 0 ? [draft.anchors[0], draft.anchors[3]] : [...draft.anchors]
    );
    requireValue(controller.setPreview({ objects: current.replacements, hiddenIds: [], path: [] }));
  }

  function update(points: readonly Point[]) {
    if (!gesture || gesture.pending || !points.length) return;
    if (gesture.revision !== controller.getSnapshot('document').documentRevision) {
      cancel();
      return;
    }
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
      throw new Error('invalid-input');
    if (gesture.placement) {
      updatePlacement(points[points.length - 1]!);
      return;
    }
    let previousPoint = gesture.points[gesture.points.length - 1]!;
    for (const point of points) {
      if (point.x !== previousPoint.x || point.y !== previousPoint.y) gesture.pathVersion++;
      gesture.points.push({ ...point });
      previousPoint = point;
    }
    const first = gesture.points[0]!;
    const last = gesture.points[gesture.points.length - 1]!;
    const { tool } = gesture;
    if (tool === 'eraser') {
      const query = requireValue(prepared);
      const hits = requireValue(
        queryObjectSweep(
          query,
          [gesture.points[gesture.points.length - points.length - 1]!, ...points],
          10 / controller.getSnapshot('viewport').viewport.scale
        )
      );
      for (const hit of hits) gesture.hidden.add(hit.objectId);
    } else if (tool === 'lasso') {
      perf(gesture, 'input');
      scheduleLasso(gesture);
      return;
    } else if (tool === 'selection') {
      let transform = { ...IDENTITY_TRANSFORM, tx: last.x - first.x, ty: last.y - first.y };
      if (gesture.operation !== 'move' && gesture.originals.length) {
        const frame = gesture.frame;
        if (!frame) throw new Error('geometry-failed');
        const center = applyAffine(frame.transform, {
          x: (frame.bounds.minX + frame.bounds.maxX) / 2,
          y: (frame.bounds.minY + frame.bounds.maxY) / 2,
        });
        if (!center) throw new Error('geometry-failed');
        const { x: cx, y: cy } = center;
        if (gesture.operation === 'rotate') {
          for (const point of points) {
            const angle = Math.atan2(point.y - cy, point.x - cx);
            const previous = gesture.lastAngle ?? Math.atan2(first.y - cy, first.x - cx);
            gesture.angle += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
            gesture.lastAngle = angle;
          }
        }
        const angle = gesture.angle;
        const ratio =
          gesture.operation === 'resize'
            ? Math.max(
                0.01,
                Math.hypot(last.x - cx, last.y - cy) /
                  Math.max(0.01, Math.hypot(first.x - cx, first.y - cy))
              )
            : 1;
        const a = Math.cos(angle) * ratio;
        const b = Math.sin(angle) * ratio;
        transform = { a, b, c: -b, d: a, tx: cx - a * cx + b * cy, ty: cy - b * cx - a * cy };
      }
      if (gesture.frame) {
        const next = composeAffine(transform, gesture.frame.transform);
        if (!next) throw new Error('invalid-transform');
        gesture.nextFrame = { ...gesture.frame, transform: next };
      }
      gesture.replacements = gesture.originals.map((object) => {
        const next = composeAffine(transform, object.transform);
        if (!next) throw new Error('invalid-transform');
        return {
          ...object,
          transform: next,
          transformRevision: object.transformRevision + 1,
          objectRevision: object.objectRevision + 1,
        };
      });
    } else if (['line', 'rect', 'ellipse'].includes(tool)) {
      gesture.replacements = previewShape(tool as ShapeObject['shapeType'], [first, last]);
    }
    requireValue(
      controller.setPreview({
        ...(gesture.nextFrame ? { selectionFrame: gesture.nextFrame } : {}),
        objects: gesture.replacements,
        hiddenIds: [...gesture.hidden],
        path: [],
      })
    );
  }

  function finish() {
    if (!gesture) return;
    const current = gesture;
    clearScheduled();
    if (!active(current)) return;
    if (current.tool === 'lasso') {
      finishLasso(current);
      return;
    } else {
      // Clear ownership before publishing a document mutation to subscribers.
      gesture = undefined;
      const moved = current.points.some(
        (point) => point.x !== current.points[0]!.x || point.y !== current.points[0]!.y
      );
      const upsert = (current.tool === 'selection' && !moved ? [] : current.replacements).map(
        (object) =>
          object.objectId === 'preview-shape' ? { ...object, objectId: allocateId() } : object
      );
      if (upsert.length || (current.tool === 'eraser' && current.hidden.size))
        requireValue(
          controller.editObjects({
            ...(current.tool === 'selection' && current.nextFrame
              ? { selectionFrame: current.nextFrame }
              : {}),
            expectedDocumentRevision: current.revision,
            upsert,
            removeIds: current.tool === 'eraser' ? [...current.hidden] : [],
          })
        );
    }
    controller.setPreview(null);
    resumeWarmup();
  }

  scheduleWarmup();
  return {
    pauseWarmup,
    resumeWarmup,
    pointHits,
    begin(
      point: Point,
      operation: SelectionOperation = 'move',
      extendSelection = false,
      targetId?: string
    ) {
      if (destroyed) return false;
      pauseWarmup();
      const tool = controller.getSnapshot('tools').activeTool;
      if (gesture?.pending) cancel();
      if (gesture) {
        if (!gesture.placement || gesture.tool !== tool) return false;
        if (tool === 'polygon') {
          const anchors = gesture.placement.anchors;
          const last = anchors[anchors.length - 1]!;
          gesture.placement.addedVertex = point.x !== last.x || point.y !== last.y;
          if (gesture.placement.addedVertex) anchors.push({ ...point });
        }
        update([point]);
        return true;
      }
      if (['freehand', 'text', 'image', 'pan'].includes(tool)) return false;
      const document = controller.getSnapshot('document');
      const viewport = controller.getSnapshot('viewport').viewport;
      const selectionHit =
        tool === 'selection'
          ? hitLayeredSelectionGeometry(deriveLayeredSelectionGeometry(controller), {
              x: point.x * viewport.scale + viewport.tx,
              y: point.y * viewport.scale + viewport.ty,
            })
          : null;
      if (selectionHit && operation === 'move') operation = selectionHit;
      if (tool === 'eraser') prepareQuery();
      if (tool === 'selection' && !selectionHit) {
        const hits = pointHits(point);
        const id =
          targetId && document.objects.some((object) => object.objectId === targetId)
            ? targetId
            : hits[hits.length - 1]?.objectId;
        const selected = controller.getSnapshot('selection');
        if (id && !selected.includes(id))
          controller.setSelection(extendSelection ? [...selected, id] : [id]);
        else if (!id && operation === 'move') controller.setSelection([]);
      }
      const selected = new Set(controller.getSnapshot('selection'));
      const originals =
        tool === 'selection'
          ? document.objects.filter((object) => selected.has(object.objectId))
          : [];
      gesture = {
        tool,
        operation,
        revision: document.documentRevision,
        frame:
          tool === 'selection'
            ? (controller.getSnapshot('selectionFrame') ?? undefined)
            : undefined,
        angle: 0,
        points: [{ ...point }],
        originals,
        replacements: [],
        hidden: new Set(originals.map((object) => object.objectId)),
        previousSelection: controller.getSnapshot('selection'),
        pathVersion: 0,
        perfSession: ++perfSession,
        ...(tool === 'polygon' || tool === 'bezier'
          ? {
              placement: {
                stage: 0,
                anchors:
                  tool === 'polygon'
                    ? [{ ...point }]
                    : Array.from({ length: 4 }, () => ({ ...point })),
                cursor: { ...point },
                addedVertex: tool === 'polygon',
              },
            }
          : {}),
      };
      update([point]);
      return true;
    },
    update,
    hover(point: Point) {
      if (gesture?.placement) update([point]);
    },
    isPlacing: () => Boolean(gesture?.placement),
    completePolygon(doubleClick = false) {
      if (gesture?.tool !== 'polygon' || !gesture.placement) return false;
      const anchors = gesture.placement.anchors;
      // The browser, not a distance/time heuristic, identifies the second click.
      if (doubleClick && gesture.placement.addedVertex && anchors.length > 1) anchors.pop();
      gesture.placement.addedVertex = false;
      const first = anchors[0]!;
      const last = anchors[anchors.length - 1]!;
      if (anchors.length > 3 && first.x === last.x && first.y === last.y) anchors.pop();
      if (anchors.length < 3) return false;
      gesture.replacements = previewShape('polygon', [...anchors]);
      if (!gesture.replacements.length) return false;
      finish();
      return true;
    },
    end() {
      if (!gesture || gesture.pending) return;
      if (gesture.placement) {
        if (gesture.tool === 'polygon') return;
        if (gesture.placement.stage < 2) {
          gesture.placement.stage++;
          return;
        }
      }
      finish();
    },
    cancel,
    destroy() {
      destroyed = true;
      pauseWarmup();
      cancel();
      unsubscribeTools();
      unsubscribeSelection();
      unsubscribeInput();
      unsubscribeDocument();
      controller.resetSelectionFrame();
    },
  };
}
