import { act } from '@testing-library/react';
import { IDENTITY_TRANSFORM, type TextObject, type ImageObject } from '../../model/document';

export const layeredText: TextObject = {
  kind: 'text',
  objectId: 'text',
  objectRevision: 1,
  transformRevision: 1,
  transform: IDENTITY_TRANSFORM,
  content: 'Hamster 中文',
  fontSize: 24,
  color: '#000000',
  localBounds: { minX: 20, minY: 30, maxX: 220, maxY: 130 },
};
export const layeredImage: ImageObject = {
  kind: 'image',
  objectId: 'image',
  objectRevision: 1,
  transformRevision: 1,
  transform: IDENTITY_TRANSFORM,
  src: 'data:image/png;base64,image-fixture',
  localBounds: { minX: 250, minY: 30, maxX: 350, maxY: 130 },
};

export function mockLayeredDom() {
  const context = Object.fromEntries(
    [
      'setTransform',
      'clearRect',
      'save',
      'restore',
      'transform',
      'beginPath',
      'moveTo',
      'lineTo',
      'closePath',
      'fill',
    ].map((key) => [key, jest.fn()])
  );
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(context as unknown as CanvasRenderingContext2D);
  jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  return context;
}
export function layeredPointer(
  target: EventTarget,
  phase: 'down' | 'move' | 'up' | 'cancel',
  x: number,
  y: number,
  source = 'pen',
  id = 1
) {
  const event = new Event('pointer' + phase, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: id,
    pointerType: source,
    button: 0,
    buttons: phase === 'up' || phase === 'cancel' ? 0 : 1,
    clientX: x,
    clientY: y,
    pressure: phase === 'up' ? 0 : 0.5,
  });
  act(() => {
    target.dispatchEvent(event);
  });
}
