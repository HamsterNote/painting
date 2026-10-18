import type { Locator } from '@playwright/test';

/**
 * canvas2d-pen 像素 E2E 的最小本地 readback 助手。
 *
 * 只做「把 Playwright locator screenshot 解成 RGBA」这件事，供有限颜色簇 / 暗像素计数使用；
 * 不解码 CanvasKit、不做 native、不做逐像素等价或性能结论。刻意与既有
 * `skia-drawing-fixture.spec.ts` 内的私有实现重复少量解码逻辑，因为该文件不导出这些函数，
 * 而本次任务不允许改动既有文件。
 */

export interface RgbaPng {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

/** 元素截图 readback：像素尺寸除以 CSS box 得到每 CSS 像素的倍率（dSF 诊断用）。 */
export interface ElementScreenshotReadback extends RgbaPng {
  cssWidth: number;
  cssHeight: number;
  cssX: number;
  cssY: number;
  pixelsPerCssX: number;
  pixelsPerCssY: number;
}

export interface CssRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** `#RRGGBB` → RGB，避免像素断言散落魔法数字。 */
export function rgb(hex: string): RgbColor {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

/** PNG scanline 的 Paeth 预测器（仅用于标准 RGBA PNG readback）。 */
function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) {
    return left;
  }
  return upDistance <= upLeftDistance ? up : upLeft;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 2 ** 24 +
    bytes[offset + 1] * 2 ** 16 +
    bytes[offset + 2] * 2 ** 8 +
    bytes[offset + 3]
  );
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

/**
 * 用 Node 标准库解码 Playwright 内存 screenshot。只接受 8-bit、非隔行 RGB/RGBA PNG；
 * 其它格式显式失败，避免把不能 readback 的画布当作已验证。
 */
export async function decodeRgbaPng(png: Uint8Array): Promise<RgbaPng> {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const hasPngSignature = signature.every((byte, index) => png[index] === byte);
  if (png.length < signature.length || !hasPngSignature) {
    throw new Error('像素 readback 失败：locator.screenshot() 未返回 PNG 数据。');
  }

  let offset = signature.length;
  let width = 0;
  let height = 0;
  let colorType = -1;
  const imageData: Uint8Array[] = [];
  while (offset + 12 <= png.length) {
    const length = readUint32BigEndian(png, offset);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > png.length) {
      throw new Error('像素 readback 失败：PNG chunk 长度损坏。');
    }
    const data = png.subarray(dataStart, dataEnd);
    if (type === 'IHDR') {
      if (data.length !== 13) {
        throw new Error('像素 readback 失败：PNG IHDR 长度无效。');
      }
      width = readUint32BigEndian(data, 0);
      height = readUint32BigEndian(data, 4);
      colorType = data[9];
      if (
        data[8] !== 8 ||
        (colorType !== 2 && colorType !== 6) ||
        data[10] !== 0 ||
        data[11] !== 0 ||
        data[12] !== 0
      ) {
        colorType = -1;
      }
    } else if (type === 'IDAT') {
      imageData.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset = dataEnd + 4;
  }

  if (colorType === -1 || width === 0 || height === 0 || imageData.length === 0) {
    throw new Error(
      '像素 readback 失败：需要 8-bit、非隔行 RGB/RGBA PNG，或截图中没有可解码的像素数据。'
    );
  }

  let inflated: Uint8Array;
  try {
    // 依赖名由变量提供，令本仓库在未配置 @types/node 时仍可用运行时的 Node 标准 zlib。
    const zlibModuleName = 'node:zlib';
    const zlib = (await import(zlibModuleName)) as {
      inflateSync(compressed: Uint8Array): Uint8Array;
    };
    inflated = zlib.inflateSync(concatBytes(imageData));
  } catch (error) {
    throw new Error(
      `像素 readback 失败：PNG IDAT 无法解压：${error instanceof Error ? error.message : String(error)}`
    );
  }
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const stride = width * bytesPerPixel;
  if (inflated.length !== height * (stride + 1)) {
    throw new Error('像素 readback 失败：PNG scanline 尺寸与 IHDR 不一致。');
  }

  const decoded = new Uint8Array(width * height * bytesPerPixel);
  for (let row = 0; row < height; row += 1) {
    const filter = inflated[row * (stride + 1)];
    const sourceStart = row * (stride + 1) + 1;
    const targetStart = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const source = inflated[sourceStart + column];
      const left = column >= bytesPerPixel ? decoded[targetStart + column - bytesPerPixel] : 0;
      const up = row > 0 ? decoded[targetStart - stride + column] : 0;
      const upLeft =
        row > 0 && column >= bytesPerPixel
          ? decoded[targetStart - stride + column - bytesPerPixel]
          : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = source;
          break;
        case 1:
          value = (source + left) & 0xff;
          break;
        case 2:
          value = (source + up) & 0xff;
          break;
        case 3:
          value = (source + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4:
          value = (source + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`像素 readback 失败：不支持 PNG filter type ${filter}。`);
      }
      decoded[targetStart + column] = value;
    }
  }
  if (colorType === 6) {
    return { width, height, pixels: decoded };
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const rgbOffset = index * 3;
    const rgbaOffset = index * 4;
    pixels[rgbaOffset] = decoded[rgbOffset];
    pixels[rgbaOffset + 1] = decoded[rgbOffset + 1];
    pixels[rgbaOffset + 2] = decoded[rgbOffset + 2];
    pixels[rgbaOffset + 3] = 0xff;
  }
  return { width, height, pixels };
}

/**
 * 统计目标色附近最大的 8 邻接像素簇。阈值容纳 canvas 抗锯齿与 screenshot 色彩舍入，
 * 同时要求存在连续的非背景信号，而不是单个偶然色点。
 */
export function largestNearbyColorCluster(
  image: RgbaPng,
  target: RgbColor,
  channelTolerance = 48,
  minimumAlpha = 1
): number {
  const pixelCount = image.width * image.height;
  const matching = new Uint8Array(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (
      image.pixels[offset + 3] >= minimumAlpha &&
      Math.abs(image.pixels[offset] - target.red) <= channelTolerance &&
      Math.abs(image.pixels[offset + 1] - target.green) <= channelTolerance &&
      Math.abs(image.pixels[offset + 2] - target.blue) <= channelTolerance
    ) {
      matching[index] = 1;
    }
  }

  const visited = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let largestCluster = 0;
  for (let start = 0; start < pixelCount; start += 1) {
    if (matching[start] === 0 || visited[start] === 1) {
      continue;
    }
    let size = 0;
    let read = 0;
    let write = 0;
    queue[write] = start;
    write += 1;
    visited[start] = 1;
    while (read < write) {
      const current = queue[read];
      read += 1;
      size += 1;
      const row = Math.floor(current / image.width);
      const column = current % image.width;
      for (let rowDelta = -1; rowDelta <= 1; rowDelta += 1) {
        for (let columnDelta = -1; columnDelta <= 1; columnDelta += 1) {
          if (rowDelta === 0 && columnDelta === 0) {
            continue;
          }
          const nextRow = row + rowDelta;
          const nextColumn = column + columnDelta;
          if (
            nextRow < 0 ||
            nextRow >= image.height ||
            nextColumn < 0 ||
            nextColumn >= image.width
          ) {
            continue;
          }
          const next = nextRow * image.width + nextColumn;
          if (matching[next] === 1 && visited[next] === 0) {
            visited[next] = 1;
            queue[write] = next;
            write += 1;
          }
        }
      }
    }
    largestCluster = Math.max(largestCluster, size);
  }
  return largestCluster;
}

/**
 * 统计「暗」像素数：三通道均不超过 maxChannel 且足够不透明。
 * 用于在 100k 深色背景上识别新提交的深色笔迹（默认提交色 `#202124`、workload `#172033`
 * 都落在该范围内；蓝色 `#2563EB` 因 blue 通道远超阈值而被排除）。
 */
export function countDarkPixels(image: RgbaPng, maxChannel = 96, minimumAlpha = 192): number {
  const pixelCount = image.width * image.height;
  let count = 0;
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    if (
      image.pixels[offset + 3] >= minimumAlpha &&
      image.pixels[offset] <= maxChannel &&
      image.pixels[offset + 1] <= maxChannel &&
      image.pixels[offset + 2] <= maxChannel
    ) {
      count += 1;
    }
  }
  return count;
}

/** 读取 locator 截图并归一化为 RGBA + CSS 倍率；不可用 box 时显式失败。 */
export async function readElementScreenshot(locator: Locator): Promise<ElementScreenshotReadback> {
  let screenshot: Uint8Array;
  try {
    screenshot = await locator.screenshot({ animations: 'disabled' });
  } catch (error) {
    throw new Error(
      `元素 screenshot readback 失败：${error instanceof Error ? error.message : String(error)}`
    );
  }
  const image = await decodeRgbaPng(screenshot);
  const box = await locator.boundingBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    throw new Error('元素 screenshot readback 失败：元素 CSS box 不可用。');
  }
  return {
    ...image,
    cssWidth: box.width,
    cssHeight: box.height,
    cssX: box.x,
    cssY: box.y,
    pixelsPerCssX: image.width / box.width,
    pixelsPerCssY: image.height / box.height,
  };
}

/**
 * 依元素 CSS box 将截图裁为局部 PNG（region 坐标相对元素原点）。
 * 用于把像素断言限制在手势邻域，避免 DOM 浮层或画布其它场景混入。
 */
export function readElementCssRegion(
  screenshot: ElementScreenshotReadback,
  region: CssRegion,
  label: string
): RgbaPng {
  if (
    !Number.isFinite(region.x) ||
    !Number.isFinite(region.y) ||
    region.width <= 0 ||
    region.height <= 0
  ) {
    throw new Error(`局部 readback 失败：${label} 的 CSS 区域无效。`);
  }
  const left = Math.floor(region.x * screenshot.pixelsPerCssX);
  const top = Math.floor(region.y * screenshot.pixelsPerCssY);
  const right = Math.ceil((region.x + region.width) * screenshot.pixelsPerCssX);
  const bottom = Math.ceil((region.y + region.height) * screenshot.pixelsPerCssY);
  if (
    left < 0 ||
    top < 0 ||
    right > screenshot.width ||
    bottom > screenshot.height ||
    right <= left ||
    bottom <= top
  ) {
    throw new Error(
      `局部 readback 失败：${label} 的 CSS 区域 (${region.x}, ${region.y}, ${region.width}, ${region.height}) 超出元素 ${screenshot.cssWidth.toFixed(1)}×${screenshot.cssHeight.toFixed(1)}。`
    );
  }

  const width = right - left;
  const height = bottom - top;
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const sourceStart = ((top + row) * screenshot.width + left) * 4;
    pixels.set(screenshot.pixels.subarray(sourceStart, sourceStart + width * 4), row * width * 4);
  }
  return { width, height, pixels };
}
