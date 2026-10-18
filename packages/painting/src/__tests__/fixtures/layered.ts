import {
  createLayeredEditorController,
  type LayeredEditorController,
} from '../../core/layeredEditorController';
import { IDENTITY_TRANSFORM, type DocumentObject, type ShapeObject } from '../../model/document';

export function makeLayeredController(objects: readonly DocumentObject[] = []) {
  const result = createLayeredEditorController({
    document: { schemaVersion: 3, documentRevision: 0, objects },
    activeTool: 'freehand',
    viewport: { revision: 0, viewport: { scale: 1, tx: 0, ty: 0 } },
    settings: {
      freehand: {
        color: '#008060',
        nominalSize: 12,
        opacity: 0.5,
        pressureMode: 'auto',
        presetRevision: 1,
      },
      shape: { color: '#000000', width: 2, opacity: 1 },
    },
    allocateObjectId: (id) => `object-${id}`,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

export function commitLayeredStroke(controller: LayeredEditorController, id: string, x = 50) {
  const batch = {
    sessionId: id,
    pointerId: 1,
    source: 'pen' as const,
    coordinateSpace: 'world' as const,
    viewportRevision: controller.getSnapshot('viewport').revision,
  };
  const begin = controller.beginFreehand({
    type: 'begin',
    commitId: id,
    pressureCapability: 'available',
    batch: {
      ...batch,
      batchSequence: 0,
      samples: [{ sequence: 0, x, y: 50, phase: 'down', pressure: 0.5, time: 0 }],
    },
  });
  if (!begin.ok) throw new Error(begin.error.code);
  const end = controller.endFreehand({
    type: 'end',
    batch: {
      ...batch,
      batchSequence: 1,
      samples: [{ sequence: 1, x: x + 40, y: 50, phase: 'up', pressure: 0, time: 1 }],
    },
  });
  if (!end.ok) throw new Error(end.error.code);
  const result = controller.commitFreehand(id);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

export function layeredRect(objectId = 'rect'): ShapeObject {
  return {
    kind: 'shape',
    objectId,
    objectRevision: 1,
    transformRevision: 1,
    transform: IDENTITY_TRANSFORM,
    shapeType: 'rect',
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
    ],
    style: { color: '#000000', width: 2, opacity: 1, fill: '#fca5a5' },
  };
}
