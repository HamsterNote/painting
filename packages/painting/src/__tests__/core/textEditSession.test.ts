/** @jest-environment node */

import {
  beginExistingTextEditSession,
  beginNewTextEditSession,
  cancelTextEditSession,
  commitTextEditSession,
  endTextEditComposition,
  requestTextEditCommit,
  startTextEditComposition,
  updateTextEditDraft,
} from '../../core/textEditSession';
import type { DrawingStrokeV2, DrawingValueV2 } from '../../model/strokes';

function text(id: string, value: string): DrawingStrokeV2 {
  return {
    schemaVersion: 2,
    id,
    tool: 'text',
    points: [{ x: 1, y: 2 }],
    text: value,
    fontSize: 24,
  };
}

function documentWith(...strokes: DrawingStrokeV2[]): DrawingValueV2 {
  return { schemaVersion: 2, strokes };
}

describe('core/textEditSession', () => {
  it('keeps document identity through draft, composition, request, and cancel transitions', () => {
    const document = documentWith(text('existing', 'before'));
    let session = beginExistingTextEditSession(
      { index: 0, expectedStrokeId: 'existing', expectedTool: 'text' },
      { text: 'before' }
    );
    session = updateTextEditDraft(session, { text: 'draft', measuredHeight: 88, fontSize: 30 });
    session = startTextEditComposition(session);
    session = requestTextEditCommit(session);

    const pending = commitTextEditSession(document, session);
    expect(pending.document).toBe(document);
    expect(pending.diagnostics).toEqual([{ type: 'composition-active' }]);
    expect(cancelTextEditSession(session).status).toBe('cancelled');
    expect(document.strokes[0]).toEqual(text('existing', 'before'));
  });

  it('updates the exact duplicate-ID index and rejects a stale target without changing document', () => {
    const first = text('duplicate', 'first');
    const second = text('duplicate', 'second');
    const document = documentWith(first, second);
    const session = requestTextEditCommit(
      beginExistingTextEditSession(
        { index: 1, expectedStrokeId: 'duplicate', expectedTool: 'text' },
        { text: 'changed' }
      )
    );
    const result = commitTextEditSession(document, session);
    const stale = commitTextEditSession(
      document,
      requestTextEditCommit(
        beginExistingTextEditSession(
          { index: 1, expectedStrokeId: 'different-stroke', expectedTool: 'text' },
          { text: 'should-not-write' }
        )
      )
    );

    expect(result.document.strokes[0]).toBe(first);
    expect(result.document.strokes[1]).toMatchObject({ id: 'duplicate', text: 'changed' });
    expect(stale.document).toBe(document);
    expect(stale.diagnostics).toEqual([{ type: 'stale-target' }]);
    expect(stale.session.status).toBe('committed');
  });

  it('commits each session at most once and treats empty drafts as no document change', () => {
    const document = documentWith(text('existing', 'before'));
    const newSession = requestTextEditCommit(
      beginNewTextEditSession(
        { id: 'new', points: [{ x: 4, y: 5 }], fontSize: 20 },
        { text: 'created' }
      )
    );
    const created = commitTextEditSession(document, newSession);
    const replay = commitTextEditSession(created.document, created.session);
    const emptyNew = commitTextEditSession(
      document,
      requestTextEditCommit(
        beginNewTextEditSession({ id: 'empty', points: [], fontSize: 20 }, { text: '' })
      )
    );
    const emptyExisting = commitTextEditSession(
      document,
      requestTextEditCommit(
        beginExistingTextEditSession(
          { index: 0, expectedStrokeId: 'existing', expectedTool: 'text' },
          { text: '' }
        )
      )
    );

    expect(created.document.strokes.map(({ id }) => id)).toEqual(['existing', 'new']);
    expect(replay.document).toBe(created.document);
    expect(replay.diagnostics).toEqual([{ type: 'session-finalized' }]);
    expect(emptyNew.document).toBe(document);
    expect(emptyExisting.document.strokes).toEqual([]);
  });

  it('holds a requested IME commit until composition ends, then preserves multiline Unicode verbatim once', () => {
    const value = '第一行\nFamily: 👨‍👩‍👧‍👦';
    let session = beginNewTextEditSession(
      { id: 'unicode', points: [{ x: 0, y: 0 }], fontSize: 18 },
      { text: value }
    );
    session = startTextEditComposition(session);
    session = requestTextEditCommit(session);
    const document = documentWith();

    expect(commitTextEditSession(document, session).document).toBe(document);
    session = endTextEditComposition(session);
    const committed = commitTextEditSession(document, session);

    expect(committed.document.strokes[0]).toMatchObject({ text: value, fontSize: 18 });
    expect(commitTextEditSession(committed.document, committed.session).document).toBe(
      committed.document
    );
  });
});
