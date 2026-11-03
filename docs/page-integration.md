# 页面绘图与旧数据升级（0.8.0）

正式依赖：`@hamster-note/painting@0.8.0`。`painting-board@0.8.0` 同步重导出页面 API。旧 0.7 controller/board/read API 保持不变。

## 一次性迁移

```ts
import { migrateLegacyDocument, serializeLayeredDocument } from '@hamster-note/painting';

const result = migrateLegacyDocument(oldPageDrawingValue);
if (!result.ok) throw new Error(`不能迁移：${result.error.path}`);
const saved = serializeLayeredDocument(result.value);
if (!saved.ok) throw new Error(saved.error.path);
await saveNewPageKey(saved.value); // 按宿主既有持久化/ack 合约提交
```

输入是已解析的 DrawingValue（无 schemaVersion 或 1/2）或 EditorDocument（3），不是整个 reader v4 envelope。reader 只负责选取 page-N 的输入、调用此函数并保存返回值，不编写对象映射。不存在空页键时可调用 `{ strokes: [] }`，不要把坏数据当空页。

API 返回 `DocumentReadResult<EditorDocument>`，失败含原始路径；整次失败不返回部分文档。不得在失败时写空值覆盖存档。只在新键缺失时调用迁移，写新键成功后优先读取新键。库不做 IO，也不读取/改写/删除原 v4 blob；宿主保留原始字节。不双写、不投影。旧 App 只看到升级前的笔迹。

输出深拷贝并冻结、ID 和样本时间确定，不用时钟/随机数；同一旧值重复迁移的结果相等，迁移输出再次输入也相等。支持 pen、line、rect、ellipse、polygon、bezier、text、image，以及 reader 历史 `color/width` 字段、旋转、图片 resourceId/拉伸方式、文字行高、形状填充透明度和虚线相位。没有保存的颜色/宽度分别补黑色/2 DIP，文字缺省字号 24；迁移不会拿当前工具栏颜色覆盖历史颜色。

普通旧 pen 保留原始坐标和压力，转换成新的 freehand；无压力用 constant，有压力用 real。单点会补一个同位置终止样本；旧数据无时间，以点序号作为确定性时间。新笔形使用 perfect-freehand，与退役 SVG 算法的轮廓可能不同。虚线 pen 和多点直尺 line 转为普通 shape 分段（稳定且避碰的子 ID）；它们可逐段选择/擦除，虚线相位在库内延续。此后渲染仅依赖 schema 3，不保留旧渲染器。未知版本/工具、重复 ID、非有限坐标、非法样式或退化多边形等返回失败，源数据仍完整保留。

## PDF 页坐标

每页独立 `createEditor(document)`，保留该 controller 直到页面/文件会话结束。固定页面坐标为首次保存时的 scale-one viewport DIP，不随缩放改变；不能混用 PDF 底部向上坐标、当前屏幕像素和 scale-one viewport 坐标。

```tsx
import { createPageGeometry, PageDrawingSurface } from '@hamster-note/painting';

const geometry = createPageGeometry({
  width: referenceViewport.width,
  height: referenceViewport.height,
  referenceTransform: referenceViewport.transform, // pdf.js 六元组
  viewportTransform: currentViewport.transform,
});
if (!geometry) throw new Error('Invalid PDF page geometry');

return (
  <PageDrawingSurface pageId={`page-${pageNumber}`} controller={controller} geometry={geometry} />
);
```

`referenceViewport` 是保存坐标使用的基准，不随用户旋转而重建；`currentViewport` 包含当前缩放/旋转/crop translation。若已有矩阵，也可直接传 `PageGeometry {width,height,pageToSurface}`。`createPageCoordinateSpace(geometry)` 返回不可变正逆矩阵和 `toSurface` / `toPage`；非法输入返回 null，不偷偷 clamp 或回退。

把表面放在 **PDF 页内容区域** 的 overlay 中，其父元素有明确的宽高（绝对定位 overlay 可用 `inset:0`），排除页面 border/padding；不要再次缩放绘图层或文档 points。库内每批读当前容器 rect 以适应滚动；支持祖先轴对齐 CSS 缩放，祖先旋转/倾斜应合入 pageToSurface，不能再给祖先另设旋转。

页面表面透明，活动 Canvas、SVG 历史、选择与文字层共享 CSS 矩阵，输入共用其逆矩阵。页面/输入参数单位均为 CSS px/DIP，DPR 只用于 Canvas backing store，绝不进入文档点。`enabled=false`、pageId 或几何变化会取消未完成笔迹，迟到 up 不提交；已完成文档保持。库内 viewport 保持 identity，禁用内部 pan/zoom/virtual paper，页面滚动和缩放由宿主 viewer 管理。不要同时把同一 controller 挂载到通用画板并独立导航。

## 工具栏颜色和存储

reader 将当前工具栏值传给 `controller.setFreehandSettings({...brush, color})` / `setShapeSettings({...style, color})`，然后 `setTool(...)`。一笔使用 down 时快照，中途换颜色仅作用于下一笔。

通过 `controller.subscribe('document', listener)` 取得文档变化；用 `getSnapshot('document')` 和 `serializeLayeredDocument` 保存新格式。文档快照是编辑器内存状态，不等同磁盘确认；宿主保留自己的 dirty/持久化队列与 ack，保存失败不得谎报成功。监听工具/viewport 不触发无意义存档。

## 可运行示例与验证

playground `/?fixture=pages` 展示透明页、宿主缩放/旋转/滚动、两页 controller；浏览器回归测试检查活动 Canvas 真实像素与持久化页面样本。fixture 为模拟 PDF 几何，实际 pdf.js 接线与宿主落盘由 reader change 验收；合成输入不证明真笔/掌触体验。
