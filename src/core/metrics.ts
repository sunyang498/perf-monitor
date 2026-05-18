import { addToQueue } from '../transport/queue';
import type { MetricData } from '../types';

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