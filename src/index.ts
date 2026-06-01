import type { PerfMonitorConfig } from './types';
import { observeLCP, observeFID, observeCLS } from './core/metrics';
import { listenJSError, listenPromiseError, listenResourceError } from './core/error';
import { setupQueue, onFlush, addToQueue, flush, drainQueue, setSampler, replayFromDB } from './transport/queue';
import { createSender } from './transport/sender';
import { createSampler } from './utils/sampler';
import { setupUnload } from './core/unload';
import { loadAllFromDB, isDBSupported, saveToDB } from './transport/storage';

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
        sampleRate: userConfig.sampleRate ?? 1,
    };
    initialized = true;
    console.log('[perf-monitor] ✅ 初始化完成，配置:', config);

    // 创建采样器并注入队列（错误 100% 上报，性能指标按 sampleRate 采样）
    const sampleRate = config.sampleRate ?? 1;
    const sampler = createSampler(sampleRate);
    setSampler(sampler);

    setupQueue(config);
    const send = createSender(config);
    onFlush(send);

    // 正常 flush：走完整 sender 异步流程（有重试）
    // 快速 flush：pagehide 时直接 drainQueue → 写 DB → sendBeacon
    setupUnload(flush, () => {
        const snapshot = drainQueue();
        if (snapshot.length === 0 || !config) return;
        saveToDB(snapshot).catch(() => {});
        const body = JSON.stringify(snapshot);
        navigator.sendBeacon?.(config.url, body);
    });

    // 检测 IndexedDB 中是否有上次未发送的残留数据，有则补发
    // 使用 replayFromDB() 而非 addToQueue()，绕过采样器，避免历史数据二次过滤
    if (isDBSupported()) {
        loadAllFromDB()
            .then((staleItems) => {
                if (staleItems.length > 0) {
                    console.log(
                        `[perf-monitor] 📦 检测到 ${staleItems.length} 条离线数据，绕过采样直接入队补发`,
                    );
                    replayFromDB(staleItems);
                }
            })
            .catch((e) => {
                console.warn('[perf-monitor] 离线数据读取失败:', e);
            });
    }

    observeLCP();
    observeFID();
    observeCLS();
    listenJSError();
    listenPromiseError();
    listenResourceError();
}

interface PerfMonitorAPI {
    init: typeof init;
}

const api: PerfMonitorAPI = { init };

if (typeof window !== 'undefined') {
    (window as unknown as Record<string, PerfMonitorAPI>).PerfMonitor = api;
}

export default api;
