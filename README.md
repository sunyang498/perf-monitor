# perf-monitor

> 从零实现的前端性能监控 SDK —— 采集 Core Web Vitals 与运行时错误，支持批量上报、弱网持久化、页面卸载兜底。

[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue)](https://www.typescriptlang.org/)
[![Rollup](https://img.shields.io/badge/Rollup-4.x-red)](https://rollupjs.org/)
[![License](https://img.shields.io/badge/license-ISC-green)](./LICENSE)

---

## 🏗️ 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                        perf-monitor SDK                      │
├─────────────────────────────────────────────────────────────┤
│  采集层                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │
│  │ LCP/FID  │ │   CLS    │ │ JS错误   │ │ Promise错误   │   │
│  │  指标    │ │ 布局偏移  │ │ 资源错误  │ │  未捕获异常   │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘   │
├───────┼────────────┼────────────┼───────────────┼───────────┤
│  传输层                                                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              批量队列 (queue.ts)                       │   │
│  │    双条件触发：batchSize 达标 / flushInterval 定时     │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │                                    │
│  ┌──────────────────────┴───────────────────────────────┐   │
│  │          双通道发送器 (sender.ts)                      │   │
│  │  fetch+keepalive (可重试) ←→ sendBeacon (兜底)        │   │
│  │  错误去重 · 重试3次 · 周期轮询补发 · IndexedDB持久化   │   │
│  └──────────────────────┬───────────────────────────────┘   │
├─────────────────────────┼───────────────────────────────────┤
│  兜底层                                                    │
│  ┌──────────────────────┴───────────────────────────────┐   │
│  │  页面卸载 (unload.ts) · sessionStorage补偿             │   │
│  │  IndexedDB离线队列 (storage.ts) · 启动补发             │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速开始

```bash
npm install
npm run build          # 打包 → dist/perf-monitor.js
node server/index.js   # 启动接收服务 → http://localhost:3001
```

```html
<script src="dist/perf-monitor.js"></script>
<script>
PerfMonitor.init({
    url: 'http://localhost:3001/report',
    batchSize: 5,           // 攒够5条立即发送
    flushInterval: 5000,    // 每5秒定时发送
    errorDedupWindow: 10000 // 10秒内相同错误去重
});
</script>

<!-- 可选采样配置示例 -->
```html
<script>
PerfMonitor.init({
    url: 'http://localhost:3001/report',
    batchSize: 5,
    flushInterval: 5000,
    errorDedupWindow: 10000,
    sampleRate: 1.0,       // 0~1，默认 1（100% 采集），性能指标按比例采样，错误 100% 上报
    debug: false           // 可选：开启后在开发模式输出采样过滤的调试日志
});
</script>
```
```

## 📊 核心功能

### 性能指标采集

| 指标 | 说明 | 采集方式 | 关键参数 |
|---|---|---|---|
| **LCP** | 最大内容绘制 | `PerformanceObserver` (`largest-contentful-paint`) | `buffered: true` 防止漏采 |
| **FID** | 首次输入延迟 | `PerformanceObserver` (`first-input`) | `try/catch` 降级到 `getEntriesByType` |
| **CLS** | 累积布局偏移 | `PerformanceObserver` (`layout-shift`) | 过滤 `hadRecentInput`，累加 `value` |

### 错误监控

| 类型 | 捕获方式 | 关键技术点 |
|---|---|---|
| JS 运行时错误 | `window.addEventListener('error', ..., true)` | `instanceof ErrorEvent` 区分类型 |
| 资源加载错误 | 同上，捕获阶段拦截 | 资源错误不冒泡，必须 `{ capture: true }` |
| Promise 未捕获 | `window.addEventListener('unhandledrejection')` | 区分 `reason instanceof Error` 与普通值 |

### 上报策略

- **批量队列**：内存数组缓冲，`batchSize` 或 `flushInterval` 触发发送
- **双通道发送**：`fetch + keepalive`（可重试3次）+ `sendBeacon`（兜底）
- **错误去重**：`Map<type+message, timestamp>` 记录最近发送时间，窗口内跳过
- **离线持久化**：发送失败 → IndexedDB → 下次打开自动补发
- **服务端重联自动补发**：`setInterval` 周期轮询（每10s），服务端恢复后自动补发 DB 数据
- **页面卸载兜底**：`pagehide` 时同步写 IndexedDB + `sendBeacon`

### 采样策略（sampleRate）

- `sampleRate`：用户可通过 `PerfMonitor.init({ sampleRate: 0.5 })` 配置 0~1 之间的采样比例，默认 `1`（全量采集）。
- 错误类数据（`jsError` / `resourceError` / `promiseError`）始终 100% 上报，不参与采样。
- 性能指标（LCP / FID / CLS）按哈希分层采样，使用 `sessionId:pageUrl:metricType` 作为哈希键，保证同一页面会话内同类指标采样结果一致。
- 离线回放（IndexedDB 补发）绕过采样器（`replayFromDB()`），保证历史已采样的数据不会被二次过滤丢失。


## 🗂️ 项目结构

```
perf-monitor/
├── src/
│   ├── index.ts              # 入口 + init() 配置分发
│   ├── core/
│   │   ├── metrics.ts        # LCP / FID / CLS 采集
│   │   ├── error.ts          # JS错误 / 资源错误 / Promise异常
│   │   └── unload.ts         # 页面卸载兜底
│   ├── transport/
│   │   ├── queue.ts          # 批量队列
│   │   ├── sender.ts         # 双通道发送 + 弱网状态机
│   │   └── storage.ts        # IndexedDB 离线队列
│   ├── types/
│   │   └── index.ts          # 公共类型定义
│   └── utils/
│       ├── helper.ts         # 类型守卫
│       └── sampler.ts        # 采样器（createSampler / Sampler 接口）
├── server/
│   └── index.js              # Express 接收服务
├── test/
│   └── index.html            # 交互式测试页面
├── dist/
│   └── perf-monitor.js       # 打包产物 (IIFE)
├── rollup.config.js          # Rollup 配置
├── tsconfig.json             # TypeScript 配置
└── todo.md                   # 任务看板
```

## 🔧 技术选型

| 选型 | 理由 |
|---|---|
| **TypeScript** | 类型安全 + 自文档化，`PerformanceEntry` 子类型精确提示 |
| **Rollup (IIFE)** | SDK 输出单个 JS 文件，`<script>` 引入即用，无模块依赖 |
| **PerformanceObserver** | 事件驱动，比轮询 `getEntriesByType` 更精确、更低开销 |
| **fetch + keepalive** | 支持响应状态判断，可重试；`keepalive` 保证页面关闭后请求继续 |
| **sendBeacon** | W3C 专为分析上报设计，页面卸载时最可靠的发送方式 |
| **IndexedDB** | 异步 + 大容量 + 结构化存储，比 localStorage 更适合离线队列 |

## 🧪 测试

```bash
# 启动服务端
node server/index.js

# 浏览器打开
http://localhost:3001

# 测试场景
- 正常采集：点击按钮 → 观察服务端终端和数据文件
- 弱网持久化：停服务 → 触发数据 → 重启服务 → 刷新页面
- 页面卸载兜底：触发数据 → 直接关闭标签页 → 重新打开 → 检查 IndexedDB
```

## 📄 License

ISC