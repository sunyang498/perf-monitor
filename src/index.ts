// index.ts — SDK 唯一入口，负责配置初始化与模块串联

import type { PerfMonitorConfig } from './types';
import { observeLCP, observeFID, observeCLS } from './core/metrics';

// ============================================================
// 内部状态
// ============================================================

/** SDK 全局配置，仅在 init() 调用后有效 */
let config: PerfMonitorConfig | null = null;

/** SDK 是否已初始化 */
let initialized = false;

// ============================================================
// 公开 API
// ============================================================

/**
 * 初始化性能监控 SDK
 *
 * @param userConfig - 用户传入的配置，url 为必填
 *
 * 使用示例：
 * ```js
 * PerfMonitor.init({
 *   url: '/report',
 *   batchSize: 5,
 *   flushInterval: 5000,
 *   errorDedupWindow: 10000,
 * });
 * ```
 */
function init(userConfig: PerfMonitorConfig): void {
    // ① 防御：不允许重复初始化
    if (initialized) {
        console.warn('[perf-monitor] SDK 已初始化，忽略重复调用');
        return;
    }

    // ② 校验必填项
    if (!userConfig.url) {
        console.error('[perf-monitor] init() 缺少必填参数: url');
        return;
    }

    // ③ 合并默认值（用户传了什么就用什么，没传的用默认值）
    config = {
        url: userConfig.url,
        batchSize: userConfig.batchSize ?? 5,
        flushInterval: userConfig.flushInterval ?? 5000,
        errorDedupWindow: userConfig.errorDedupWindow ?? 10000,
    };

    initialized = true;

    console.log('[perf-monitor] ✅ 初始化完成，配置:', config);

    // TODO: 后续步骤将在这里挂载指标采集、错误监听、队列等模块
    observeLCP()
    observeFID()
    observeCLS()
}

// ============================================================
// 挂载到全局作用域，用户通过 <script> 引入后即可使用
// ============================================================
// 说明：Rollup 打包成 IIFE 格式后，name: 'PerfMonitor'
// 会自动生成 var PerfMonitor = (function() { ... return { init }; })();
// 但为了确保类型安全和代码可读性，我们显式挂载到 window

interface PerfMonitorAPI {
    init: typeof init;
}

// 挂载到 window，同时导出给将来可能的 ESM 用户
const api: PerfMonitorAPI = { init };

// 条件判断：浏览器环境才挂 window，SSR 环境跳过
if (typeof window !== 'undefined') {
    (window as unknown as Record<string, PerfMonitorAPI>).PerfMonitor = api;
}

export default api;
