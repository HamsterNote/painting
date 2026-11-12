import type { LayeredEditorController } from '../core/layeredEditorController';
import type { Point } from '../model/document';

const SVG = 'http://www.w3.org/2000/svg';
const LIFETIME = 1000;
let nextId = 0;

export type EraserTrailPoint = Point & { time: number };
type Segment = {
  from: EraserTrailPoint;
  to: EraserTrailPoint;
  path: SVGPathElement;
  gradient: SVGLinearGradientElement;
  start: SVGStopElement;
  end: SVGStopElement;
};

/** A rolling, per-sample fade. Opaque grayscale strokes combine by max in a luminance mask. */
export function createEraserTrail(host: HTMLElement, controller: LayeredEditorController) {
  const view = host.ownerDocument.defaultView!;
  const id = `hn-eraser-${nextId++}`;
  let serial = 0;
  let overlay: SVGSVGElement | undefined;
  let defs: SVGDefsElement | undefined;
  let group: SVGGElement | undefined;
  let segments: Segment[] = [];
  let last: EraserTrailPoint | undefined;
  let frame: number | undefined;
  let tracking = false;
  let committing = false;
  let tool = controller.getSnapshot('tools').activeTool;
  const element = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>) => {
    const node = host.ownerDocument.createElementNS(SVG, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  };
  const transform = () => {
    const { scale, tx, ty } = controller.getSnapshot('viewport').viewport;
    group?.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`);
  };
  function removeOverlay() {
    overlay?.remove();
    overlay = undefined;
    defs = undefined;
    group = undefined;
  }
  function clear() {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
    segments = [];
    last = undefined;
    tracking = false;
    removeOverlay();
  }
  function createOverlay() {
    overlay = element('svg', { 'aria-hidden': 'true', 'data-eraser-trail': 'true' });
    overlay.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:7;overflow:hidden;opacity:.45';
    defs = element('defs', {});
    const mask = element('mask', {
      id,
      maskUnits: 'userSpaceOnUse',
      x: '0',
      y: '0',
      width: '100%',
      height: '100%',
      style: 'mask-type:luminance',
    });
    group = element('g', { style: 'isolation:isolate' });
    mask.append(element('rect', { width: '100%', height: '100%', fill: 'black' }), group);
    defs.append(mask);
    overlay.append(
      defs,
      element('rect', { width: '100%', height: '100%', fill: '#9B8DD5', mask: `url(#${id})` })
    );
    host.append(overlay);
    transform();
  }
  function render(now: number) {
    const cutoff = now - LIFETIME;
    segments = segments.filter((segment) => {
      if (segment.to.time > cutoff) return true;
      segment.path.remove();
      segment.gradient.remove();
      return false;
    });
    const shade = (time: number) => {
      const value = Math.round(255 * Math.max(0, Math.min(1, 1 - (now - time) / LIFETIME)));
      return `rgb(${value},${value},${value})`;
    };
    for (const { from, to, path, gradient, start, end } of segments) {
      // Clip the oldest segment at the time-window boundary, preserving its live suffix.
      const fraction = from.time < cutoff ? (cutoff - from.time) / (to.time - from.time) : 0;
      const x = from.x + (to.x - from.x) * fraction;
      const y = from.y + (to.y - from.y) * fraction;
      path.setAttribute('d', `M ${x} ${y} L ${to.x} ${to.y}`);
      gradient.setAttribute('x1', String(x));
      gradient.setAttribute('y1', String(y));
      start.setAttribute('stop-color', shade(Math.max(cutoff, from.time)));
      end.setAttribute('stop-color', shade(to.time));
    }
    if (!segments.length) removeOverlay();
  }
  function tick() {
    frame = undefined;
    render(view.performance.now());
    if (segments.length) frame = view.requestAnimationFrame(tick);
  }
  function append(points: readonly EraserTrailPoint[]) {
    if (!tracking || !points.length) return;
    for (const point of points) {
      // A stationary move/up must not renew the age of an existing point.
      if (last && point.x === last.x && point.y === last.y) continue;
      if (!overlay) createOverlay();
      const from = last ?? point;
      const gradientId = `${id}-${serial++}`;
      const gradient = element('linearGradient', {
        id: gradientId,
        gradientUnits: 'userSpaceOnUse',
        x2: String(point.x),
        y2: String(point.y),
      });
      const start = element('stop', { offset: '0' });
      const end = element('stop', { offset: '1' });
      gradient.append(start, end);
      const path = element('path', {
        fill: 'none',
        stroke: `url(#${gradientId})`,
        'stroke-width': '12',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'vector-effect': 'non-scaling-stroke',
        // Brightness encodes age. Lighten takes the maximum at joints/crossings,
        // so translucent coverage never accumulates.
        style: 'mix-blend-mode:lighten',
      });
      defs!.append(gradient);
      group!.append(path);
      segments.push({ from, to: point, path, gradient, start, end });
      last = point;
    }
    render(view.performance.now());
    if (segments.length && frame === undefined) frame = view.requestAnimationFrame(tick);
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
    begin(point: EraserTrailPoint) {
      last = undefined;
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
        last = undefined;
      }
    },
    clear,
    destroy() {
      clear();
      unsubscribe.forEach((stop) => stop());
    },
  };
}
