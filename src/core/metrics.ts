// metrics.ts
import type { MetricData } from '../types';

/** 组装一条性能指标数据 */
function buildMetric(type: MetricData['type'], value: number): MetricData {
    return {
        type,
        value,
        pageUrl: window.location.href,
        timestamp: Date.now(),
    };
}

export function observeLCP(): void {
    const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
            const lcp = entry as unknown as LargestContentfulPaint;
            const item = buildMetric('LCP', lcp.renderTime || lcp.loadTime);
            console.log('[perf-monitor] LCP 采集:', item);
            // TODO: 后续交给队列
        });
    });

    observer.observe({ type: 'largest-contentful-paint', buffered: true });
}

export function observeFID(): void {
    try {
        const observer = new PerformanceObserver((list) => {
            const entry = list.getEntries()[0];
            const item = buildMetric('FID', entry.duration);
            console.log('[perf-monitor] FID 采集:', item);
            observer.disconnect();
        });

        observer.observe({ type: 'first-input', buffered: false });
    } catch {
        // 极老浏览器不支持 PerformanceObserver 时，退而查 buffer
        const entries = performance.getEntriesByType('first-input');
        if (entries.length > 0) {
            const item = buildMetric('FID', entries[0].duration);
            console.log('[perf-monitor] FID 采集（降级）:', item);
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
            console.log('[perf-monitor] CLS 采集:', clsVal);
        });
    });
    observer.observe({ type: 'layout-shift', buffered: true });
};