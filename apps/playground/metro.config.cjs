/**
 * Metro 配置。
 *
 * 直接使用 Expo 官方 `expo/metro-config`，不再使用老式的 monorepo alias/hack；
 * Expo SDK 53+ 的 Metro 已能自动识别 pnpm/monorepo 结构。
 *
 * 额外把 `wasm` 加入 assetExts，以便 Web 端把 CanvasKit 的 `.wasm`
 * 作为静态资源引用（配合 `setup-skia-web` 生成的本地 CanvasKit 资源）。
 */
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// CanvasKit WASM 作为静态资源处理
config.resolver.assetExts.push('wasm');

module.exports = config;
