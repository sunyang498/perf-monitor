import { addToQueue } from '../transport/queue';
import type { MetricData, PerfMonitorConfig } from '../types';

function buildMetric(type: MetricData['type'], value: number, meta?: Record<string, unknown>): MetricData {
    const item: MetricData = {
        type,
        value,
        pageUrl: window.location.href,
        timestamp: Date.now(),
    };
    if (meta) {
        item.meta = meta;
    }
    return item;
}

export function observeLCP(): void {
    const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
            const lcp = entry as unknown as LargestContentfulPaint;
            const item = buildMetric('LCP', lcp.renderTime || lcp.loadTime);
            addToQueue(item);
        });
    });

    observer.observe({ type: 'largest-contentful-paint', buffered: true });
}

export function observeFID(): void {
    try {
        const observer = new PerformanceObserver((list) => {
            const entry = list.getEntries()[0];
            const item = buildMetric('FID', entry.duration);
            addToQueue(item);
            observer.disconnect();
        });

        observer.observe({ type: 'first-input', buffered: false });
    } catch {
        const entries = performance.getEntriesByType('first-input');
        if (entries.length > 0) {
            const item = buildMetric('FID', entries[0].duration);
            addToQueue(item);
        }
    }
}

export function observeCLS(): void {
    let clsVal = 0
    const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        entries.forEach(entry => {
            let cls = entry as PerformanceEntry & {
                value: number;
                hadRecentInput: boolean
            };
            if (cls.hadRecentInput) return;
            clsVal += cls.value;
            const item = buildMetric('CLS', clsVal);
            addToQueue(item);
        });
    });
    observer.observe({ type: 'layout-shift', buffered: true });
};

/**
 * 长任务监控（Long Task）
 *
 * 长任务是指阻塞主线程超过 50ms 的任务，是 FID 恶化的根因。
 * PerformanceObserver 的 longtask 类型提供事件驱动的长任务检测。
 *
 * 归因信息通过 item.meta.attribution 上报给后端，便于定位脚本/iframe 来源。
 *
 * @param config - SDK 配置，用于读取 longTaskThreshold、longTaskRateLimit、debug
 */
export function observeLongTask(config: PerfMonitorConfig): void {
    // 检测浏览器是否支持 longtask 类型
    if (typeof PerformanceObserver === 'undefined') {
        console.warn('[perf-monitor] PerformanceObserver 不可用，跳过 Long Task 监控');
        return;
    }

    const threshold = config.longTaskThreshold ?? 50;
    const rateLimit = config.longTaskRateLimit;
    const debug = config.debug ?? false;

    // 速率限制：每分钟最多上报 N 条（高频场景控制）
    let minuteSlotStart = 0;
    let minuteSlotCount = 0;

    try {
        const observer = new PerformanceObserver((list) => {
            const entries = list.getEntries();
            for (const entry of entries) {
                // ① 严格校验 duration：防止 NaN / 负数 / 非有限值
                const dur = Number((entry as PerformanceEntry).duration);
                if (!Number.isFinite(dur) || dur <= 0) continue;

                // ② 阈值过滤
                if (dur <= threshold) continue;

                // ③ 速率限制：按分钟窗口控制上报量
                if (rateLimit !== undefined && rateLimit > 0) {
                    const now = Date.now();
                    // 每分钟重置计数
                    if (now - minuteSlotStart >= 60000) {
                        minuteSlotStart = now;
                        minuteSlotCount = 0;
                    }
                    if (minuteSlotCount >= rateLimit) {
                        if (debug) {
                            console.debug(
                                `[perf-monitor] 🔔 LongTask 速率限制: 本分钟已达上限 ${rateLimit} 条，` +
                                `跳过 ${dur.toFixed(0)}ms 任务`,
                            );
                        }
                        continue;
                    }
                    minuteSlotCount++;
                }

                // ④ 归因信息提取，写入 meta 供后端存储
                const attribution = (entry as PerformanceEntry & {
                    attribution?: {
                        containerType?: string;
                        containerSrc?: string;
                        containerId?: string;
                        containerName?: string;
                    }[];
                }).attribution;

                const meta: Record<string, unknown> = {};
                if (attribution && attribution.length > 0) {
                    const first = attribution[0];
                    meta.attribution = {
                        containerType: first.containerType ?? 'unknown',
                        containerSrc: first.containerSrc ?? '',
                        containerId: first.containerId ?? '',
                        containerName: first.containerName ?? '',
                    };
                }

                const item = buildMetric(
                    'LongTask',
                    dur,
                    Object.keys(meta).length > 0 ? meta : undefined,
                );

                // ⑤ 调试日志（仅 debug 模式）
                if (debug) {
                    const attrStr = meta.attribution
                        ? `来源: ${(meta.attribution as Record<string, unknown>).containerType} ${(meta.attribution as Record<string, unknown>).containerSrc}`
                        : '无归因信息';
                    console.debug(`[perf-monitor] 🔔 LongTask ${dur.toFixed(0)}ms ${attrStr}`);
                }

                addToQueue(item);
            }
        });

        observer.observe({ type: 'longtask', buffered: true });
        if (debug) {
            const limitStr = rateLimit ? ', 限速: ' + rateLimit + '条/分钟' : '';
            console.log('[perf-monitor] 🔔 Long Task 监控已启动 (阈值: ' + threshold + 'ms' + limitStr + ')');
        }
    } catch {
        // 浏览器不支持 longtask 类型，静默降级
        console.warn('[perf-monitor] 当前浏览器不支持 longtask 类型，跳过 Long Task 监控');
    }
};