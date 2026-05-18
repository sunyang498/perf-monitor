import type { PerfMonitorConfig } from './types';
import { observeLCP, observeFID, observeCLS } from './core/metrics';
import { listenJSError, listenPromiseError, listenResourceError } from './core/error';
import { setupQueue, onFlush, flush } from './transport/queue';
import { createSender } from './transport/sender';
import { setupUnload } from './core/unload';

let config: PerfMonitorConfig | null = null;
let initialized = false;

/**
 * 初始化性能监控 SDK
 *
 * @param userConfig - 用户传入的配置，url 为必填
 *
 */
function init(userConfig: PerfMonitorConfig): void {
    if (initialized) {
        console.warn('[perf-monitor] SDK 已初始化，忽略重复调用');
        return;
    }
    if (!userConfig.url) {
        console.error('[perf-monitor] init() 缺少必填参数: url');
        return;
    }
    config = {
        url: userConfig.url,
        batchSize: userConfig.batchSize ?? 5,
        flushInterval: userConfig.flushInterval ?? 5000,
        errorDedupWindow: userConfig.errorDedupWindow ?? 10000,
    };
    initialized = true;
    console.log('[perf-monitor] ✅ 初始化完成，配置:', config);

    setupQueue(config)
    const sender = createSender(config)
    onFlush(sender)
    setupUnload(flush)

    observeLCP()
    observeFID()
    observeCLS()
    listenJSError()
    listenPromiseError()
    listenResourceError()
}

interface PerfMonitorAPI {
    init: typeof init;
}

const api: PerfMonitorAPI = { init };

if (typeof window !== 'undefined') {
    (window as unknown as Record<string, PerfMonitorAPI>).PerfMonitor = api;
}

export default api;
