import type { FreehandCandidate, FreehandSessionSnapshot } from '../core/freehandSession';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { replayClosedPath } from '../geometry/closedPath';
import { deriveFreehandGeometry } from '../geometry/freehand';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { IDENTITY_TRANSFORM, type FreehandObject } from '../model/document';
import type { PresentationCoordinator } from './PresentationCoordinator';

type ActiveSnapshot = Extract<FreehandSessionSnapshot, { status: 'collecting' }>;

function asObject(candidate: FreehandCandidate | ActiveSnapshot): FreehandObject {
  return {
    kind: 'freehand',
    objectId: candidate.commitId,
    commitId: candidate.commitId,
    transform: IDENTITY_TRANSFORM,
    objectRevision: 1,
    transformRevision: 1,
    samplesRevision: candidate.samples.length,
    brushRevision: 1,
    brushSnapshot: candidate.brushSnapshot,
    ...(candidate.rulerSnapshot ? { rulerSnapshot: candidate.rulerSnapshot } : {}),
    resolvedPressureMode: candidate.resolvedPressureMode,
    samples: candidate.samples,
  };
}

/** Controller owns the raw append buffer. This driver reads it at most once per frame. */
export function createDrawingCanvas(
  canvas: HTMLCanvasElement,
  controller: LayeredEditorController,
  presentation: PresentationCoordinator
) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable');
  const view = canvas.ownerDocument.defaultView!;
  const cache = new FreehandGeometryCache();
  let frame: number | undefined;
  let destroyed = false;

  function paint() {
    if (destroyed || !context) return;
    const bounds = canvas.getBoundingClientRect();
    const dpr = view.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(bounds.width * dpr));
    const height = Math.max(1, Math.round(bounds.height * dpr));
    const pixelScaleX = width / (bounds.width || 1);
    const pixelScaleY = height / (bounds.height || 1);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, width, height);
    const { viewport } = controller.getSnapshot('viewport');
    const interaction = controller.getSnapshot('interaction');
    const pending = presentation.getPending();
    const owned = new Set(pending.map((object) => object.commitId));

    function draw(object: FreehandObject, final: boolean, cached: boolean) {
      const geometry = cached
        ? cache.getGeometry(object, 'final')
        : deriveFreehandGeometry(object, final ? 'final' : 'active');
      context!.save();
      context!.setTransform(
        pixelScaleX * viewport.scale,
        0,
        0,
        pixelScaleY * viewport.scale,
        pixelScaleX * viewport.tx,
        pixelScaleY * viewport.ty
      );
      const { a, b, c, d, tx, ty } = object.transform;
      context!.transform(a, b, c, d, tx, ty);
      context!.globalAlpha = object.brushSnapshot.opacity;
      context!.fillStyle = object.brushSnapshot.color;
      context!.beginPath();
      replayClosedPath(context!, geometry.commands);
      context!.fill('nonzero');
      context!.restore();
    }

    for (const object of pending)
      if (!presentation.hasNativePreview(object.commitId)) draw(object, true, true);
    for (const candidate of interaction.pendingCandidates) {
      if (!owned.has(candidate.commitId) && !presentation.hasNativePreview(candidate.commitId))
        draw(asObject(candidate), true, false);
    }
    const active = interaction.activeFreehand;
    if (active?.status === 'collecting' && !presentation.hasNativePreview(active.commitId))
      draw(asObject(active), false, false);
    cache.syncDocument({ schemaVersion: 3, documentRevision: 0, objects: pending });
  }

  function paintNow() {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    paint();
  }
  function schedule() {
    if (frame === undefined && !destroyed)
      frame = view.requestAnimationFrame(() => {
        frame = undefined;
        paint();
      });
  }
  const subscriptions = [
    controller.subscribe('interaction', schedule),
    controller.subscribe('viewport', schedule),
    presentation.setRepaint(paintNow),
  ];
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : undefined;
  observer?.observe(canvas);
  view.addEventListener('resize', schedule);
  schedule();
  return {
    paintNow,
    destroy() {
      destroyed = true;
      if (frame !== undefined) view.cancelAnimationFrame(frame);
      subscriptions.forEach((unsubscribe) => unsubscribe());
      observer?.disconnect();
      view.removeEventListener('resize', schedule);
      cache.clear();
      context.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
