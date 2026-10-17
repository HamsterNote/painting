import {
  IDENTITY_TRANSFORM,
  type DocumentObject,
  type EditorDocument,
  type FreehandObject,
} from '@hamster-note/painting/layered';

export function mixedFixture(): EditorDocument {
  const base = { objectRevision: 1, transformRevision: 1, transform: IDENTITY_TRANSFORM };
  const stroke = (
    id: string,
    color: string,
    size: number,
    y: number,
    start: number
  ): FreehandObject => ({
    ...base,
    kind: 'freehand',
    objectId: id,
    commitId: id,
    samplesRevision: 1,
    brushRevision: 1,
    brushSnapshot: {
      color,
      nominalSize: size,
      opacity: 1,
      pressureMode: 'constant',
      presetRevision: 1,
    },
    resolvedPressureMode: 'constant',
    samples: [
      { sequence: 0, x: start, y, pressure: 0.5, phase: 'down', source: 'pen', time: 0 },
      { sequence: 1, x: 300, y, pressure: 0, phase: 'up', source: 'pen', time: 1 },
    ],
  });
  const bitmap = document.createElement('canvas');
  bitmap.width = bitmap.height = 1;
  const context = bitmap.getContext('2d')!;
  context.fillStyle = '#0000ff';
  context.fillRect(0, 0, 1, 1);
  const objects: DocumentObject[] = [
    stroke('lower-ink', '#008000', 100, 160, 40),
    {
      ...base,
      kind: 'text',
      objectId: 'middle-text',
      content: '\u2588\u2588',
      fontSize: 120,
      color: '#000000',
      localBounds: { minX: 70, minY: 80, maxX: 310, maxY: 240 },
    },
    {
      ...base,
      kind: 'image',
      objectId: 'middle-image',
      src: bitmap.toDataURL(),
      localBounds: { minX: 120, minY: 120, maxX: 240, maxY: 240 },
    },
    {
      ...base,
      kind: 'shape',
      shapeType: 'rect',
      objectId: 'upper-shape',
      points: [
        { x: 160, y: 160 },
        { x: 260, y: 260 },
      ],
      style: { color: '#ffff00', fill: '#ffff00', width: 2, opacity: 1 },
    },
    stroke('upper-ink', '#ff0000', 40, 180, 180),
  ];
  return { schemaVersion: 3, documentRevision: 0, objects };
}

export function resourceFixture(): EditorDocument {
  const mixed = mixedFixture();
  const text = mixed.objects.find((object) => object.kind === 'text')!;
  const image = mixed.objects.find((object) => object.kind === 'image')!;
  return {
    ...mixed,
    objects: [
      {
        ...text,
        objectId: 'resource-text',
        content: 'Edit Me 123',
        fontSize: 24,
        localBounds: { minX: 50, minY: 50, maxX: 290, maxY: 170 },
      },
      {
        ...image,
        objectId: 'resource-image',
        localBounds: { minX: 350, minY: 50, maxX: 390, maxY: 90 },
      },
    ],
  };
}
