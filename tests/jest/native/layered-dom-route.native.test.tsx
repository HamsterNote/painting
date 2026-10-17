import { render } from '@testing-library/react-native';
import LayeredEditorRoute from '../../../apps/playground/src/layered-editor/LayeredEditorRoute';

// Jest cannot launch a WebView; only the Expo DOM host boundary is mocked here.
jest.mock('../../../apps/playground/src/layered-editor/LayeredEditorDom', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: (props: object) =>
      React.createElement(View, { testID: 'expo-dom-editor-host', ...props }),
  };
});

test('native route mounts the whole DOM editor with layout-only props', async () => {
  const result = await render(<LayeredEditorRoute />);
  const host = result.getByTestId('expo-dom-editor-host');
  expect(host.props.dom).toEqual({ style: { flex: 1 } });
  expect(
    Object.keys(host.props).filter((key) => !['testID', 'dom', 'children'].includes(key))
  ).toEqual([]);
});
