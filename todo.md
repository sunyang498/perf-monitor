# perf-monitor 开发任务看板

> 从零实现的前端性能监控 SDK，采集 Web 核心指标与运行时错误，支持批量上报、双通道发送、页面卸载兜底与离线补发。

---

## ✅ 已完成的模块

### 1. 工程化环境搭建
**文件：** `tsconfig.json` / `rollup.config.js` / `package.json`

| 维度 | 内容 |
|---|---|
| **为何做** | SDK 需要打包为单个 JS 文件供 `<script>` 标签引入。TS 提供类型安全，Rollup 输出干净的无冗余代码。 |
| **如何做** | TS 配置 `target: ES2017`（原生 async/await）、`module: ESNext`（模块交给 Rollup）；Rollup 输出 IIFE 格式，`name: 'PerfMonitor'` 挂载全局变量；`@rollup/plugin-typescript` + `@rollup/plugin-terser` 编译压缩。 |
| **效果** | `npm run build` → `dist/perf-monitor.js`，零 warning 构建，用户 `<script>` 引入即可通过 `window.PerfMonitor.init()` 使用。 |

### 2. 类型体系定义
**文件：** `src/types/index.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | 作为"契约层"统一所有模块的数据结构，避免字段名拼错、类型不匹配。 |
| **如何做** | 定义 `PerfMonitorConfig`（配置）、`MetricData`（指标数据，含 type/value/pageUrl/timestamp）、`ErrorData`（错误数据，含 type/message/filename/lineno/colno/stack）、`TransportItem`（联合类型，队列中统一存放）。 |
| **效果** | 所有模块 import 同一套类型，编译期即可发现字段遗漏和类型错误。 |

### 3. 入口与初始化 `init()`
**文件：** `src/index.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | SDK 需要一个唯一入口点来校验配置、合并默认值、启动所有子模块。 |
| **如何做** | `init(config)` 校验 `url` 必填 → 合并默认值（`??` 操作符）→ 防重复初始化 → 依次调用 6 个子模块。IIFE 打包后挂载 `window.PerfMonitor`。 |
| **效果** | `PerfMonitor.init({ url: '/report' })` 一行启动全部监控。 |

### 4. LCP（最大内容绘制）采集
**文件：** `src/core/metrics.ts` → `observeLCP()`

| 维度 | 内容 |
|---|---|
| **为何做** | LCP 是 Core Web Vitals 三大指标之一，衡量页面主要内容何时对用户可见。 |
| **如何做** | `PerformanceObserver` 监听 `largest-contentful-paint`，`buffered: true` 防止漏掉 JS 执行前已发生的 LCP 事件。取 `entry.renderTime`（兜底 `loadTime`），组装为 `MetricData`。 |
| **效果** | 页面加载时自动捕获 LCP，多次更新自动覆盖取终值。 |

### 5. FID（首次输入延迟）采集
**文件：** `src/core/metrics.ts` → `observeFID()`

| 维度 | 内容 |
|---|---|
| **为何做** | FID 衡量用户首次交互到浏览器响应的延迟，直接反映页面"卡不卡"。 |
| **如何做** | `PerformanceObserver` 监听 `first-input`（非 `buffered`，因为交互后才能发生）。`entry.duration`（=`processingStart - startTime`）即为 FID 值。`try/catch` 兼容旧浏览器，降级用 `performance.getEntriesByType('first-input')`。回调触发一次后 `disconnect()` 释放资源。 |
| **效果** | 用户首次点击/按键后自动捕获响应延迟。Firefox 等不支持的浏览器静默降级。 |

### 6. CLS（累积布局偏移）采集
**文件：** `src/core/metrics.ts` → `observeCLS()`

| 维度 | 内容 |
|---|---|
| **为何做** | CLS 衡量页面视觉稳定性，意外布局偏移严重影响用户体验。 |
| **如何做** | `PerformanceObserver` 监听 `layout-shift`，`buffered: true`。闭包维护 `clsVal` 累加 `entry.value`。过滤 `hadRecentInput === true`（用户交互 500ms 内引起的偏移不计入）。 |
| **效果** | 整个页面生命周期中持续累加偏移分数，过滤用户主动触发的偏移。 |

### 7. JS 运行时错误监控
**文件：** `src/core/error.ts` → `listenJSError()`

| 维度 | 内容 |
|---|---|
| **为何做** | JS 错误直接导致功能不可用，是线上监控的第一优先级。 |
| **如何做** | `window.addEventListener('error', handler, true)` 捕获阶段监听。用 `event instanceof ErrorEvent` 区分 JS 错误和资源错误。提取 `message/filename/lineno/colno/stack` 组装 `ErrorData`。 |
| **效果** | 捕获所有未 try/catch 的 JS 运行时错误。 |

### 8. 资源加载错误监控
**文件：** `src/core/error.ts` → `listenResourceError()`

| 维度 | 内容 |
|---|---|
| **为何做** | `<img>/<script>/<link>` 加载失败不会抛 JS 异常，必须用捕获阶段监听。 |
| **如何做** | 同一 `window 'error'` 事件，`{ capture: true }` 捕获阶段拦截不冒泡的资源错误。通过 `event.target.tagName` 和 `src/href` 拼出可读消息。 |
| **效果** | 捕获 404 图片/脚本/CSS，消息格式：`加载 IMG 失败: https://xxx`。 |

### 9. Promise 未捕获异常监控
**文件：** `src/core/error.ts` → `listenPromiseError()`

| 维度 | 内容 |
|---|---|
| **为何做** | `Promise.reject()` 无 `.catch()` 的异常不会被 `window.onerror` 捕获。 |
| **如何做** | `window.addEventListener('unhandledrejection', handler)`。区分 `reason instanceof Error`（取 message/stack）和普通值（`String(reason)`）。 |
| **效果** | 捕获所有未处理的 Promise reject。 |

### 10. 批量上报队列
**文件：** `src/transport/queue.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | 逐条发送 = N 个 HTTP 请求，浪费带宽且可能压垮服务端。批量合并减少请求数。 |
| **如何做** | 内存数组 `queue` 作为缓冲区。两个触发条件：① `queue.length >= batchSize`（攒够一批）；② `setInterval` 定时器到期。`flush()` 先 `[...queue]` 快照再 `queue.length = 0` 清空，防止异步回调中数据污染。对外暴露 `setupQueue/onFlush/addToQueue`。 |
| **效果** | 生产者-消费者解耦：采集模块只管 `addToQueue`，不关心怎么发。 |

### 11. 双通道发送器
**文件：** `src/transport/sender.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | 单通道有缺陷：`fetch` 可重试但页面关闭时会中断；`sendBeacon` 可靠但不返回响应状态无法重试。双通道互补。 |
| **如何做** | `createSender(config)` 工厂函数返回 `send(items)` 闭包。内部：① 错误去重：`Map<key, timestamp>` 记录最近发送时间，`errorDedupWindow` 窗口内相同错误跳过；② `fetch + keepalive: true` 发送；③ 失败递归重试最多 3 次（间隔 1s）；④ 全部失败降级 `navigator.sendBeacon` 兜底。 |
| **效果** | 正常场景有重试保障，卸载场景有 sendBeacon 兜底，重复错误自动去重。 |

### 12. 类型守卫工具
**文件：** `src/utils/helper.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | `TransportItem = MetricData | ErrorData` 联合类型需要通过类型守卫收窄后才能安全访问各自字段。 |
| **如何做** | `isMetric(item): item is MetricData` 检查 `type` 是否在 `['LCP','FID','CLS']` 中；`isError(item): item is ErrorData` 同理检查错误类型集合。 |
| **效果** | sender 中去重逻辑可以安全判断 `isError(item)` 后访问 `item.message`。 |

---

## ✅ 新增已完成（P0/P1/P2）

### 13. 全链路串联
**文件：** `src/index.ts` / `metrics.ts` / `error.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | 采集模块只 `console.log`，数据未进入队列→发送链路。 |
| **如何做** | `init()` 中 `setupQueue` → `createSender` → `onFlush` 注入。`metrics.ts`/`error.ts` 直接 import `addToQueue(item)` 替换 `console.log`。 |
| **效果** | 采集 → 入队 → 批量 flush → 双通道发送 → 服务端，全链路闭环。 |

### 14. 页面卸载兜底
**文件：** `src/core/unload.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | 用户关闭标签页时 `setInterval` 失效，队列数据可能丢失。 |
| **如何做** | `visibilitychange`（隐藏时 flush）+ `pagehide`（卸载时 flush），`flushed` 标记防重复。恢复可见时重置标记。 |
| **效果** | 页面关闭/切 Tab 时立即触发队列 flush。 |

### 15. Node.js 上报接收服务
**文件：** `server/index.js`

| 维度 | 内容 |
|---|---|
| **为何做** | 全链路闭环需要接收端；面试演示需要数据源。 |
| **如何做** | Express（ES 模块版），`POST /report` 接收 JSON 追加写入 `data.json`；`GET /report/data` 返回全部数据。 |
| **效果** | `node server/index.js` 启动，SDK 数据实时落盘。 |

### 18. IndexedDB 离线队列 + 弱网状态机
**文件：** `src/transport/storage.ts` / `sender.ts` / `index.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | 网络不可靠 + 页面随时关闭 → 数据在异步间隙丢失。需要持久化 + 补发机制。 |
| **如何做** | `storage.ts`：Promise 封装 IndexedDB（openDB/saveToDB/loadAllFromDB/clearDB），单例缓存连接，事务 oncomplete resolve。`sender.ts`：改造为 async 状态机——成功 → 补发 DB 残留 → 清 DB；重试耗尽 → 写 DB + sendBeacon。`index.ts`：init 时 `isDBSupported()` 检测，有残留推入队列补发。 |
| **效果** | 离线/断网数据不丢失，下次打开自动补发。涉及异步事务、状态机设计、流量协调——项目最有工程深度的模块。 |

---

## 🔲 待完成的模块

### 🟡 优先级 P1（可视化）

#### 15. Node.js 上报接收服务
**文件：** `server/index.js`

| 维度 | 内容 |
|---|---|
| **为何做** | 没有接收端就无法验证全链路，面试也无法演示完整流程。 |
| **如何做** | 最小化 Express 服务（~50 行），`POST /report` 接收 JSON，打印到控制台并追加写入本地 JSON 文件。CORS 开放、速率限制可选。 |
| **效果** | `npm run server` 启动，SDK 上报数据实时可见，全链路可演示。 |
| **预估行数** | ~50 行 |

#### 16. 数据可视化面板
**文件：** `test/dashboard.html`

| 维度 | 内容 |
|---|---|
| **为何做** | 面试时能打开浏览器直接看到 LCP/FID/CLS 的实时变化曲线，比任何文字描述都有说服力。 |
| **如何做** | 纯静态 HTML，使用 Chart.js CDN。定时从服务端拉取 `/report/data` 接口（或被服务端通过 SSE/WebSocket 推送），渲染折线图。三条曲线分别对应 LCP（ms）、FID（ms）、CLS（分数），带阈值参考线（LCP<2500, FID<100, CLS<0.1）。 |
| **效果** | 面试演示：触发性能问题 → 面板上指标实时劣化 → 直观展示监控价值。 |
| **预估行数** | ~100 行 |

### 🔵 优先级 P2（技术深度增强）

#### 17. 长任务监控（Long Task）
**文件：** `src/core/metrics.ts` 新增 `observeLongTask()`

| 维度 | 内容 |
|---|---|
| **为何做** | 长任务（>50ms 阻塞主线程）是 FID 恶化的根因。PerformanceObserver `longtask` 类型面试官大多不了解，差异化亮点。 |
| **如何做** | `PerformanceObserver` 监听 `longtask`，`buffered: true`。`entry.duration` 阻塞时长，`entry.attribution[0]` 追溯脚本来源。 |
| **效果** | 定位"页面为什么卡"，配合 FID 形成因果链。 |
| **预估行数** | ~40 行 |

#### 19. 数据采样
**文件：** `src/transport/sampler.ts`

| 维度 | 内容 |
|---|---|
| **为何做** | 大流量站点不可能 100% 上报，需要采样降低服务端压力。 |
| **如何做** | 哈希采样：`hash(userId + pageUrl) % 100 < sampleRate`，保证同用户始终在同一采样组。分层：关键错误 100% 上报，性能指标可配置。 |
| **效果** | 服务端数据量可控，采样结果可统计外推。 |
| **预估行数** | ~40 行 |

### 🟢 优先级 P3（文档与完善）

#### 20. README 设计文档
**文件：** `README.md`

| 维度 | 内容 |
|---|---|
| **为何做** | 面试官 30 秒扫项目，README 是唯一会被仔细看的东西。 |
| **如何做** | 包含：架构图（ASCII art）、技术选型理由（为什么 Rollup 不用 Webpack、为什么双通道）、核心流程图、使用示例、API 文档。每项决策都写"为什么这样做"。 |
| **效果** | 简历上的项目链接点进去，面试官 5 秒建立信任。 |

---

## 📊 工作量总览

| 阶段 | 模块数 | 预估行数 | 状态 |
|---|---|---|---|
| 工程化 + 类型体系 | 3 | ~200 | ✅ 完成 |
| 核心采集（LCP/FID/CLS + 错误） | 6 | ~180 | ✅ 完成 |
| 上报体系（队列 + 发送器 + 工具） | 3 | ~80 | ✅ 完成 |
| P0 闭环串联 + 卸载兜底 | 2 | ~70 | ✅ 完成 |
| P1 服务端 | 1 | ~50 | ✅ 完成 |
| IndexedDB 离线队列 + 弱网状态机 | 1 | ~120 | ✅ 完成 |
| **P1 可视化面板** | **1** | **~100** | 🔲 待做 |
| **P2 长任务 + 采样** | **2** | **~80** | 🔲 待做 |
| **P3 README** | **1** | **N/A** | 🔲 待做 |

**当前已写：~480 行 | 全量预估：~660 行**
