import type { DocumentObject, EditorDocument } from '@hamster-note/painting/layered';

// Deterministic schema-3 data; shared by the production runner and UI regression.
export function lassoFixture(count: number, scenario = 'local'): EditorDocument {
  let seed = 245;
  const random = () => (seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296;
  const base = {
    objectRevision: 1,
    transformRevision: 1,
    transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
  };
  const objects: DocumentObject[] = Array.from({ length: count }, (_, i) => {
    const x = scenario === 'dense' ? 250 + random() * 650 : 50 + (i % 40) * 28;
    const y = scenario === 'dense' ? 180 + random() * 350 : 60 + Math.floor(i / 40) * 23;
    const phase = random() * Math.PI * 2;
    return {
      ...base,
      kind: 'freehand',
      objectId: `ink-${i}`,
      commitId: `ink-${i}`,
      samplesRevision: 1,
      brushRevision: 1,
      resolvedPressureMode: 'constant',
      brushSnapshot: {
        color: '#222222',
        nominalSize: 3,
        opacity: 1,
        pressureMode: 'constant',
        presetRevision: 1,
      },
      samples: Array.from({ length: 64 }, (_, j) => ({
        sequence: j,
        x: x + j * 0.28,
        y: y + Math.sin(j / 8 + phase) * 3,
        pressure: 0.5,
        source: 'pen',
        phase: j === 0 ? 'down' : j === 63 ? 'up' : 'move',
        time: j * 8,
      })),
    };
  });
  if (scenario === 'mixed') {
    for (let i = 0; i < 50; i++) {
      const x = 100 + (i % 10) * 90,
        y = 100 + Math.floor(i / 10) * 90;
      const common = { ...base, objectId: `mixed-${i}` };
      const localBounds = { minX: x, minY: y, maxX: x + 35, maxY: y + 24 };
      objects.push(
        i < 20
          ? { ...common, kind: 'text', content: '245', fontSize: 16, color: '#222222', localBounds }
          : i < 40
            ? {
                ...common,
                kind: 'shape',
                shapeType: 'rect',
                points: [
                  { x, y },
                  { x: x + 35, y: y + 24 },
                ],
                style: { color: '#2563eb', width: 3, opacity: 1 },
              }
            : {
                ...common,
                kind: 'image',
                localBounds,
                src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
              }
      );
    }
  }
  return { schemaVersion: 3, documentRevision: 0, objects };
}

export function lassoTrajectory(scenario: string) {
  const local = scenario === 'local';
  return Array.from({ length: 600 }, (_, i) => {
    const angle = (i / 599) * Math.PI * 2;
    return {
      x: (local ? 220 : 610) + (local ? 180 : 560) * Math.cos(angle),
      y: (local ? 200 : 350) + (local ? 120 : 290) * Math.sin(angle),
    };
  });
}
