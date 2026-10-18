/** @jest-environment node */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createResourceRegistry,
  registerImageResource,
  removeImageResource,
  resolveImageResource,
  type ImageResourceRecord,
} from '../../core/resourceRegistry';

const first: ImageResourceRecord = {
  resourceId: 'resource-1',
  src: 'memory://first',
  naturalWidth: 800,
  naturalHeight: 600,
};

describe('core/resourceRegistry', () => {
  it('resolves a matching resource ID before an exact src fallback', () => {
    const registry = [
      first,
      { resourceId: 'resource-2', src: 'memory://shared' },
      { resourceId: 'resource-3', src: 'memory://first' },
    ].reduce(
      (current, record) => registerImageResource(current, record).registry,
      createResourceRegistry()
    );

    expect(
      resolveImageResource(registry, { resourceId: 'resource-1', src: 'memory://shared' })
    ).toEqual({
      resource: first,
    });
    expect(
      resolveImageResource(registry, { resourceId: 'missing', src: 'memory://first' })
    ).toEqual({
      resource: first,
    });
    expect(resolveImageResource(registry, { src: 'memory://shared' })).toEqual({
      resource: { resourceId: 'resource-2', src: 'memory://shared' },
    });
    expect(resolveImageResource(registry, { src: 'memory://none' })).toEqual({});
  });

  it('is immutable and idempotent for the same record', () => {
    const input = Object.freeze({ ...first });
    const registry = createResourceRegistry();
    const registered = registerImageResource(registry, input);
    const repeated = registerImageResource(registered.registry, input);

    expect(registry.records).toEqual([]);
    expect(registered.registry).not.toBe(registry);
    expect(registered.registry.records[0]).not.toBe(input);
    expect(repeated.registry).toBe(registered.registry);
    expect(repeated.diagnostics).toEqual([]);
    expect(removeImageResource(registered.registry, 'missing')).toBe(registered.registry);
    expect(removeImageResource(registered.registry, 'resource-1')).toEqual({ records: [] });
  });

  it('retains the existing record and reports an explicit ID collision', () => {
    const registry = registerImageResource(createResourceRegistry(), first).registry;
    const incoming = { ...first, src: 'memory://replacement' };
    const result = registerImageResource(registry, incoming);

    expect(result.registry).toBe(registry);
    expect(result.diagnostics).toEqual([
      {
        type: 'resource-id-collision',
        resourceId: 'resource-1',
        existing: first,
        incoming,
      },
    ]);
  });

  it('has no platform, I/O, rendering, or ID-generation dependencies', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'packages/painting/src/core/resourceRegistry.ts'),
      'utf8'
    );

    expect(source).not.toMatch(
      /(?:from\s+['"](?:react|react-native|expo|@shopify\/react-native-skia)|\b(?:window|document|fetch|crypto|Skia)\b)/
    );
  });
});
