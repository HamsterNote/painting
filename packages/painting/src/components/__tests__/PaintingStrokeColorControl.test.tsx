import { fireEvent, render, screen } from '@testing-library/react';
import { PaintingStrokeColorControl } from '../PaintingStrokeColorControl';

describe('PaintingStrokeColorControl', () => {
  it('keeps the native color picker host mounted while its color changes', () => {
    // Given: 用户已从 Custom 打开系统取色器。
    const onStrokeColorChange = jest.fn();
    render(
      <PaintingStrokeColorControl
        strokeColor="#000000"
        theme="dark"
        onStrokeColorChange={onStrokeColorChange}
      />
    );
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-btn'));
    const customInput = screen.getByTestId('painting-board-stroke-color-custom-input');

    // When: 系统取色器在调色过程中向页面发送颜色变化。
    fireEvent.change(customInput, { target: { value: '#14b8a6' } });

    // Then: 新颜色立即写回，但承载系统取色器的 input 不会被卸载。
    expect(onStrokeColorChange).toHaveBeenCalledWith('#14b8a6');
    expect(customInput.isConnected).toBe(true);
    expect(screen.queryByTestId('painting-board-stroke-color-menu')).not.toBeNull();
  });

  it('closes the menu after a page mouse down outside the control', () => {
    // Given: 颜色菜单已打开。
    render(
      <PaintingStrokeColorControl
        strokeColor="#000000"
        theme="dark"
        onStrokeColorChange={jest.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('painting-board-stroke-color-btn'));

    // When: 用户在页面中的其他区域按下鼠标。
    fireEvent.mouseDown(document.body);

    // Then: 菜单正常关闭。
    expect(screen.queryByTestId('painting-board-stroke-color-menu')).toBeNull();
  });
});
