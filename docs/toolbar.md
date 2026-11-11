# 共享栏接入（0.8.4）

`@hamster-note/painting/toolbar` 提供 DOM / Expo DOM / WebView 使用的轻量入口，只依赖 React 和 React DOM，不加载绘图 controller、输入引擎、解析器或 React Native。它不是原生 RN 视图。reader/notes 应消费此公开子路径，业务 controller、保存和历史仍使用各库原实现。

```tsx
import {
  ToolbarShell,
  ToolbarFileMenu,
  type PaneToolbarLayout,
  type ToolbarFileNavigationProps,
} from '@hamster-note/painting/toolbar';

function ContentToolbar(props: ToolbarFileNavigationProps & { layout: PaneToolbarLayout }) {
  return (
    <ToolbarShell placement="floating" layout={props.layout} label="阅读工具">
      <button type="button" onClick={openExistingOutline}>
        目录
      </button>
      <ToolbarFileMenu {...props} />
      {/* 原有工具/保存状态；notes 先渲染撤销、重做，再渲染文件入口 */}
    </ToolbarShell>
  );
}
```

将所在内容栏设置为 `position: relative`，并添加 `data-pane-toolbar-boundary`。弹层在可见 viewport 与该栏边界的交集中定位；也可用 `layout.bounds` 提供 viewport 坐标的 `{left, top, width, height}`。浮动栏锚定最近的定位父元素，bounds 只收紧弹层边界，不替代父元素的布局。不要在宿主对该祖先使用使 fixed 弹层改变坐标系的 CSS transform。

`ToolbarShell` 复用 60px 胶囊、44px 控件、横向滚动、聚焦可见处理及样式。`auxiliary` 可放独立收起按钮，`collapsed` 隐藏胶囊，`overlay` 可放自定义弹层。`toolbarProps` 用于工具组样式及属性。`ToolbarPopover` 是同一键盘/定位底座，支持 `menu`、`anchor`、`boundary`、`layout`、`onClose(restoreFocus)`。

有兄弟工具弹层时，通过 `ToolbarFileMenu.onOpen` 在打开文件列表前关闭它们。反向打开工具弹层时，文件菜单现有的外部指针/焦点规则负责关闭文件列表；不要将文件菜单的 boundary 扩大到整个工具栏。文件行使用 `height:auto; min-height:44px`，长名称和存储路径换行后仍位于自身点击区域内。

## 文件契约

`ToolbarFileNavigationProps` 在 `ToolbarFileMenu`、painting 的 `Toolbar` 和 `LayeredPaintingBoard`（含 painting-board 的 `PaintingBoard` 别名）使用相同名称，可直接传递：

| 字段               | 语义                                                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files?`           | 有序只读 `{key, storageId, path, displayName, resolvedFormat}[]`；未提供隐藏入口，空数组显示空态。key 必须使用宿主的规范存储身份，不使用显示名。路径和存储在菜单中区分同名文件。 |
| `currentFileKey?`  | 当前项的受控 key；只由宿主快照更新，成功回执也不会让菜单自行改变当前项。                                                                                                         |
| `paneId?`          | 发起栏身份；未提供时按钮禁用，菜单打开时固定该身份。                                                                                                                             |
| `busy?`            | 宿主保存/切换单飞中禁用文件结构操作。菜单自身也阻止重复在途请求。                                                                                                                |
| `onSelectFile?`    | `(request) => Promise<ToolbarRequestResult>`；缺省不能选择非当前项。选择当前项无操作。                                                                                           |
| `onRequestRemove?` | 同上；缺省隐藏移除按钮，最后一项始终不可移除。宿主负责确认和保存屏障，移除只从会话列表移除，不在库中删磁盘文件。                                                                 |

请求为 `{fileKey, paneId, requestId}`，每次请求的 requestId 不同。回执为 `{status:'success'}`、`{status:'cancelled'}` 或 `{status:'failed', message:string}`。成功关闭菜单；取消保持菜单和当前项；失败（含拒绝 Promise）展示错误并允许重试。宿主必须在提交成功状态时同步提供新列表及当前 key。宿主负责授权、保存、导航、目标格式能力判断和迟到消息处理；菜单不读文件字节、不猜扩展名、不建立 session/历史。

菜单支持 Enter/Space/方向键打开、上下/Home/End 导航、Escape 关闭并还原焦点、Tab 正常离开。文件按钮位于 painting 重做之后，且在320px栏内可滚动到达。列表及弹层保持所属栏，聚焦别栏不会把已发请求改派到别栏。

## 布局与内容占位

```ts
const layout: PaneToolbarLayout = {
  edge: 'top',
  insets: { top: 24, bottom: 0, left: 0, right: 0 },
  headerContentInset: 44,
  // bounds 可选，单位 CSS px，viewport 坐标
};
```

宿主解析分屏方向，再传每栏布局：单栏/左右两栏为 bottom，上下上栏为 top、下栏为 bottom。库不计算方向或读取 WebBase 状态。

所有输入为宿主计算的非负有限像素值。`headerContentInset` 表示从栏原点量起的**有效标题遮挡终点**，不是再追加的标题高度；与 safe top 重叠，取 `max(top, headerContentInset)`，不会盲目相加。若宿主的标题高度本来不含状态栏，须由宿主先转为有效遮挡终点。浮动间距16px另加有效 inset：例 top=24/header=44 得 top=60px；bottom=34 得 bottom=50px；显式0得16px，绝不回退整屏 env。

未提供 layout 时保留旧底部 `16px + env(safe-area-inset-bottom)`，不改变旧宿主画布占位。受控布局由 `ToolbarShell.onOccupiedSpaceChange({top,bottom})` 报告实际占位，消费者在正文相应侧预留该空间；回调已含16px间距、有效 inset、胶囊及辅助控件，不要再叠加安全区。painting board 已自行预留，页面绘制 surface 也限制在剩余空间内；只变 layout 不更改 controller 或 surface 的 key。

顶部弹层优先向下、底部优先向上；空间不足时选择可见空间更大的一侧并内部滚动。原始 `Toolbar` 独立入口不拥有正文布局，使用它的宿主也应接入占位回调。

## 构建、验证与回滚

- painting 与 painting-board 同步版本为0.8.4，后者依赖 painting 0.8.4；reader/notes 需显式升级至含 `/toolbar` 的版本，再接入。当前 PR 不执行 npm 发布。
- `pnpm build:lib` 生成 ESM、CommonJS 和类型声明；`pnpm pack:dry` 检查发布清单，`pnpm --filter @hamster-note/painting pack --pack-destination <目录>` 可生成可安装归档。
- `pnpm test:toolbar` 用 esbuild 打包**公开编译入口**，静态检查轻量包依赖图，再运行 Chromium 夹具；reader/notes 为消费契约适配器，不冒充两个仓库已接入。其真实编辑器与 WebBase 联调属后续交付。
- 开发时验收为 Web-only。回滚只恢复消费端依赖及可选 props，文件数据、controller、历史和会话无需迁移。旧 painting-board 默认行为另有浏览器夹具覆盖。
