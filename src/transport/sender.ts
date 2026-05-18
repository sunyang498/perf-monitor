import { PerfMonitorConfig, TransportItem, MetricType, ErrorType, ItemKind, FlushCallback, ErrorData, MetricData } from "../types";
import { isMetric, isError } from "../utils/helper";

export function createSender(config: PerfMonitorConfig) {
    const dedupMap = new Map();
    return function send(items: TransportItem[]): void {
        let now = Date.now();
        let filtered = items.filter(item => {
            if (isError(item)) {
                let key = `${item.type}:${item.message}`;
                let lastTime = dedupMap.get(key);
                let dedupWindow = config.errorDedupWindow || 10000;
                if (lastTime && now - lastTime < dedupWindow) {
                    return false;
                }
                dedupMap.set(key, now);
            }
            return true
        });
        if (!filtered.length) return
        const data = JSON.stringify(filtered);
        trySend(config.url, data, 0)
    };
    function trySend(url: string, data: string, retryCount: number) {
        if (retryCount >= 3) {
            navigator.sendBeacon?.(url, data)
            return
        }
        fetch(url, {
            method: 'POST',
            body: data,
            keepalive: true,
            headers: {
                'Content-Type': 'application/json'
            }
        }).then(() => {

        }).catch(() => {
            // 失败则重试
            setTimeout(() => {
                trySend(url, data, retryCount + 1)
            }, 1000)
        })
    }
}