import type { LayeredEditorController } from '../core/layeredEditorController';
import type { Point } from '../model/document';

const SVG = 'http://www.w3.org/2000/svg';
const LIFETIME = 1000;

/** One opaque path, composited with uniform opacity; fade the whole trail after release. */
export function createEraserTrail(host: HTMLElement, controller: LayeredEditorController) {
  const view = host.ownerDocument.defaultView!;
  let overlay: SVGSVGElement | undefined;
  let group: SVGGElement | undefined;
  let path: SVGPathElement | undefined;
  let pathData = '';
  let tracking = false;
  let committing = false;
  let tool = controller.getSnapshot('tools').activeTool;
  const timers = new Set<number>();
  const transform = () => {
    const { scale, tx, ty } = controller.getSnapshot('viewport').viewport;
    group?.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
  };
  function clear() {
    timers.forEach((timer) => view.clearTimeout(timer));
    timers.clear();
    overlay?.remove();
    overlay = undefined;
    group = undefined;
    path = undefined;
    pathData = '';
    tracking = false;
  }
  function append(points: readonly Point[]) {
    if (!tracking || !points.length) return;
    if (!overlay) {
      overlay = host.ownerDocument.createElementNS(SVG, 'svg');
      overlay.dataset.eraserTrail = 'true';
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7;overflow:hidden';
      overlay.style.opacity = '.45';
      const style = host.ownerDocument.createElementNS(SVG, 'style');
      style.textContent = '@keyframes hn-eraser-fade { from { opacity:1 } to { opacity:0 } }';
      group = host.ownerDocument.createElementNS(SVG, 'g');
      overlay.append(style, group);
      host.append(overlay);
      transform();
    }
    if (!path) {
      path = host.ownerDocument.createElementNS(SVG, 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#9B8DD5');
      path.setAttribute('stroke-width', '12');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      group!.append(path);
      pathData = `M ${points[0]!.x} ${points[0]!.y}`;
    }
    pathData += points.map((p) => ` L ${p.x} ${p.y}`).join('');
    path.setAttribute('d', pathData);
  }
  const clearExternalMutation = () => {
    if (!committing) clear();
  };
  const unsubscribe = [
    controller.subscribe('viewport', transform),
    controller.subscribe('tools', () => {
      const next = controller.getSnapshot('tools').activeTool;
      if (next !== tool) clear();
      tool = next;
    }),
    controller.subscribe('document', clearExternalMutation),
    controller.subscribe('history', clearExternalMutation),
  ];
  return {
    begin(point: Point) {
      clear();
      tracking = true;
      append([point]);
    },
    append,
    finish(action: () => void) {
      // Erasure's own synchronous transaction must not remove its feedback.
      committing = true;
      try {
        action();
      } finally {
        committing = false;
        tracking = false;
        if (group) {
          group.style.animation = `hn-eraser-fade ${LIFETIME}ms linear forwards`;
          timers.add(view.setTimeout(clear, LIFETIME));
        }
      }
    },
    clear,
    destroy() {
      clear();
      unsubscribe.forEach((stop) => stop());
    },
  };
}
