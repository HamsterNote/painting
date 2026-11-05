import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const require = createRequire(new URL('../../apps/playground/package.json', import.meta.url));
const packageRoot = path.dirname(require.resolve('@expo/dom-webview/package.json'));
const read = (file) => readFileSync(path.join(packageRoot, file), 'utf8');

test('Expo DOM WebView keeps the native non-editing keyboard focus route', () => {
  assert.match(
    read('ios/DomWebView.swift'),
    /func requestFocus\(\)[\s\S]+webView\.becomeFirstResponder\(\)/
  );
  assert.match(read('ios/DomWebViewModule.swift'), /AsyncFunction\("requestFocus"\)/);
  assert.match(
    read('src/DomWebView.tsx'),
    /requestFocus: async \(\) => \{\s+await viewRef\.current\?\.requestFocus\(\);?\s+\}/
  );
  assert.match(read('src/DomWebView.types.ts'), /requestFocus: \(\) => Promise<void>/);
  assert.match(read('build/DomWebView.types.d.ts'), /requestFocus: \(\) => Promise<void>/);
});

test('native-side focus guard preserves live text editing after an async DOM action', () => {
  const source = read('ios/DomWebView.swift');
  const script = source.match(/let isNonEditingScript = """([\s\S]*?)"""/)[1];
  const mayFocus = (activeElement) => runInNewContext(script, { document: { activeElement } });
  const element = (tagName, type) => ({
    tagName,
    type,
    matches: (selector) => selector.split(',').includes(tagName.toLowerCase()),
  });
  for (const active of [
    element('TEXTAREA'),
    element('SELECT'),
    element('INPUT', 'text'),
    element('INPUT', 'number'),
    { ...element('DIV'), isContentEditable: true },
  ]) {
    assert.equal(mayFocus(active), false);
  }
  for (const active of [
    null,
    element('BODY'),
    element('BUTTON'),
    element('INPUT', 'range'),
    element('INPUT', 'checkbox'),
  ]) {
    assert.equal(mayFocus(active), true);
  }
});
