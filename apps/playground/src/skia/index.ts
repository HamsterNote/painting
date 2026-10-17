/**
 * skia/ 目录的出口：阶段 1 只暴露唯一的冒烟画布。
 * app 路由/入口由编排方在阶段 1.2-1.3 接入，本目录不越权修改。
 */
export { SkiaSmokeSurface, SKIA_SMOKE_TEST_IDS } from './SkiaSmokeSurface';
