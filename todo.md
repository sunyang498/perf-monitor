好，决定了我就不废话。下面是完整的技术方案和任务拆解。

---

## 🏗️ 整体技术架构

```
┌─────────────────────────────────────────┐
│           性能监控 SDK (perf-monitor)      │
├─────────────────────────────────────────┤
│  核心模块层                               │
│  ┌─────────┐ ┌──────────┐ ┌──────────┐  │
│  │ 性能采集 │ │ 错误监控  │ │ 行为追踪  │  │
│  │ metrics │ │  error   │ │ behavior │  │
│  └────┬────┘ └────┬─────┘ └────┬─────┘  │
├───────┼───────────┼────────────┼────────┤
│  数据处理层                               │
│  ┌──────────────────────────────────┐    │
│  │  数据清洗 → 指标计算 → 格式标准化  │    │
│  └──────────────┬───────────────────┘    │
├─────────────────┼───────────────────────┤
│  上报策略层                               │
│  ┌──────────────────────────────────┐    │
│  │  批量队列 → 采样/节流 → 发送控制   │    │
│  └──────────────┬───────────────────┘    │
├─────────────────┼───────────────────────┤
│  传输层                                   │
│  ┌──────────────────────────────────┐    │
│  │  fetch/beacon → 重试/降级 → 兜底  │    │
│  └──────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

**技术栈：** TypeScript + Rollup 打包

**项目结构：**
```
perf-monitor/
├── src/
│   ├── index.ts          # 入口 + 初始化
│   ├── core/
│   │   ├── metrics.ts    # 性能指标采集
│   │   ├── error.ts      # 错误监控
│   │   └── behavior.ts   # 基础行为(可选)
│   ├── transport/
│   │   ├── queue.ts      # 上报队列
│   │   └── sender.ts     # 发送器(fetch/beacon)
│   ├── utils/
│   │   ├── helpers.ts    # 工具函数
│   │   └── constants.ts  # 常量定义
│   └── types/
│       └── index.ts      # 类型定义
├── test/
│   └── index.html        # 本地测试页面
├── rollup.config.js
├── tsconfig.json
└── package.json
```

---

## 📋 完整 TODO 列表（14 天 / 每天 3-4 小时）

---

### 🔹 阶段一：项目骨架 + 第一个指标跑通（Day 1-2）

| 任务 | 做什么 | 用到的 API / 工具 | 产出 |
|------|--------|------------------|------|
| Day 1 | 初始化项目，配 TS + Rollup | `npm init`, `typescript`, `rollup`, `rollup-plugin-typescript2` | 能 `npm run build` 打包出一个 JS 文件 |
| Day 1 | 写入口结构 + 类型定义 | 无，纯 TS 类型 | `types/index.ts` 定义 `MetricType`, `ReportData` 等接口 |
| Day 1 | 实现 LCP 采集 | `new PerformanceObserver((list) => {}).observe({ type: 'largest-content-paint', buffered: true })` | 控制台能打印出 LCP 的值 |
| Day 2 | 实现 FID 采集 | `new PerformanceObserver(...).observe({ type: 'first-input', buffered: true })` | 页面点击后能拿到 FID |
| Day 2 | 实现 CLS 采集 | `new PerformanceObserver(...).observe({ type: 'layout-shift', buffered: true })` | 能拿到 CLS 累加值 |
| Day 2 | 统一采集入口 | 封装 `observeMetric()` 函数 | 一个函数统一处理三种指标 |

**Day 2 结束状态：** 在测试页面加载，控制台能看到 LCP / FID / CLS 的数据打印。

---

### 🔹 阶段二：错误监控（Day 3-4）

| 任务 | 做什么 | 用到的 API / 工具 | 产出 |
|------|--------|------------------|------|
| Day 3 | 实现 JS 运行时错误捕获 | `window.addEventListener('error', handler)` | 语法错误、运行时错误能拿到 |
| Day 3 | 实现资源加载错误捕获 | `window.addEventListener('error', handler, true)` → 注意第三个参数 `true`（捕获阶段） | `<script>`/`<img>` 加载失败能拿到 |
| Day 3 | 实现 Promise 异常捕获 | `window.addEventListener('unhandledrejection', handler)` | Promise 里抛错能拿到 |
| Day 4 | 统一错误数据格式 | 把三种错误统一成 `ErrorReportData` 结构 | 错误类型、信息、堆栈、时间戳格式化 |
| Day 4 | 处理 `crossOrigin` 脚本错误 | 了解 `crossorigin` 属性的作用，处理 "Script error." 问题 | 知道跨域脚本错误的限制和处理方式 |

**用到的 API 汇总：**
- `window.addEventListener('error', fn)` — JS 运行时错误
- `window.addEventListener('error', fn, true)` — 资源加载错误（注意第三个参数）
- `window.addEventListener('unhandledrejection', fn)` — Promise 未捕获异常
- `error.message`, `error.stack`, `error.filename`, `error.lineno`, `error.colno` — 错误信息字段

**Day 4 结束状态：** JS 报错、资源加载失败、Promise 异常都能捕获并统一格式。

---

### 🔹 阶段三：上报队列 + 批量发送（Day 5-7）

| 任务 | 做什么 | 用到的 API / 工具 | 产出 |
|------|--------|------------------|------|
| Day 5 | 实现上报队列 | 用数组 `queue: ReportData[]` 存数据 | 每次采集/报错都 `push` 进队列 |
| Day 5 | 实现批量发送逻辑 | `queue.length >= threshold` 时触发发送；或者用 `requestIdleCallback`/`setTimeout` 定时 flush | 不是每条都立刻发，攒够一批一起发 |
| Day 6 | 实现 `fetch` 发送 | `fetch(url, { method: 'POST', body: JSON.stringify(queue), headers: {...}, keepalive: true })` | 能把数据发出去 |
| Day 6 | 实现重试逻辑 | 发送失败后把数据放回队列头部，设置最大重试次数（3次） | 网络波动不丢数据 |
| Day 7 | 处理数据去重 | 错误类型的数据，相同错误在 N 秒内只上报一次（用 Map 存 key + 时间戳） | 同一个错误不会上报几十次 |
| Day 7 | 联调测试 | 在测试页面里模拟各种场景，确认上报正常 | 数据能正常发到 mock 接口 |

**用到的 API / 方法：**
- `Array.push()` / `Array.splice()` — 队列操作
- `fetch(url, { keepalive: true })` — 发送请求
- `setTimeout()` / `requestIdleCallback()` — 定时刷新队列
- `Map` — 去重缓存

**Day 7 结束状态：** 采集到的数据能攒一批发一次，发送失败会重试，错误不会重复上报。

---

### 🔹 阶段四：sendBeacon + 页面卸载兜底（Day 8-10）

| 任务 | 做什么 | 用到的 API / 工具 | 产出 |
|------|--------|------------------|------|
| Day 8 | 实现 `sendBeacon` 发送 | `navigator.sendBeacon(url, JSON.stringify(data))` | 页面卸载时能用 beacon 发数据 |
| Day 8 | 实现发送策略选择 | 正常用 `fetch`，页面卸载用 `sendBeacon` | 两种发送方式自动切换 |
| Day 9 | 监听页面卸载事件 | `window.addEventListener('visibilitychange', fn)` + `window.addEventListener('pagehide', fn)` | 页面关闭/隐藏时触发 flush |
| Day 9 | 实现 `sessionStorage` 兜底 | 页面卸载时如果发送失败，把数据存 `sessionStorage`；下次页面加载时检查并补发 | 极端情况下的兜底 |
| Day 10 | 处理 `beforeunload` 的坑 | 了解为什么不用 `beforeunload`（浏览器会杀死异步请求），选择 `visibilitychange` + `pagehide` 的原因 | 能讲清楚事件选择的依据 |
| Day 10 | 测试各种关闭场景 | 关闭标签页、刷新、跳转、浏览器崩溃 | 验证兜底逻辑 |

**用到的 API / 事件：**
- `navigator.sendBeacon(url, data)` — 页面卸载时保证发送
- `document.addEventListener('visibilitychange', fn)` — 页面可见性变化
- `window.addEventListener('pagehide', fn)` — 页面隐藏（比 beforeunload 可靠）
- `sessionStorage.setItem()` / `sessionStorage.getItem()` — 本地暂存

**重要知识点（面试必问）：**
- `beforeunload` 里发 `fetch` 会被浏览器取消，`sendBeacon` 不会被取消
- `visibilitychange` + `pagehide` 比 `beforeunload` 更可靠
- 浏览器 crash 时 `sendBeacon` 也保不住，这是已知局限

**Day 10 结束状态：** 页面正常关闭/刷新/跳转时数据不丢失，crash 场景知道有局限。

---

### 🔹 阶段五：完善 + 测试页面 + 面试准备（Day 11-14）

| 任务 | 做什么 | 产出 |
|------|--------|------|
| Day 11 | 写一个完整的测试页面 | 页面里有大图（触发 LCP）、按钮点击（触发 FID）、动态插入元素（触发 CLS）、手动抛错、资源加载失败等场景 |
| Day 11 | 配置一个简单的 mock 后端 | 用 Express 写一个 `/report` 接口接收数据并打印（复用你已有的 Node 技能） |
| Day 12 | 补充边界处理 | 配置项校验、初始化保护（不重复初始化）、数据长度限制、离线时缓存到 localStorage |
| Day 12 | 写 README | 项目介绍、使用方式、API 文档、技术选型说明 |
| Day 13 | 准备面试口述稿 | 3 分钟项目介绍 + 难点/亮点 + 边界处理 + 已知局限 |
| Day 14 | 模拟面试 | 我扮演面试官问你 SDK 相关的问题，你脱稿回答 |

**Day 14 结束状态：** 项目能跑、代码能讲、面试能答。

---

## 🛠️ 用到的所有 API 速查表

| 分类 | API | 用途 | 注意事项 |
|------|-----|------|---------|
| 性能 | `PerformanceObserver` | 监听性能指标 | 用 `buffered: true` 拿历史数据 |
| 性能 | `largest-content-paint` | 采集 LCP | LCP 会变化，取最后一次 |
| 性能 | `first-input` | 采集 FID | 只有用户交互后才触发 |
| 性能 | `layout-shift` | 采集 CLS | 累加值，需要手动求和 |
| 错误 | `window.onerror` / `addEventListener('error')` | 捕获 JS 运行时错误 | 拿不到跨域脚本的详细堆栈 |
| 错误 | `addEventListener('error', fn, true)` | 捕获资源加载错误 | 第三个参数 `true` 表示捕获阶段 |
| 错误 | `addEventListener('unhandledrejection')` | 捕获 Promise 异常 | 处理未 catch 的 Promise |
| 发送 | `fetch(url, { keepalive: true })` | 普通发送 | `keepalive` 保证页面跳转时不中断 |
| 发送 | `navigator.sendBeacon(url, data)` | 卸载时发送 | 数据大小有限制（64KB） |
| 卸载 | `visibilitychange` | 监听页面可见性 | 比 `beforeunload` 更可靠 |
| 卸载 | `pagehide` | 页面隐藏 | `beforeunload` 的可靠替代 |
| 存储 | `sessionStorage` | 暂存失败数据 | 关闭标签页后自动清除 |

---

## ⚡ 立刻开始 Day 1

今天要完成：

1. 建项目文件夹 `perf-monitor`
2. `npm init` → 装 `typescript`, `rollup`, `rollup-plugin-typescript2`
3. 写最简入口：创建一个 `PerformanceObserver`，监听 `largest-content-paint`，打印结果
4. 配 Rollup 打包，确认能输出 JS 文件