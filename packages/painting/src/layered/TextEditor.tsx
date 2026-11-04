import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { beginLayeredTextEditSession } from '../core/layeredTextEditSession';
import { prepareLayeredObjectQuery, queryObjectPoint } from '../core/layeredObjectQuery';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { IDENTITY_TRANSFORM, type Point, type TextObject } from '../model/document';
import { useEditorSnapshot } from './useEditorSnapshot';

function createEditing(
  controller: LayeredEditorController,
  point: Point,
  allocateId: () => string
) {
  const document = controller.getSnapshot('document');
  const prepared = prepareLayeredObjectQuery(document, new FreehandGeometryCache());
  const hits = prepared.ok ? queryObjectPoint(prepared.value, point, 0) : undefined;
  const id = hits?.ok ? hits.value[hits.value.length - 1]?.objectId : undefined;
  const object = document.objects.find(
    (entry): entry is TextObject => entry.objectId === id && entry.kind === 'text'
  );
  const result = beginLayeredTextEditSession(
    object
      ? {
          kind: 'existing',
          expectedDocumentRevision: document.documentRevision,
          objectId: object.objectId,
          expectedObjectRevision: object.objectRevision,
        }
      : {
          kind: 'new',
          expectedDocumentRevision: document.documentRevision,
          transform: IDENTITY_TRANSFORM,
        },
    object ?? {
      content: '',
      fontSize: 24,
      color: '#20262d',
      localBounds: { minX: point.x, minY: point.y, maxX: point.x + 240, maxY: point.y + 120 },
    }
  );
  if (!result.ok) throw new Error(result.error.code);
  return { session: result.value, object, newId: allocateId() };
}

export function TextEditor({
  controller,
  point,
  allocateId,
  close,
}: {
  controller: LayeredEditorController;
  point: Point;
  allocateId: () => string;
  close: () => void;
}) {
  const [editing, setEditing] = useState<ReturnType<typeof createEditing>>();
  const currentEditing = useRef<ReturnType<typeof createEditing> | undefined>(undefined);
  useLayoutEffect(() => {
    // A setup owns one session, including StrictMode's setup/cleanup replay.
    const next = createEditing(controller, point, allocateId);
    currentEditing.current = next;
    setEditing(next);
    return () => {
      currentEditing.current = undefined;
      next.session.cancel();
    };
  }, [controller, point, allocateId]);
  const [, refresh] = useState(0);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  const panel = useRef<HTMLDivElement>(null);
  const anchor = useRef<SVGRectElement>(null);
  const measurement = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!editing || !panel.current) return;
    const node = panel.current.ownerDocument.createElement('div');
    Object.assign(node.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      visibility: 'hidden',
      pointerEvents: 'none',
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
      fontFamily: 'sans-serif',
      padding: '0',
      margin: '0',
      border: '0',
    });
    node.setAttribute('aria-hidden', 'true');
    panel.current.ownerDocument.body.append(node);
    measurement.current = node;
    return () => {
      measurement.current = null;
      node.remove();
    };
  }, [editing]);
  const [position, setPosition] = useState<CSSProperties>({ left: 0, top: 0, width: 240 });
  useLayoutEffect(() => {
    const element = panel.current;
    const marker = anchor.current;
    const surface =
      marker?.closest('[data-drawing-viewport]') ?? marker?.parentElement?.parentElement;
    if (!element || !surface || !marker || !editing) return;
    const view = element.ownerDocument.defaultView!;
    const place = () => {
      const visual = view.visualViewport;
      const rect = surface.getBoundingClientRect();
      const left = Math.max(rect.left, visual?.offsetLeft ?? 0) + 8;
      const top = Math.max(rect.top, visual?.offsetTop ?? 0) + 8;
      const right =
        Math.min(rect.right, (visual?.offsetLeft ?? 0) + (visual?.width ?? view.innerWidth)) - 8;
      const bottom =
        Math.min(rect.bottom, (visual?.offsetTop ?? 0) + (visual?.height ?? view.innerHeight)) - 8;
      // The SVG marker projects through both object/viewport matrices and any
      // transformed page ancestors. The portal keeps controls upright and usable.
      const desired = marker.getBoundingClientRect();
      const width = Math.max(0, Math.min(Math.max(240, desired.width), right - left));
      const maxHeight = Math.max(0, bottom - top);
      setPosition({
        left: Math.max(left, Math.min(desired.left, right - width)),
        top: Math.max(
          top,
          Math.min(desired.top, bottom - Math.min(element.scrollHeight, maxHeight))
        ),
        width,
        maxHeight,
      });
    };
    place();
    // Transform-only page changes do not notify ResizeObserver. Watch the actual
    // marker ancestry, including pageToSurface's SVG/CSS transforms and host classes.
    const ancestors: Element[] = [];
    for (let node: Element | null = marker; node; node = node.parentElement) ancestors.push(node);
    let animationFrame = 0;
    const moving = () =>
      ancestors.some(
        (node) =>
          typeof node.getAnimations === 'function' &&
          node.getAnimations().some((animation) => animation.playState === 'running')
      );
    const followAnimation = () => {
      place();
      animationFrame = moving() ? view.requestAnimationFrame(followAnimation) : 0;
    };
    const geometryChanged = () => {
      place();
      if (!animationFrame && moving()) animationFrame = view.requestAnimationFrame(followAnimation);
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(geometryChanged);
    observer?.observe(element);
    const mutations =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(geometryChanged);
    for (const node of ancestors) {
      observer?.observe(node);
      mutations?.observe(node, {
        attributes: true,
        attributeFilter: ['style', 'class', 'transform', 'width', 'height'],
      });
      node.addEventListener('transitionrun', geometryChanged);
      node.addEventListener('animationstart', geometryChanged);
    }
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    view.visualViewport?.addEventListener('resize', place);
    view.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
      if (animationFrame) view.cancelAnimationFrame(animationFrame);
      for (const node of ancestors) {
        node.removeEventListener('transitionrun', geometryChanged);
        node.removeEventListener('animationstart', geometryChanged);
      }
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
      view.visualViewport?.removeEventListener('resize', place);
      view.visualViewport?.removeEventListener('scroll', place);
    };
  }, [editing, viewport]);
  useEffect(() => {
    if (!editing) return;
    input.current?.focus({ preventScroll: true });
    const unsubscribe = controller.subscribe('tools', () => {
      editing.session.cancel();
      close();
    });
    return () => {
      unsubscribe();
    };
  }, [controller, editing, close]);
  if (!editing) return null;
  const { draft } = editing.session.getSnapshot();
  const transform = editing.object?.transform ?? IDENTITY_TRANSFORM;
  const bounds = draft.localBounds;
  const screenScale = Math.max(
    Math.hypot(transform.a, transform.b) * viewport.scale,
    16 / draft.fontSize
  );
  function measureHeight(content: string, fontSize: number) {
    const lineHeight = editing?.object?.lineHeight ?? 1.25;
    const node = measurement.current;
    if (node) {
      // Match DisplayLayer's document-space typography, never the scaled/limited textarea.
      node.style.width = `${bounds.maxX - bounds.minX}px`;
      node.style.fontSize = `${fontSize}px`;
      node.style.lineHeight = String(lineHeight);
      node.textContent = content;
    }
    return Math.max(
      120,
      node?.scrollHeight ?? 0,
      content.split('\n').length * fontSize * lineHeight
    );
  }
  function persist() {
    // Late keyboard/button/IME callbacks cannot write through a replaced or unmounted editor.
    if (!editing || currentEditing.current !== editing) return;
    const candidate = editing.session.getCandidate();
    if (!candidate.ok) return;
    const { value } = candidate;
    if (value.kind === 'noop') {
      close();
      return;
    }
    if (value.kind === 'update' && editing.object) {
      const original = editing.object;
      const next = value.draft;
      if (
        next.content === original.content &&
        next.fontSize === original.fontSize &&
        next.color === original.color &&
        next.localBounds.minX === original.localBounds.minX &&
        next.localBounds.minY === original.localBounds.minY &&
        next.localBounds.maxX === original.localBounds.maxX &&
        next.localBounds.maxY === original.localBounds.maxY
      ) {
        close();
        return;
      }
    }
    const result =
      value.kind === 'delete'
        ? controller.editObjects({
            expectedDocumentRevision: value.target.expectedDocumentRevision,
            removeIds: [value.target.objectId],
          })
        : controller.editObjects({
            expectedDocumentRevision: value.target.expectedDocumentRevision,
            upsert: [
              {
                kind: 'text',
                objectId: editing.object?.objectId ?? editing.newId,
                objectRevision: (editing.object?.objectRevision ?? 0) + 1,
                transformRevision: editing.object?.transformRevision ?? 1,
                transform,
                ...(editing.object?.lineHeight !== undefined
                  ? { lineHeight: editing.object.lineHeight }
                  : {}),
                ...value.draft,
              },
            ],
          });
    if (!result.ok) {
      setError(result.error.code);
      return;
    }
    close();
  }
  function finish() {
    if (!editing || currentEditing.current !== editing) return;
    editing.session.requestCommit();
    persist();
  }
  const editor = (
    <div
      ref={panel}
      data-text-editor="true"
      data-interactive="true"
      style={{
        position: 'fixed',
        ...position,
        zIndex: 25,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        overflow: 'auto',
        background: '#fff',
        userSelect: 'text',
        WebkitUserSelect: 'text',
        WebkitTouchCallout: 'default',
      }}
    >
      <textarea
        ref={input}
        aria-label="文字内容"
        value={draft.content}
        style={{
          display: 'block',
          width: '100%',
          height: Math.min(240, (bounds.maxY - bounds.minY) * screenScale),
          minHeight: 44,
          flex: '1 1 auto',
          boxSizing: 'border-box',
          font: `${Math.max(16, draft.fontSize * screenScale)}px/1.25 sans-serif`,
          color: draft.color,
          border: '1px solid #059669',
          background: '#fff',
          padding: 0,
          resize: 'none',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          WebkitTouchCallout: 'default',
        }}
        onChange={(event) => {
          const content = event.target.value;
          const height = measureHeight(content, draft.fontSize);
          editing.session.updateDraft({
            content,
            localBounds: { ...bounds, maxY: bounds.minY + height },
          });
          refresh((n) => n + 1);
        }}
        onCompositionStart={() => editing.session.startComposition()}
        onCompositionEnd={(event) => {
          const content = event.currentTarget.value;
          editing.session.endComposition({
            content,
            localBounds: { ...bounds, maxY: bounds.minY + measureHeight(content, draft.fontSize) },
          });
          refresh((n) => n + 1);
          persist();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            editing.session.cancel();
            close();
          }
          if (
            event.key === 'Enter' &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            finish();
          }
        }}
      />
      <div
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4, flexShrink: 0 }}
      >
        <label>
          字号{' '}
          <input
            aria-label="文字字号"
            type="number"
            min={8}
            max={200}
            value={draft.fontSize}
            style={{
              width: 56,
              minHeight: 44,
              userSelect: 'text',
              WebkitUserSelect: 'text',
              WebkitTouchCallout: 'default',
            }}
            onChange={(event) => {
              const fontSize = event.target.valueAsNumber;
              if (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 200) return;
              editing.session.updateDraft({
                fontSize,
                localBounds: {
                  ...bounds,
                  maxY: Math.max(bounds.maxY, bounds.minY + measureHeight(draft.content, fontSize)),
                },
              });
              refresh((n) => n + 1);
            }}
          />
        </label>
        <input
          aria-label="文字颜色"
          title="文字颜色"
          style={{ width: 44, height: 44 }}
          type="color"
          value={draft.color}
          onChange={(event) => {
            editing.session.updateDraft({ color: event.target.value });
            refresh((n) => n + 1);
          }}
        />
        <button type="button" style={{ minHeight: 44 }} onClick={finish}>
          完成
        </button>
        <button
          style={{ minHeight: 44 }}
          type="button"
          onClick={() => {
            editing.session.cancel();
            close();
          }}
        >
          取消
        </button>
      </div>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
  return (
    <>
      <svg
        width="100%"
        height="100%"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <g
          transform={`matrix(${viewport.scale} 0 0 ${viewport.scale} ${viewport.tx} ${viewport.ty})`}
        >
          <g
            transform={`matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.tx} ${transform.ty})`}
          >
            <rect
              ref={anchor}
              x={bounds.minX}
              y={bounds.minY}
              width={bounds.maxX - bounds.minX}
              height={bounds.maxY - bounds.minY}
              visibility="hidden"
            />
          </g>
        </g>
      </svg>
      {createPortal(editor, input.current?.ownerDocument.body ?? document.body)}
    </>
  );
}
