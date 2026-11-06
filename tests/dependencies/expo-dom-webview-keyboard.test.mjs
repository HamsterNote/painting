import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(new URL('../../apps/playground/package.json', import.meta.url));
const packageRoot = path.dirname(require.resolve('@expo/dom-webview/package.json'));
const read = (file) => readFileSync(path.join(packageRoot, file), 'utf8');

test('installed Expo patch exposes the same scoped keyboard action at every boundary', () => {
  assert.match(read('ios/DomWebViewModule.swift'), /AsyncFunction\("setToolbarKeyboardScope"\)/);
  assert.match(
    read('src/DomWebView.tsx'),
    /await viewRef\.current\?\.setToolbarKeyboardScope\(scope\)/
  );
  for (const file of ['src/DomWebView.types.ts', 'build/DomWebView.types.d.ts']) {
    assert.match(read(file), /setToolbarKeyboardScope: \(scope: string\) => Promise<void>/);
  }
  const swift = read('ios/DomWebView.swift');
  assert.match(swift, /override var keyCommands/);
  assert.match(swift, /guard !toolbarKeyboardScope\.isEmpty else \{ return super\.keyCommands \}/);
  assert.match(swift, /window\.__paintingToolbarKeyboard\?\.receive/);
  assert.doesNotMatch(swift, /becomeFirstResponder|func requestFocus/);
});
