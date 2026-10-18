import NativeAdapterSmokeSurface from './NativeAdapterSmokeSurface';

/**
 * native（iOS / Android）`/native-adapter-smoke` 路由实现（基名模块）。
 *
 * 使用不带平台后缀的基名，让 tsc 直接解析；Metro 在 web 端会优先选择
 * 同目录下的 `NativeAdapterSmokeRoute.web.tsx`（只读说明页，不导入
 * RNGH native adapter 或 CanvasKit）。
 */
export default function NativeAdapterSmokeRoute() {
  return <NativeAdapterSmokeSurface />;
}
