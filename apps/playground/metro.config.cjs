/**
 * Metro 配置。
 *
 * 直接使用 Expo 官方 `expo/metro-config`，不再使用老式的 monorepo alias/hack；
 * Expo SDK 53+ 的 Metro 已能自动识别 pnpm/monorepo 结构。
 *
 */
const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

module.exports = config;
