import { useEffect, useRef, useState } from 'react';
import type { LayeredEditorController } from '../core/layeredEditorController';
import { beginLayeredTextEditSession } from '../core/layeredTextEditSession';
import { prepareLayeredObjectQuery, queryObjectPoint } from '../core/layeredObjectQuery';
import { FreehandGeometryCache } from '../geometry/freehandCache';
import { IDENTITY_TRANSFORM, type Point, type TextObject } from '../model/document';
import { useEditorSnapshot } from './useEditorSnapshot';

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
  const [editing] = useState(() => {
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
  });
  const [, refresh] = useState(0);
  const [error, setError] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  const { viewport } = useEditorSnapshot(controller, 'viewport');
  const { draft } = editing.session.getSnapshot();
  const transform = editing.object?.transform ?? IDENTITY_TRANSFORM;
  const bounds = draft.localBounds;
  useEffect(() => {
    input.current?.focus();
    const unsubscribe = controller.subscribe('tools', () => {
      editing.session.cancel();
      close();
    });
    return () => {
      unsubscribe();
      editing.session.cancel();
    };
  }, [controller, editing, close]);
  function persist() {
    const candidate = editing.session.getCandidate();
    if (!candidate.ok) return;
    const { value } = candidate;
    if (value.kind === 'noop') {
      close();
      return;
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
    editing.session.requestCommit();
    persist();
  }
  return (
    <svg
      width="100%"
      height="100%"
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <g
        transform={`matrix(${viewport.scale} 0 0 ${viewport.scale} ${viewport.tx} ${viewport.ty})`}
      >
        <g
          transform={`matrix(${transform.a} ${transform.b} ${transform.c} ${transform.d} ${transform.tx} ${transform.ty})`}
        >
          <foreignObject
            x={bounds.minX}
            y={bounds.minY}
            width={bounds.maxX - bounds.minX + 4}
            height={bounds.maxY - bounds.minY + 50}
            style={{ overflow: 'visible', pointerEvents: 'auto' }}
          >
            <div data-interactive="true">
              <textarea
                ref={input}
                aria-label="文字内容"
                value={draft.content}
                style={{
                  display: 'block',
                  width: bounds.maxX - bounds.minX,
                  height: bounds.maxY - bounds.minY,
                  boxSizing: 'border-box',
                  font: `${draft.fontSize}px/1.25 sans-serif`,
                  color: draft.color,
                  border: '1px solid #059669',
                  background: '#fff',
                  padding: 0,
                  resize: 'none',
                }}
                onChange={(event) => {
                  editing.session.updateDraft({ content: event.target.value });
                  refresh((n) => n + 1);
                }}
                onCompositionStart={() => editing.session.startComposition()}
                onCompositionEnd={(event) => {
                  editing.session.endComposition({ content: event.currentTarget.value });
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
              <button type="button" onClick={finish}>
                完成
              </button>
              <button
                type="button"
                onClick={() => {
                  editing.session.cancel();
                  close();
                }}
              >
                取消
              </button>
              {error ? <span role="alert">{error}</span> : null}
            </div>
          </foreignObject>
        </g>
      </g>
    </svg>
  );
}
