import {
  deriveLayeredSelectionGeometry,
  hitLayeredSelectionGeometry,
} from './layeredSelectionGeometry';
import type { LayeredEditorController, LayeredEditorTool } from './layeredEditorController';
import {
  prepareLayeredObjectQuery,
  createLayeredLassoQuery,
  queryObjectPoint,
  queryObjectSweep,
} from './layeredObjectQuery';
import { composeAffine } from '../geometry/affine';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { deriveLayeredWorldBounds } from '../geometry/worldBounds';
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
  points: Point[];
  originals: readonly DocumentObject[];
  replacements: readonly DocumentObject[];
  hidden: Set<string>;
  previousSelection: readonly string[];
  pathVersion: number;
  perfSession: number;
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
};

/** Internal, opt-in measurement hook. No clock/marks/observer runs unless installed by a test. */
export type LassoPerformanceEvent = {
  event: 'input' | 'query-start' | 'query-complete' | 'selection-submit' | 'cancel';
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
  const cache = new FreehandGeometryCache();
  let gesture: ToolGesture | undefined;
  let prepared: ReturnType<typeof prepareLayeredObjectQuery>;
  let preparedDocument: ReturnType<LayeredEditorController['getSnapshot']> | undefined;
  let stopFrame: (() => void) | undefined;
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
  };
  const unsubscribeTools = controller.subscribe('tools', () => {
    if (gesture && controller.getSnapshot('tools').activeTool !== gesture.tool) cancel();
  });
  const unsubscribeDocument = controller.subscribe('document', () => {
    clearScheduled();
    gesture = undefined;
    preparedDocument = undefined;
    cache.syncDocument(controller.getSnapshot('document'));
  });

  const active = (current: ToolGesture) =>
    gesture === current &&
    current.revision === controller.getSnapshot('document').documentRevision &&
    !destroyed;
  function prepareQuery() {
    const document = controller.getSnapshot('document');
    if (preparedDocument !== document) {
      prepared = prepareLayeredObjectQuery(document, cache);
      requireValue(prepared);
      preparedDocument = document;
    }
    return requireValue(prepared);
  }

  function evaluate(current: ToolGesture) {
    perf(current, 'query-start', true);
    const query = createLayeredLassoQuery(prepareQuery(), current.points);
    const result = query.ok ? query.value.step(() => 0, Infinity)! : query;
    perf(current, 'query-complete', true, undefined, undefined, result.ok);
    return result;
  }

  function scheduleLasso(current: ToolGesture) {
    const publish = () => {
      // A cancelled frame may still arrive after end, a new session or a document edit.
      if (!active(current)) return;
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
    if (!gesture || !points.length) return;
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
        const bounds = gesture.originals.map(
          (object) => deriveLayeredWorldBounds(object, cache)?.visualWorldBounds
        );
        if (bounds.some((entry) => !entry)) throw new Error('geometry-failed');
        const cx =
          (Math.min(...bounds.map((b) => b!.minX)) + Math.max(...bounds.map((b) => b!.maxX))) / 2;
        const cy =
          (Math.min(...bounds.map((b) => b!.minY)) + Math.max(...bounds.map((b) => b!.maxY))) / 2;
        const angle =
          gesture.operation === 'rotate'
            ? Math.atan2(last.y - cy, last.x - cx) - Math.atan2(first.y - cy, first.x - cx)
            : 0;
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
      const result = evaluate(current);
      // Also guard reentrant cancellation/document changes from observers during evaluation.
      if (!active(current)) return;
      gesture = undefined;
      if (result.ok) {
        const selected = result.value.map((hit) => hit.objectId);
        controller.setSelection(selected);
        perf(current, 'selection-submit', true, undefined, undefined, true);
        // Ownership is already released: tool-change subscribers must not restore the old selection.
        if (selected.length) controller.setTool('selection');
      }
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
      requireValue(
        controller.editObjects({
          expectedDocumentRevision: current.revision,
          upsert,
          removeIds: current.tool === 'eraser' ? [...current.hidden] : [],
        })
      );
    }
    controller.setPreview(null);
  }

  return {
    pointHits,
    begin(
      point: Point,
      operation: SelectionOperation = 'move',
      extendSelection = false,
      targetId?: string
    ) {
      if (destroyed) return false;
      const tool = controller.getSnapshot('tools').activeTool;
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
      if (!gesture) return;
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
      cancel();
      unsubscribeTools();
      unsubscribeDocument();
      cache.clear();
    },
  };
}
