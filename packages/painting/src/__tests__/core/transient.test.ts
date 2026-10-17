/** @jest-environment node */

import {
  cancelTransient,
  clearTransient,
  commitDocument,
  createCoreState,
  updateTransient,
} from '../../core/transient';
import type { CoreTransition } from '../../core/transient';
import type { DrawingValueV2 } from '../../model/strokes';

function documentWith(id: string): DrawingValueV2 {
  return {
    schemaVersion: 2,
    strokes: [{ schemaVersion: 2, id, tool: 'pen', points: [{ x: 0, y: 0 }] }],
  };
}

/** 最小本地 effect dispatcher：只有 document-commit 会触发 history 与 onChange。 */
type DispatchTarget = {
  history: jest.Mock;
  onChange: jest.Mock;
};

function dispatchEffects(transition: CoreTransition, target: DispatchTarget): void {
  transition.effects.forEach((effect) => {
    if (effect.type === 'document-commit') {
      target.history(effect.document);
      target.onChange(effect.document);
    }
  });
}

describe('core/transient', () => {
  it('keeps the exact document reference and emits no effects through update, cancel, and clear', () => {
    const document = documentWith('persisted');
    const created = createCoreState(document, { preview: 'start' });
    const updated = updateTransient(created.state, { preview: 'moving', cursor: { x: 10, y: 20 } });
    const cancelled = cancelTransient(updated.state);
    const cleared = clearTransient(cancelled.state);

    [created, updated, cancelled, cleared].forEach((transition) => {
      expect(transition.state.document).toBe(document);
      expect(transition.effects).toEqual([]);
    });
    expect(updated.state.transient).toEqual({ preview: 'moving', cursor: { x: 10, y: 20 } });
    expect(cancelled.state.transient).toEqual({});
    expect(cleared.state.transient).toEqual({});
  });

  it('only commit creates a new state and one document-commit effect without merging transient into document', () => {
    const initialDocument = documentWith('initial');
    const transient = { preview: { id: 'preview', points: [{ x: 3, y: 4 }] } };
    const state = createCoreState(initialDocument, transient).state;
    const committedDocument = documentWith('committed');

    const committed = commitDocument(state, committedDocument);

    expect(committed.state).not.toBe(state);
    expect(committed.state.document).toBe(committedDocument);
    expect(committed.state.transient).toBe(transient);
    expect(committed.effects).toEqual([{ type: 'document-commit', document: committedDocument }]);
    expect(committed.effects).toHaveLength(1);
    expect(committed.effects[0].document).toBe(committedDocument);
    expect(committed.state.document).not.toHaveProperty('preview');
    expect(committed.state.document.strokes).toEqual(documentWith('committed').strokes);
  });

  it('dispatches history and onChange exactly once per commit and never for transient updates', () => {
    const history = jest.fn();
    const onChange = jest.fn();
    const target = { history, onChange };
    const state = createCoreState(documentWith('initial'), { preview: 'start' }).state;

    dispatchEffects(updateTransient(state, { preview: 'moving' }), target);
    dispatchEffects(cancelTransient(state), target);
    dispatchEffects(clearTransient(state), target);

    expect(history).toHaveBeenCalledTimes(0);
    expect(onChange).toHaveBeenCalledTimes(0);

    const committedDocument = documentWith('committed');
    dispatchEffects(commitDocument(state, committedDocument), target);

    expect(history).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);

    // payload 只含 document，绝不携带 transient 状态。
    expect(history).toHaveBeenCalledWith(committedDocument);
    expect(onChange).toHaveBeenCalledWith(committedDocument);
    const [historyPayload] = history.mock.calls[0];
    const [changePayload] = onChange.mock.calls[0];
    expect(historyPayload).toBe(committedDocument);
    expect(changePayload).toBe(committedDocument);
    expect(historyPayload).not.toHaveProperty('transient');
    expect(changePayload).not.toHaveProperty('transient');
    expect(historyPayload).toEqual({
      schemaVersion: 2,
      strokes: documentWith('committed').strokes,
    });
  });
});
