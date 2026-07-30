import { generateRulerTicks, millimetersToPixels } from '../ticks';

describe('ruler physical ticks', () => {
  it('converts millimeters with the calibrated CSS pixels per inch', () => {
    // Given: 254 CSS 像素代表一英寸，便于精确验证 1 mm = 10 px。
    const pixelsPerInch = 254;

    // When: 将毫米距离换算为屏幕 CSS 像素。
    const pixels = millimetersToPixels(12.5, pixelsPerInch);

    // Then: 换算结果保持真实物理比例。
    expect(pixels).toBe(125);
  });

  it('generates one tick per millimeter with longer half-centimeter and centimeter marks', () => {
    // Given: 一把 30 mm 长、每毫米恰好 10 CSS 像素的尺子。
    const length = 300;

    // When: 生成物理刻度。
    const ticks = generateRulerTicks({ length, pixelsPerInch: 254 });

    // Then: 毫米刻度保持 1 mm 间距，并通过 kind 区分三档刻度高度。
    expect(ticks).toHaveLength(31);
    expect(ticks[0]).toEqual({ localX: -150, millimeter: 0, kind: 'centimeter' });
    expect(ticks[1]).toEqual({ localX: -140, millimeter: 1, kind: 'millimeter' });
    expect(ticks[5]).toEqual({ localX: -100, millimeter: 5, kind: 'half-centimeter' });
    expect(ticks[10]).toEqual({ localX: -50, millimeter: 10, kind: 'centimeter' });
    expect(ticks[30]).toEqual({ localX: 150, millimeter: 30, kind: 'centimeter' });
  });

  it('uses 96 CSS pixels per inch when calibration is invalid', () => {
    // Given: 无效校准值和一段恰好 10 mm 的默认 CSS 物理长度。
    const length = (96 / 25.4) * 10;

    // When: 生成刻度。
    const ticks = generateRulerTicks({ length, pixelsPerInch: Number.NaN });

    // Then: 回退到 96 CSS PPI，并生成 0 至 10 mm 共 11 条刻度。
    expect(ticks).toHaveLength(11);
    expect(ticks[10]?.millimeter).toBe(10);
    expect(ticks[10]?.kind).toBe('centimeter');
  });
});
