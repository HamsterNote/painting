import { act } from '@testing-library/react';
import { useState } from 'react';
import { DrawingSurface, type DrawingValue } from '../src/components/DrawingSurface';

type PointerPosition = Readonly<{ x: number; y: number }>;

export const TEXT_VALUE: DrawingValue = {
  strokes: [
    {
      id: 'text-1',
      tool: 'text',
      points: [
        { x: 20, y: 30 },
        { x: 180, y: 58.8 },
      ],
      strokeColor: '#000000',
      strokeWidth: 0,
      text: 'Hamster',
      fontSize: 24,
    },
  ],
};

export const MIXED_VALUE: DrawingValue = {
  strokes: [
    ...TEXT_VALUE.strokes,
    {
      id: 'rect-1',
      tool: 'rect',
      points: [
        { x: 200, y: 30 },
        { x: 260, y: 90 },
      ],
      strokeColor: '#000000',
      strokeWidth: 2,
    },
  ],
};

export function mockHostRect(element: HTMLElement) {
  element.getBoundingClientRect = jest.fn(() => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 300,
    width: 400,
    height: 300,
    toJSON: () => ({}),
  }));
}

export function dispatchPointer(
  target: Element | Document,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  position: PointerPosition,
  pointerId = 1
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    clientX: position.x,
    clientY: position.y,
    pointerId,
    pointerType: 'mouse',
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    pressure: type === 'pointerup' ? 0 : 0.5,
    isPrimary: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  });
  act(() => target.dispatchEvent(event));
  return event;
}

export function ControlledTextSurface({
  onChange,
}: {
  readonly onChange?: (value: DrawingValue) => void;
}) {
  const [value, setValue] = useState<DrawingValue>({ strokes: [] });
  return (
    <DrawingSurface
      testID="text-surface"
      tool="text"
      value={value}
      onChange={(nextValue) => {
        setValue(nextValue);
        onChange?.(nextValue);
      }}
      strokeColor="#2563eb"
      fontSize={32}
    />
  );
}
