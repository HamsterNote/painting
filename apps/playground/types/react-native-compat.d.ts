/**
 * react-native 0.86 的 `StyleSheet` 类型移除了 `absoluteFillObject`
 * （仅保留 `absoluteFill`），但 Web 端 react-native-web 仍提供该属性。
 *
 * 冒烟画布 `src/skia/SkiaSmokeSurface.tsx`（designer 所有）使用了
 * `StyleSheet.absoluteFillObject`，为在不修改该文件的前提下保持三端类型与
 * 行为一致，这里做最小的类型补齐；运行时的等价补齐见 `app/_layout.tsx`。
 */
import 'react-native';

declare module 'react-native' {
  export namespace StyleSheet {
    const absoluteFillObject: {
      position: 'absolute';
      left: 0;
      right: 0;
      top: 0;
      bottom: 0;
    };
  }
}
