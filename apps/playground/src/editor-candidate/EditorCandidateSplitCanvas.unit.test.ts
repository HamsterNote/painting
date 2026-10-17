/// <reference types="jest" />
/**
 * split-canvas 诊断模式读取器的聚焦单测（纯逻辑，不渲染组件）。
 *
 * 覆盖：`perfRenderer=split-canvas` 仅在 `perf=1` 时启用；三个既有变体语义不变；非法/缺失
 * 取值一律 null。组件的 React.memo 隔离、pointerEvents 与 DIP/dSF 对齐由浏览器诊断验证，
 * 本目录没有该组件的渲染单测夹具（模块图依赖 react-native / Skia）。
 *
 * 说明：Surface 模块会导入 react-native 与 Skia，故此处 mock 掉非纯依赖，只验证纯读取逻辑。
 */
jest.mock('react-native', () => {
  const React = require('react');
  const component = (name: string) => {
    const Mock = ({ children }: { children?: unknown }) =>
      React.createElement(name, null, children);
    Mock.displayName = `RNMock(${name})`;
    return Mock;
  };
  return {
    Pressable: component('rn-pressable'),
    Text: component('rn-text'),
    View: component('rn-view'),
    StyleSheet: { create: (styles: unknown) => styles },
  };
});

jest.mock(
  '@shopify/react-native-skia',
  () => ({
    Skia: {
      Color: (value: string) => value,
      Path: {
        Make: () => ({ moveTo() {}, lineTo() {}, close() {}, setFillType() {} }),
      },
      ParagraphBuilder: {
        Make: () => ({ pushStyle() {}, addText() {}, build: () => ({ layout() {} }) }),
      },
      Image: { MakeImageFromEncoded: () => null },
      Data: { fromBase64: () => ({}) },
    },
  }),
  { virtual: true }
);

jest.mock('@hamster-note/painting/skia', () => ({ WebShapedRunProvider: class {} }));

import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SkiaOverlay } from '@hamster-note/painting/skia';
import {
  readPerfRendererMode,
  resolvePerfRendererPulseMarker,
  resolveSplitOverlayOverlays,
  SplitCanvasOverlayLayer,
  SplitCanvasWorldLayer,
} from './EditorCandidateSurface.web';

function withSearch(search: string): void {
  (globalThis as { window?: unknown }).window = { location: { search } };
}

interface CapturedLayerProps {
  overlays: readonly unknown[];
}

/** 极简 canvas stub：SSR 下记录传入的 overlays，并输出单个 <canvas>。 */
function makeStubCanvas(captured: CapturedLayerProps[]) {
  const Stub = (props: { overlays?: readonly unknown[] }) => {
    captured.push({ overlays: props.overlays ?? [] });
    return createElement('canvas', { 'data-stub-canvas': 'true' });
  };
  return Stub as ComponentType<Record<string, unknown>>;
}

const dummyFrame = Object.freeze({}) as never;
const dummyCanvasProps = { style: { width: 120, height: 80 } } as never;
const baseLayerProps: Record<string, unknown> = {
  frame: dummyFrame,
  resolveImage: undefined,
  fontManager: undefined,
  fontFamily: undefined,
  canvasProps: dummyCanvasProps,
  width: 120,
  height: 80,
};

function renderLayer(component: unknown, props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(component as ComponentType<Record<string, unknown>>, props)
  );
}

describe('readPerfRendererMode', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('enables split-canvas only when perf=1 is present', () => {
    withSearch('?perf=1&perfRenderer=split-canvas');
    expect(readPerfRendererMode()).toBe('split-canvas');

    withSearch('?perfRenderer=split-canvas');
    expect(readPerfRendererMode()).toBeNull();
  });

  it('keeps the three existing diagnostic variants unchanged', () => {
    for (const mode of ['empty-pulse', 'overlay-only', 'world-pulse'] as const) {
      withSearch(`?perf=1&perfRenderer=${mode}`);
      expect(readPerfRendererMode()).toBe(mode);
    }
  });

  it('rejects unknown, partial or missing renderer values', () => {
    withSearch('?perf=1');
    expect(readPerfRendererMode()).toBeNull();

    withSearch('?perf=1&perfRenderer=split');
    expect(readPerfRendererMode()).toBeNull();

    withSearch('?perf=1&perfRenderer=');
    expect(readPerfRendererMode()).toBeNull();
  });
});

describe('split-canvas layer contract', () => {
  it('wraps the world layer in React.memo and keeps the overlay layer as a plain component', () => {
    // world 必须由独立 memo 组件承载，才能在 overlay-only publish 时跳过重渲染。
    expect((SplitCanvasWorldLayer as unknown as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for('react.memo')
    );
    // overlay 层需要每次 publish 重渲染以驱动 redraw，故不是 memo。
    expect(typeof SplitCanvasOverlayLayer).toBe('function');
    expect((SplitCanvasOverlayLayer as unknown as { $$typeof?: symbol }).$$typeof).toBeUndefined();
  });

  it('world layer renders exactly one canvas, pointerEvents:none and empty overlays', () => {
    const captured: CapturedLayerProps[] = [];
    const html = renderLayer(SplitCanvasWorldLayer, {
      ...baseLayerProps,
      canvasComponent: makeStubCanvas(captured),
      overlays: [],
    });

    expect(html).toContain('data-perf-canvas-layer="world"');
    expect(html).toContain('pointer-events:none');
    expect((html.match(/<canvas/g) ?? []).length).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].overlays).toHaveLength(0);
  });

  it('overlay layer renders exactly one canvas, pointerEvents:none and the full overlays', () => {
    const captured: CapturedLayerProps[] = [];
    const overlays = Object.freeze([{ id: 'perf-renderer-pulse' }]);
    const html = renderLayer(SplitCanvasOverlayLayer, {
      ...baseLayerProps,
      canvasComponent: makeStubCanvas(captured),
      overlays,
    });

    expect(html).toContain('data-perf-canvas-layer="overlay"');
    expect(html).toContain('pointer-events:none');
    expect((html.match(/<canvas/g) ?? []).length).toBe(1);
    expect(captured).toHaveLength(1);
    expect(captured[0].overlays).toBe(overlays);
  });

  it('aligns both layers with identical absolute DIP geometry', () => {
    const overlays = Object.freeze([]);
    const worldHtml = renderLayer(SplitCanvasWorldLayer, {
      ...baseLayerProps,
      canvasComponent: makeStubCanvas([]),
      overlays,
    });
    const overlayHtml = renderLayer(SplitCanvasOverlayLayer, {
      ...baseLayerProps,
      canvasComponent: makeStubCanvas([]),
      overlays,
    });

    for (const html of [worldHtml, overlayHtml]) {
      expect(html).toContain('position:absolute');
      expect(html).toContain('left:0');
      expect(html).toContain('top:0');
      expect(html).toContain('width:120px');
      expect(html).toContain('height:80px');
    }
  });
});

describe('resolveSplitOverlayOverlays', () => {
  const realOverlays: readonly SkiaOverlay[] = Object.freeze([
    {
      id: 'pen-preview-a',
      space: 'screen',
      kind: 'line',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
    },
    { id: 'pen-preview-b', space: 'world', kind: 'line', from: { x: 2, y: 2 }, to: { x: 3, y: 3 } },
  ] as const);
  const pulse: SkiaOverlay = {
    id: 'perf-renderer-pulse',
    space: 'screen',
    kind: 'line',
    from: { x: -1000, y: -1000 },
    to: { x: -1000, y: -1000 },
  };

  it('keeps split-canvas free of any pulse while retaining every real overlay', () => {
    const resolved = resolveSplitOverlayOverlays('split-canvas', realOverlays, pulse);

    // 原样返回完整真实 overlays（引用不变），既不追加也不丢失任何条目。
    expect(resolved).toBe(realOverlays);
    expect(resolved).toHaveLength(2);
    expect(resolved.map((overlay) => overlay.id)).toEqual(['pen-preview-a', 'pen-preview-b']);
    expect(resolved.some((overlay) => overlay.id === 'perf-renderer-pulse')).toBe(false);
  });

  it('still appends the diagnostic pulse for the three existing variants', () => {
    for (const mode of ['empty-pulse', 'overlay-only', 'world-pulse'] as const) {
      const resolved = resolveSplitOverlayOverlays(mode, realOverlays, pulse);
      expect(resolved).toHaveLength(3);
      expect(resolved[0]).toBe(realOverlays[0]);
      expect(resolved[1]).toBe(realOverlays[1]);
      expect(resolved[2]).toBe(pulse);
    }
  });

  it('keeps formal and pulse-less behavior unchanged', () => {
    expect(resolveSplitOverlayOverlays(null, realOverlays, null)).toBe(realOverlays);
    expect(resolveSplitOverlayOverlays('world-pulse', realOverlays, null)).toBe(realOverlays);
  });
});

describe('resolvePerfRendererPulseMarker', () => {
  it('marks split-canvas as off for the 10s gate pre-check', () => {
    expect(resolvePerfRendererPulseMarker('split-canvas')).toBe('off');
  });

  it('marks the existing pulse variants as on', () => {
    for (const mode of ['empty-pulse', 'overlay-only', 'world-pulse'] as const) {
      expect(resolvePerfRendererPulseMarker(mode)).toBe('on');
    }
  });

  it('omits the marker for the formal path so its DOM is unchanged', () => {
    expect(resolvePerfRendererPulseMarker(null)).toBeNull();
  });
});
