import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(path.join(repo, 'package.json'));
const appRequire = createRequire(path.join(repo, 'apps/playground/package.json'));
const babelRequire = createRequire(require.resolve('babel-jest'));
const { transformSync } = babelRequire('@babel/core');
const expoRequire = createRequire(require.resolve('babel-preset-expo'));
const installedRoot = path.dirname(appRequire.resolve('react-native-web/package.json'));
const packageRequire = createRequire(path.join(installedRoot, 'package.json'));
const root = process.env.RNW_PATCH_ROOT ? path.resolve(process.env.RNW_PATCH_ROOT) : installedRoot;

// Evaluate the installed modules, including their real history/math consumers.
// Instrument Map allocation in the VM to measure retained identities without
// exporting test hooks or replacing console/error behavior in the dependency.
function loadVariant(variant) {
  const maps = [];
  class TrackedMap extends Map {
    constructor(...args) {
      super(...args);
      maps.push(this);
    }
  }
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const localRequire = createRequire(filename);
    const code = transformSync(readFileSync(filename, 'utf8'), {
      filename,
      babelrc: false,
      configFile: false,
      plugins: [
        expoRequire.resolve('@babel/plugin-transform-flow-strip-types'),
        expoRequire.resolve('@babel/plugin-transform-modules-commonjs'),
      ],
    }).code;
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require: (name) =>
          name.startsWith('.') ? load(localRequire.resolve(name)) : packageRequire(name),
        console,
        process: { env: { NODE_ENV: 'development' } },
        Map: TrackedMap,
      },
      { filename }
    );
    return module.exports;
  }
  const entry = (relative) => load(path.join(root, variant, relative));
  const unwrap = (module) => module.default || module;
  return {
    create: unwrap(entry('modules/useResponderEvents/createResponderEvent.js')),
    Store: entry('modules/useResponderEvents/ResponderTouchHistoryStore.js')
      .ResponderTouchHistoryStore,
    math: unwrap(entry('vendor/react-native/TouchHistoryMath/index.js')),
    maps,
  };
}

function harness(variant) {
  const modules = loadVariant(variant);
  const store = new modules.Store();
  let timeStamp = 1;
  const send = (type, changedTouches, touches) => {
    const input = { type, changedTouches, touches, timeStamp: timeStamp++ };
    const before = JSON.stringify(input);
    const { nativeEvent } = modules.create(input, store);
    assert.equal(JSON.stringify(input), before, 'raw browser IDs and events are unchanged');
    if (changedTouches.length)
      assert.equal(nativeEvent.identifier, nativeEvent.changedTouches[0].identifier);
    assert.equal(new Set(nativeEvent.touches.map((t) => t.identifier)).size, touches.length);
    changedTouches.forEach((raw, index) => {
      const activeIndex = touches.findIndex((touch) => touch.identifier === raw.identifier);
      if (activeIndex !== -1)
        assert.equal(
          nativeEvent.changedTouches[index].identifier,
          nativeEvent.touches[activeIndex].identifier
        );
    });
    store.recordTouchTrack(type, nativeEvent);
    return nativeEvent;
  };
  return { ...modules, store, send };
}

const touch = (identifier, pageX = 100) => ({
  identifier,
  pageX,
  pageY: 50,
  clientX: pageX,
  clientY: 50,
  force: 0.5,
});

for (const variant of ['src', 'dist', 'dist/cjs']) {
  test(`${variant}: distinct IDs, both release orders and real TouchHistoryMath`, () => {
    const h = harness(variant);
    for (const ids of [
      [1, 2],
      [1, 21],
      [21, 41],
      [-1, -2],
      [0, 20],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER - 20],
    ]) {
      for (const reverse of [false, true]) {
        const a = touch(ids[0]);
        const b = touch(ids[1], 300);
        const started = h.send('touchstart', [a, b], [a, b]);
        const slots = started.touches.map((t) => t.identifier);
        assert.ok(slots.every((slot) => Number.isInteger(slot) && slot > 0 && slot <= 2));
        assert.equal(h.math.currentCentroidX(h.store.touchHistory), 200);
        const movedB = touch(ids[1], 400);
        const moved = h.send('touchmove', [movedB], [a, movedB]);
        assert.deepEqual(
          Array.from(moved.touches, (t) => t.identifier),
          Array.from(slots)
        );
        assert.equal(h.math.currentCentroidX(h.store.touchHistory), 250);
        const survivor = reverse ? a : movedB;
        const ended = reverse ? movedB : a;
        const end = h.send('touchend', [ended], [survivor]);
        assert.equal(end.changedTouches[0].identifier, slots[reverse ? 1 : 0]);
        assert.equal(end.touches[0].identifier, slots[reverse ? 0 : 1]);
        assert.equal(h.store.touchHistory.indexOfSingleActiveTouch, end.touches[0].identifier);
        assert.equal(h.math.currentCentroidX(h.store.touchHistory), survivor.pageX);
        h.send('touchend', [survivor], []);
        assert.equal(h.store.touchHistory.numberActiveTouches, 0);
        assert.equal(h.maps[0].size, 0);
        assert.ok(h.store.touchHistory.touchBank.length <= 3);
      }
    }
  });

  test(`${variant}: mouse slot zero and separate history stores remain isolated`, () => {
    const { create, Store } = loadVariant(variant);
    const a = new Store();
    const b = new Store();
    const raw = {
      type: 'touchstart',
      changedTouches: [touch(0)],
      touches: [touch(0)],
      timeStamp: 1,
    };
    assert.equal(create(raw, a).nativeEvent.identifier, 1);
    const mouse = create(
      { type: 'mousedown', timeStamp: 2, clientX: 5, clientY: 6 },
      a
    ).nativeEvent;
    assert.equal(mouse.identifier, 0);
    assert.equal(mouse.touches[0].identifier, 0);
    for (const type of ['mouseup', 'dragstart']) {
      const end = create({ type, timeStamp: 3 }, a).nativeEvent;
      assert.equal(end.identifier, 0);
      assert.equal(end.touches.length, 0);
    }
    assert.equal(
      create({ ...raw, changedTouches: [touch(21)], touches: [touch(21)] }, b).nativeEvent
        .identifier,
      1
    );
    assert.equal(create({ ...raw, type: 'touchmove' }, a).nativeEvent.identifier, 1);
  });

  test(`${variant}: 5000 rounds reuse slots, cancel safely, and keep a survivor stable`, () => {
    const h = harness(variant);
    const anchor = touch(-123456789, 80);
    const anchorSlot = h.send('touchstart', [anchor], [anchor]).identifier;
    for (let round = 0; round < 5000; round++) {
      const a = touch(round * 20 + 1, 200);
      const b = touch(-round * 20 - 2, 400);
      const start = h.send('touchstart', [a, b], [anchor, a, b]);
      assert.equal(start.touches[0].identifier, anchorSlot);
      assert.equal(h.math.currentCentroidX(h.store.touchHistory), 680 / 3);
      const ended = h.send(round % 2 ? 'touchcancel' : 'touchend', [a, b], [anchor]);
      assert.equal(ended.touches[0].identifier, anchorSlot);
      assert.equal(h.maps[0].size, 1);
      assert.equal(h.store.touchHistory.indexOfSingleActiveTouch, anchorSlot);
      assert.equal(h.math.currentCentroidX(h.store.touchHistory), 80);
      assert.ok(h.store.touchHistory.touchBank.length <= 4);
      assert.ok(start.changedTouches.every((t) => t.identifier <= 3));
    }
    h.send('touchcancel', [anchor], []);
    assert.equal(h.maps[0].size, 0);
    assert.equal(h.store.touchHistory.numberActiveTouches, 0);
    const fresh = touch(Number.MAX_SAFE_INTEGER, 900);
    assert.equal(h.send('touchstart', [fresh], [fresh]).identifier, 1);
    assert.equal(h.math.currentCentroidX(h.store.touchHistory), 900);
    h.send('touchend', [fresh], []);
    assert.equal(h.maps[0].size, 0);
  });
}
