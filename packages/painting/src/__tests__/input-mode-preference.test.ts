import { createEditor } from '../layered/createEditor';
import {
  INPUT_MODE_PREFERENCE_KEY as key,
  readInputModePreference,
  writeInputModePreference,
} from '../layered/inputModePreference';

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test('restores synchronously, explicit mode wins, and detection is never stored', () => {
  localStorage.setItem(key, JSON.stringify('pen'));
  const editor = createEditor();
  expect(editor.getSnapshot('input')).toEqual({
    mode: 'pen',
    penSeen: false,
    effectiveTouch: 'pan',
  });
  expect(createEditor(undefined, { inputMode: 'finger' }).getSnapshot('input').mode).toBe('finger');
  const write = jest.spyOn(Storage.prototype, 'setItem');
  editor.recordPenDown();
  expect(write).not.toHaveBeenCalled();
  editor.setInputMode('finger');
  writeInputModePreference('finger');
  expect(write).toHaveBeenCalledWith(key, '"finger"');
  expect(localStorage.getItem(key)).toBe('"finger"');
});

test.each(['broken-json', '"unknown"', '{"mode":"pen","penSeen":true}', 'null'])(
  'invalid preference %s defaults to auto',
  (stored) => {
    localStorage.setItem(key, stored);
    expect(createEditor().getSnapshot('input').mode).toBe('auto');
  }
);

test('read, parse, write and storage-access failures retain usable memory state', () => {
  const fail = () => {
    throw new Error('storage denied');
  };
  expect(readInputModePreference(fail)).toBeUndefined();
  expect(readInputModePreference(() => undefined)).toBeUndefined();
  expect(() => writeInputModePreference('finger', fail)).not.toThrow();
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(fail);
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(fail);
  const editor = createEditor();
  expect(editor.getSnapshot('input').mode).toBe('auto');
  editor.setInputMode('finger');
  writeInputModePreference('finger');
  expect(editor.getSnapshot('input').effectiveTouch).toBe('draw');
  jest.spyOn(JSON, 'parse').mockImplementation(fail);
  expect(
    readInputModePreference(() => ({ getItem: () => '"pen"', setItem: jest.fn() }))
  ).toBeUndefined();
});
