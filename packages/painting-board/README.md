# @hamster-note/painting-board

`PaintingBoard` 是基于 [`@hamster-note/painting`](https://www.npmjs.com/package/@hamster-note/painting) 的 `DrawingSurface` 封装的开箱即用画板组件：

- **自带画布漫游**：默认开启 `@hamster-note/virtual-paper`，支持触控板滚动平移、Ctrl/⌘+滚轮缩放、双指平移/缩放；
- **撑满父组件**：内部 wrapper 为 `flex: 1 + 100% x 100%`，画板自动填满父容器；
- **完全透传**：所有 `DrawingSurface` 的 props 与 ref handle 原样可用。

## 安装

```bash
yarn add @hamster-note/painting-board
# peer: react >= 18, react-native >= 0.74 (Web 环境使用 react-native-web)
```

## 使用

```tsx
import { View } from 'react-native';
import { PaintingBoard } from '@hamster-note/painting-board';

export function Board() {
  return (
    // 父组件必须有确定尺寸或 flex 布局
    <View style={{ flex: 1 }}>
      <PaintingBoard />
    </View>
  );
}
```

Web（react-native-web）下请确保根节点有高度：

```css
html,
body,
#root {
  height: 100%;
  margin: 0;
}
```

## 默认的画布漫游交互

| 交互                 | 说明                   |
| -------------------- | ---------------------- |
| `trackpadScrollPan`  | 触控板双指滚动平移画布 |
| `mouseWheelCtrlZoom` | Ctrl/⌘ + 滚轮缩放      |
| `touchTwoFingerPan`  | 触屏双指平移           |
| `touchTwoFingerZoom` | 触屏双指捏合缩放       |

刻意**不**启用 `mouseDragPan` 与 `touchSingleFingerPan`：鼠标左键拖拽与单指触摸仍然用于画画。

缩放范围默认 `minScale: 0.25` ~ `maxScale: 8`。

## 关闭或自定义 virtual-paper

```tsx
// 完全关闭（行为等同裸 DrawingSurface 默认状态）
<PaintingBoard virtualPaper={false} />

// 在默认配置基础上浅合并覆盖
<PaintingBoard virtualPaper={{ minScale: 0.5, maxScale: 4 }} />

// 临时关闭
<PaintingBoard virtualPaper={{ enabled: false }} />
```

## ref handle

`ref` 透传 `DrawingSurfaceHandle`：

```tsx
const ref = useRef<PaintingBoardHandle>(null);
ref.current?.getHostSize();
ref.current?.clearSelection();
```

## 版本策略

本包与 `@hamster-note/painting` 采用 **lockstep 版本**：两者版本号始终一致，推送同一个 `vX.Y.Z` tag 时由 CI 一起发布。
