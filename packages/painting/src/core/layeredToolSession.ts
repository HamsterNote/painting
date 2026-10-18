import type { LayeredEditorController, LayeredEditorTool } from './layeredEditorController';
import {
  prepareLayeredObjectQuery,
  queryObjectLasso,
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
  placement?: {
    stage: number;
    anchors: Point[];
    cursor: Point;
    addedVertex?: boolean;
  };
};

/** The same geometry-driven gesture path is used by DOM and future semantic batches. */
export function createLayeredToolSession(
  controller: LayeredEditorController,
  allocateId: () => string
) {
  const cache = new FreehandGeometryCache();
  let gesture: ToolGesture | undefined;
  let prepared: ReturnType<typeof prepareLayeredObjectQuery>;
  const requireValue = <T>(
    result: { ok: true; value: T } | { ok: false; error: { code: string } }
  ): T => {
    if (!result.ok) throw new Error(result.error.code);
    return result.value;
  };
  const cancel = () => {
    const previous = gesture;
    gesture = undefined;
    if (previous?.tool === 'lasso') controller.setSelection(previous.previousSelection);
    controller.setPreview(null);
  };
  const unsubscribeTools = controller.subscribe('tools', () => {
    if (gesture && controller.getSnapshot('tools').activeTool !== gesture.tool) cancel();
  });
  const unsubscribeDocument = controller.subscribe('document', () => {
    gesture = undefined;
    cache.syncDocument(controller.getSnapshot('document'));
  });

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
    gesture.points.push(...points.map((point) => ({ ...point })));
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
      if (gesture.points.length >= 3) {
        const query = requireValue(prepared);
        const result = queryObjectLasso(query, gesture.points, 'intersects');
        if (result.ok) controller.setSelection(result.value.map((hit) => hit.objectId));
      }
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
        path: tool === 'lasso' ? gesture.points : [],
      })
    );
  }

  function finish() {
    if (!gesture) return;
    const current = gesture;
    // Clear transport ownership before publishing a document mutation to subscribers.
    gesture = undefined;
    if (current.tool !== 'lasso') {
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
      prepared = prepareLayeredObjectQuery(document, cache);
      requireValue(prepared);
      if (tool === 'selection') {
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
      cancel();
      unsubscribeTools();
      unsubscribeDocument();
      cache.clear();
    },
  };
}
