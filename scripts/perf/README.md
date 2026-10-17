# 性能实验辅助函数

旧 editor-candidate/CanvasKit 浏览器 runner 已退役，不再有默认产品性能门禁。这里保留独立的 JSON 验证、冻结报告防篡改、源码身份与静态服务器工具及其原测试；它们没有绘制依赖，也不参与分层编辑器运行时或 npm 包。

`node --test scripts/perf/*.test.mjs` 验证这些纯工具。历史 oracle/baseline 的固定阈值与测试数据只表示旧报告格式，不能作为 perfect-freehand、Canvas replay 或当前设备预算的通过依据。源码身份必需文件已改为当前分层 Canvas 浏览器回归。

`spikes/coordinate-performance` 与 `spikes/product-performance` 的独立数学实验继续保留，输出改到被 Git 忽略的 `artifacts/research/`，不会重建已退役的旧 change。目标设备性能方法与待测字段见 `docs/implementation/layered-perfect-freehand-surface/manual-acceptance.md`。
