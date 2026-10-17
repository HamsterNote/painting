# 任务 2.1 CanvasKit 本地静态资源证据报告

- 变更：`migrate-expo57-skia-surface`
- 任务：2.1「spike 并确定 CanvasKit 本地静态资源发布与加载方案，产出不含外部 CDN 请求的最小可加载工件」
- 验证所有者：父 orchestrator
- 生成时间：2026-09-23
- 写入范围：仅本报告文件（`verification/`）。未修改任何产品源码、依赖、lockfile、路由、配置、tasks、design、deepwork。临时脚本仅位于 `/tmp/opencode`（不进入仓库）。
- spike 结论（一句话）：现有实现已达到「本地静态资源加载 + 无外部 CDN 运行时依赖」的加载方案，无需重构即可满足 2.1 的验证方式。

## 结论速览

| 验证项 | 结论 | 关键依据 |
| --- | --- | --- |
| `apps/playground/public/canvaskit.wasm` 存在 | ✅ | 8,076,553 字节，sha256 `eb68c7a7…f9dc4` |
| `SkiaSmokeRoute.web.tsx` 的 `locateFile` 指向本地 | ✅ | 源码 `locateFile: (file) => \`/${file}\``；产物 bundle 亦含同名逻辑 |
| `expo export --platform web` 产物含 `dist/canvaskit.wasm` | ✅ | 存在且与 `public/` 源文件 sha256 完全一致 |
| 浏览器 `/skia-smoke` 实际加载 CanvasKit | ✅ | 同源 `http://127.0.0.1:5266/canvaskit.wasm`，HTTP 200，`content-type: application/wasm` |
| 强约束阻断非本机 5266 请求后 smoke surface 仍出现 | ✅ | surface 出现，且正向对照外部 CDN 请求被 `ERR_BLOCKED_BY_CLIENT.Inspector` 拦截 |
| 产品自身 console error | ✅ 无 | 探针前 `consoleErrorsBeforeProbe = []`，`pageErrorsBeforeProbe = []` |
| dist 中 `cdn.jsdelivr` / `unpkg.com` / `skia.org` 文本引用 | ✅ 无匹配 | 三个关键词均无匹配（检索局限见下） |

**总体判定：2.1 通过。** 现有实现已同时满足「工件可在 Web 本地加载」与「网络面板观察不到外部 CDN 请求」。

## 环境与命令

- 工作目录：`/home/zhangxiao/frontend/HamsterNote/painting.feat-use-perfect-freehand`
- Node `v24.15.0`，pnpm `10.28.2`
- 浏览器自动化：Playwright `@playwright/test@1.59.1`（仓库根 `node_modules`），Chromium `chromium-1217`
- webapp-testing 约束脚本：`/home/zhangxiao/.config/opencode/skills/webapp-testing/scripts/with_server.py`

### 命令清单

1. 确认 webapp-testing 脚本用法：

   ```bash
   python3 /home/zhangxiao/.config/opencode/skills/webapp-testing/scripts/with_server.py --help
   ```

   （注：环境中无 `python`，仅有 `python3`，故使用 `python3`。）

2. 静态导出并核验产物：

   ```bash
   pnpm --filter @hamster-note/painting-playground exec expo export --platform web
   sha256sum apps/playground/public/canvaskit.wasm apps/playground/dist/canvaskit.wasm
   ```

3. 关键词检索 dist：

   ```bash
   cd apps/playground/dist
   grep -rIl "cdn.jsdelivr" . ; grep -rIl "unpkg.com" . ; grep -rIl "skia.org" .
   # 额外：全量外部 http(s) host 统计
   grep -rhoaE 'https?://[A-Za-z0-9._:-]+' . | sort | uniq -c | sort -rn
   ```

4. 受管服务器 + 浏览器证据（临时脚本 `/tmp/opencode/skia-canvaskit-proof.cjs`）：

   ```bash
   python3 /home/zhangxiao/.config/opencode/skills/webapp-testing/scripts/with_server.py \
     --server "cd apps/playground && exec node node_modules/expo/bin/cli start --web --lan --port 5266 > /tmp/opencode/devserver-2.1.log 2>&1" \
     --port 5266 --timeout 180 \
     -- node /tmp/opencode/skia-canvaskit-proof.cjs
   ```

   说明：`dev:web` 的实际命令为 `expo start --web --lan --port 5266`。为让 `with_server.py` 的 `terminate()` 能真正回收进程（避免 pnpm→expo 孙进程被孤儿化占住端口），受管命令写成等价形式
   `cd apps/playground && exec node node_modules/expo/bin/cli start --web --lan --port 5266`；`exec` 使监听进程即被终止的目标，运行结束后确认端口 5266 已释放。

   > 环境卫生说明：运行前发现端口 5266 已被一个**游离的**（无 TTY、`？`、10:41 启动）本项目 `expo start` 进程占用（PID 2420634/2420635）。为让 `with_server.py` 真正管理一个干净服务器，先终止了该残留进程；本次运行结束后端口已确认释放，无残留 expo 进程。

## 资产来源 / 大小 / 路径

| 项 | 值 |
| --- | --- |
| 源静态资源 | `apps/playground/public/canvaskit.wasm` |
| 源大小 | `8,076,553` 字节（约 7.70 MiB） |
| 源 sha256 | `eb68c7a7f602d8cb89915352c4471a2d26edfd72000f78202cb1fe32ce1f9dc4` |
| 导出副本 | `apps/playground/dist/canvaskit.wasm` |
| 副本大小 | `8,076,553` 字节 |
| 副本 sha256 | `eb68c7a7f602d8cb89915352c4471a2d26edfd72000f78202cb1fe32ce1f9dc4` |
| 一致性 | ✅ 与源文件逐字节一致（sha256 相同） |
| Metro 支持 | `apps/playground/metro.config.cjs` 将 `wasm` 加入 `resolver.assetExts`，Expo 将 `public/` 下资源复制到导出根 |
| 运行时定位 | `src/skia/SkiaSmokeRoute.web.tsx`：`LoadSkiaWeb({ locateFile: (file) => \`/${file}\` })` → 站点根 `/canvaskit.wasm` |

产物 bundle 证据（`_expo/static/js/web/entry-*.js`）：

- `locateFile:e=>\`/${e}\``（应用侧 `LoadSkiaWeb` 调用）
- `... I??=o.locateFile?o.locateFile("canvaskit.wasm",y):y+"canvaskit.wasm" ...`（Skia/CanvasKit 内部回退实现）

即：当应用提供 `locateFile` 时，CanvasKit 文件名 `canvaskit.wasm` 会被解析为本机根路径，未命中任何远程默认地址。

## 浏览器证据（Playwright，强网络约束）

访问 `http://127.0.0.1:5266/skia-smoke`，`waitUntil: networkidle`，并在 `page.route('**/*')` 中拦截所有 http(s) 请求：仅放行 host ∈ {`127.0.0.1`, `localhost`} 且 port = `5266` 的请求，其余 `route.abort('blockedbyclient')`。

### 结果

- **smoke surface 出现**：`waitForSelector('[data-testid="skia-smoke-surface"]')` 成功，`surfaceFound: true`，`error: null`。
- **可见文案辅助证据**：坐标 `坐标：尚未绘制`，状态 `空闲`（初始态）。
- **CanvasKit 实际同源 URL**：
  - 请求：`http://127.0.0.1:5266/canvaskit.wasm`，`resourceType: fetch`，`method: GET`
  - 响应：`status: 200`，`content-type: application/wasm`
  - 传输量（Resource Timing）：`encodedBodySize: 8076553`、`decodedBodySize: 8076553`、`transferSize: 8076853` —— 与服务端文件大小完全一致（`transferSize` 多出 300 字节为响应头）。
- **无其他外部资源请求**：全部 HTTP 请求仅 4 条本机请求（document、entry bundle、`/canvaskit.wasm`、`SkiaSmokeSurface` 懒加载 bundle），无任何外部域名。
- **console error（产品自身）**：探针前 `consoleErrorsBeforeProbe = []`、`pageErrorsBeforeProbe = []`，即产品加载与渲染过程 **0 console error、0 page error**。
- **正向对照（证明封锁有效而非空转）**：脚本主动 `fetch('https://cdn.jsdelivr.net/.../canvaskit.wasm')`，结果为：
  - 被拦截：`blockedExternalRequests` 含该 URL；
  - 请求失败：`net::ERR_BLOCKED_BY_CLIENT.Inspector`；
  - 页内 `fetch` 抛 `TypeError: Failed to fetch`；
  - Resource Timing `transferSize: 0`（未落地任何字节）。
  - 该探针在产品断言之后执行，其产生的 1 条 `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT.Inspector` console error 属**测试自造**，不计入产品错误。

### dist 关键词检索

在 `apps/playground/dist` 全目录（含 JS bundle、HTML、CSS、WASM 二进制）检索：

| 关键词 | 结果 |
| --- | --- |
| `cdn.jsdelivr` | 无匹配（exit 1） |
| `unpkg.com` | 无匹配（exit 1） |
| `skia.org` | 无匹配（exit 1） |
| `jsdelivr`（更宽泛） | 无匹配（exit 1） |

额外对 dist 全量外部 `http(s)` host 做统计，命中项均为**打包依赖内的文档/注释型 URL**（如 `www.w3.org`、`reactnavigation.org`、`github.com`、`docs.expo.dev`、`shopify.github.io` 等），未发现任何用于**运行时拉取 CanvasKit 资源**的 CDN 地址。

## 局限（必须随证据一并理解）

1. **非真实断网**：网络约束由 Playwright `page.route` 在浏览器进程内拦截实现，并非操作系统级断网。它能证明「页面未发起/未成功完成对外部 CDN 的加载」，但不等价于物理隔离网络环境。
2. **非生产 CDN/MIME 测试**：本次只验证了**本地 Expo 开发服务器**（`:5266`）提供的 `application/wasm` MIME 与 200 响应。未在生产 CDN、缓存层或不同 MIME 配置下验证；也未覆盖跨域（CORS）、压缩/缓存头等生产因素。
3. **native 无法由 Web 推断**：本报告只证明 Web 端 CanvasKit 本地加载。iOS/Android 端 CanvasKit/原生 Skia 的加载路径与运行时证据无法由 Web 结果推断（对应阶段 1 的 1.4 外部证据债务），不构成本任务 2.1 的 Web 结论延伸。
4. **grep 检索的天然局限**：`grep` 只能发现**静态文本**形式的引用。运行时拼接的 URL、压缩/编码后字符串、base64 或其他间接构造不会被可靠检出。故「空匹配」本身不能单独作为「运行时无外部请求」的证明——真正的运行时证明是上面的 Playwright 强约束网络记录；grep 仅作辅助佐证。
5. **控制台仅覆盖页面可见范围**：Playwright 采集的是页面 console/pageerror；DevTools 扩展安装失败（日志中 `React Native DevTools ... SUID sandbox`）等与页面无关的环境告警不属于产品运行错误，已排除。
6. **`with_server.py` 清理行为**：该脚本 `terminate()` 只作用于直接子进程；若服务器命令经 shell 包装且未 `exec`，会遗留孙进程。本任务通过 `exec` 形式规避，并额外核实运行后端口已释放、无残留进程。
7. **未做性能/超时压测**：仅验证一次正常加载（本机环境传输约 8 MB），未在弱网、慢磁盘或大并发下评估加载时间与失败重试路径的时延表现。

## 失败细节

无验证步骤失败。所有断言（surface 出现、WASM 200 同源、无产品 console error、dist 含本地 wasm、关键词无匹配、正向对照被拦截）均通过。

## 结论

- 现有实现（`public/canvaskit.wasm` + `SkiaSmokeRoute.web.tsx` 的 `locateFile: file => \`/${file}\``）已构成满足任务 2.1 的**最小可加载工件**：`expo export --platform web` 会把本地 `canvaskit.wasm` 原样复制到 `dist/`，浏览器从同源 `/canvaskit.wasm` 成功加载（200、`application/wasm`、字节数一致），且在**阻断所有非本机 5266 的 http(s) 请求**的强约束下 smoke surface 依然出现、产品零 console error。
- dist 中不存在 `cdn.jsdelivr` / `unpkg.com` / `skia.org` 文本引用；全量外链统计仅见依赖内置文档 URL，无运行时 CanvasKit CDN 地址。
- 因此 2.1 的验证方式（「工件可在 Web 本地加载且网络面板观察不到外部 CDN 请求」）**通过**，无需为通过验证而修改任何产品代码。
- 上述局限（非真实断网、非生产 CDN/MIME、native 不可由 Web 推断、grep 局限）应在门禁结论中作为证据边界保留。
- 写入合规：仅新增本报告；未修改任何产品源码、依赖、lockfile、路由、配置、tasks、design 或 deepwork；临时脚本仅在 `/tmp/opencode`。
