/**
 * Babel 配置：应用本地直接使用 Expo 官方 preset。
 *
 * babel-preset-expo 会在检测到 react-native-reanimated / react-native-worklets
 * 时自动注入对应的 worklet 插件，无需在此手动添加。
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
