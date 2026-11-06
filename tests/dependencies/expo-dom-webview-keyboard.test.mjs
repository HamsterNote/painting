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
    /await viewRef\.current\?\.setToolbarKeyboardScope\(scope, tabOnly\)/
  );
  for (const file of ['src/DomWebView.types.ts', 'build/DomWebView.types.d.ts']) {
    assert.match(
      read(file),
      /setToolbarKeyboardScope: \(scope: string, tabOnly: boolean\) => Promise<void>/
    );
  }
  const swift = read('ios/DomWebView.swift');
  assert.match(swift, /override var keyCommands/);
  assert.match(swift, /guard !toolbarKeyboardScope\.isEmpty else \{ return super\.keyCommands \}/);
  assert.match(swift, /window\.__paintingToolbarKeyboard\?\.receive/);
  assert.doesNotMatch(swift, /becomeFirstResponder|func requestFocus/);
});

test('installed native commands share the live text guard at registration, validation and delivery', () => {
  // This checks the installed patch contract, not UIKit execution or compilation.
  const swift = read('ios/DomWebView.swift');
  const gate = swift
    .split('fileprivate func toolbarActionAllowed')[1]
    .split('override var keyCommands')[0];
  const registration = swift
    .split('override var keyCommands')[1]
    .split('override func canPerformAction')[0];
  const validation = swift
    .split('override func canPerformAction')[1]
    .split('override func target')[0];
  const delivery = swift
    .split('@objc fileprivate func toolbarKey')[1]
    .split('override var inputAccessoryView')[0];
  assert.match(gate, /let responder = toolbarFirstResponder\(in: self\)/);
  assert.match(gate, /guard textInput\.markedTextRange == nil else \{ return false \}/);
  assert.match(
    gate,
    /guard toolbarKeyboardTabOnly \|\| textInput\.selectedTextRange == nil else \{ return false \}/
  );
  assert.ok(gate.indexOf('markedTextRange') < gate.indexOf('action == #selector(toolbarTab'));
  assert.match(registration, /toolbarCommands\.filter/);
  for (const boundary of [registration, validation, delivery])
    assert.match(boundary, /toolbarActionAllowed\(action\)/);
  assert.ok(
    delivery.indexOf('toolbarActionAllowed(action)') < delivery.indexOf('evaluateJavaScript')
  );
});
