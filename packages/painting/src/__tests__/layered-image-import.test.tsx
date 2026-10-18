import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useImageImport } from '../layered/useImageImport';
import { makeLayeredController, layeredRect } from './fixtures/layered';

let images: HTMLImageElement[];
const NativeImage = global.Image;

beforeEach(() => {
  images = [];
  global.Image = jest.fn(() => {
    const image = { naturalWidth: 120, naturalHeight: 80 } as HTMLImageElement;
    images.push(image);
    return image;
  }) as unknown as typeof Image;
});

afterEach(() => {
  global.Image = NativeImage;
});

function mount() {
  const controller = makeLayeredController([layeredRect()]);
  controller.setTool('image');
  function Import() {
    const image = useImageImport(controller, () => 'imported-image');
    return (
      <>
        {image.element}
        <button onClick={() => image.openAt({ x: 30, y: 40 })}>选择文件</button>
      </>
    );
  }
  render(<Import />);
  fireEvent.click(screen.getByText('选择文件'));
  const file = new File(['png'], 'image.png', { type: 'image/png' });
  const input = screen.getByLabelText('导入图片文件');
  return { controller, file, input };
}

async function finishDecode() {
  await waitFor(() => expect(images).toHaveLength(1));
  act(() => images[0].onload!(new Event('load')));
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
}

test('decoded image appends once after existing content; undo/redo retain src and bounds', async () => {
  const { controller, file, input } = mount();
  fireEvent.change(input, { target: { files: [file] } });
  expect(controller.getSnapshot('document').objects).toHaveLength(1);
  await finishDecode();
  const objects = controller.getSnapshot('document').objects;
  expect(objects.map((object) => object.objectId)).toEqual(['rect', 'imported-image']);
  expect(objects[1]).toMatchObject({
    kind: 'image',
    src: 'data:image/png;base64,cG5n',
    localBounds: { minX: 30, minY: 40, maxX: 150, maxY: 120 },
  });
  controller.undo();
  expect(controller.getSnapshot('document').objects).toHaveLength(1);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
  controller.redo();
  expect(controller.getSnapshot('document').objects).toEqual(objects);
});

test.each(['cancel', 'tool', 'document'] as const)(
  '%s invalidates a late decode without an image history entry',
  async (reason) => {
    const { controller, file, input } = mount();
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(images).toHaveLength(1));
    if (reason === 'cancel') fireEvent.click(screen.getByText('取消'));
    if (reason === 'tool')
      act(() => {
        controller.setTool('selection');
      });
    if (reason === 'document')
      act(() => {
        controller.editObjects({ expectedDocumentRevision: 0, removeIds: ['rect'] });
      });
    const before = controller.getSnapshot('document');
    await finishDecode();
    expect(controller.getSnapshot('document')).toBe(before);
    expect(
      controller.getSnapshot('document').objects.some((object) => object.kind === 'image')
    ).toBe(false);
  }
);

test('invalid files and decode failures do not create document or history changes', async () => {
  const { controller, input } = mount();
  const before = controller.getSnapshot('document');
  fireEvent.change(input, {
    target: { files: [new File(['bad'], 'bad.svg', { type: 'image/svg+xml' })] },
  });
  expect(screen.getByRole('alert').textContent).toContain('仅支持');
  expect(images).toHaveLength(0);
  fireEvent.click(screen.getByText('选择文件'));
  fireEvent.change(input, {
    target: { files: [new File(['bad'], 'bad.png', { type: 'image/png' })] },
  });
  await waitFor(() => expect(images).toHaveLength(1));
  act(() => images[0].onerror!(new Event('error')));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('无法解码'));
  expect(controller.getSnapshot('document')).toBe(before);
  expect(controller.getSnapshot('history').canUndo).toBe(false);
});
