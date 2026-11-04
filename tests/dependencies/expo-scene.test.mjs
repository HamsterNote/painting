import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(new URL('../../apps/playground/package.json', import.meta.url));
const { migrateAppDelegate } = require('./plugins/with-ios-scene.cjs');
const template = execFileSync(
  'tar',
  [
    '-xOf',
    path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz'),
    'package/ios/HelloWorld/AppDelegate.swift',
  ],
  { encoding: 'utf8' }
);

test('installed Expo template gives the scene ownership of startup and retains linking', () => {
  const source = migrateAppDelegate(template);
  assert.match(source, /ExpoAppDelegate, ExpoReactNativeFactoryProvider/);
  assert.match(source, /reactNativeFactory = factory/);
  assert.match(
    source,
    /return super.application\(application, didFinishLaunchingWithOptions: launchOptions\)/
  );
  assert.doesNotMatch(source, /UIWindow\(frame:|factory.startReactNative\(/);
  assert.match(source, /RCTLinkingManager.application\(app, open: url/);
  assert.match(source, /RCTLinkingManager.application\(application, continue: userActivity/);
  assert.match(source, /bridge.bundleURL \?\? bundleURL\(\)/);
  assert.equal(migrateAppDelegate(source), source);
});

test('unrecognized startup fails prebuild instead of silently retaining a second root', () => {
  assert.throws(() => migrateAppDelegate('class AppDelegate: CustomDelegate {}'));
  assert.throws(() =>
    migrateAppDelegate(
      template.replace('launchOptions: launchOptions)', 'launchOptions: customOptions)')
    )
  );
  assert.throws(() =>
    migrateAppDelegate(template.replace('reactNativeFactory = factory', '// missing factory'))
  );
});
