import { useEffect } from 'react';
import { render } from '@testing-library/react';
import LayeredEditorDom from '../../../../apps/playground/src/layered-editor/LayeredEditorDom';
import { LayeredPaintingBoard } from '@hamster-note/painting-board';
import type { PencilkitDemoConnection } from '../input/native/pencilkitDemoBridge';
import type { PencilkitDemoMessage } from '../input/native/pencilkitDemoContract';

jest.mock('@hamster-note/painting-board', () => ({ LayeredPaintingBoard: jest.fn() }));

test('Expo action proxy/props churn does not rebuild the native lease or resend an identical message', () => {
  const receive = jest.fn();
  const disconnect = jest.fn();
  let connection: PencilkitDemoConnection | undefined;
  jest.mocked(LayeredPaintingBoard).mockImplementation(function Board(props) {
    connection = props.nativePencilExperiment;
    useEffect(() => {
      props.nativePencilExperiment?.register(receive);
      return disconnect;
    }, [props.nativePencilExperiment]);
    return null;
  });
  const initialState = jest.fn(async () => {});
  const initialReply = jest.fn(async () => {});
  const message: PencilkitDemoMessage = {
    type: 'reset',
    protocolVersion: 1,
    messageId: 1,
    id: 0,
    contextKey: '',
  };
  const view = render(
    <LayeredEditorDom
      nativePencilEnabled
      nativeMessage={message}
      onNativeState={initialState}
      onNativeReply={initialReply}
    />
  );
  const firstConnection = connection;
  const newState = jest.fn(async () => {});
  const newReply = jest.fn(async () => {});
  view.rerender(
    <LayeredEditorDom
      nativePencilEnabled
      nativeMessage={{ ...message }}
      onNativeState={newState}
      onNativeReply={newReply}
    />
  );
  expect(connection).toBe(firstConnection);
  expect(disconnect).not.toHaveBeenCalled();
  expect(receive).toHaveBeenCalledTimes(1);
  connection!.onReply({ id: 0, contextKey: '', status: 'reset' });
  expect(newReply).toHaveBeenCalledTimes(1);
  expect(initialReply).not.toHaveBeenCalled();
  view.unmount();
});
