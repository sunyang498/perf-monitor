import type { FlushCallback, PerfMonitorConfig, TransportItem } from '../types';

const queue: TransportItem[] = [];
let flushCallback: FlushCallback | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let batchSize = 5;
let flushInterval = 5000;

export function setupQueue(config: PerfMonitorConfig): void {
    batchSize = config.batchSize ?? 5;
    flushInterval = config.flushInterval ?? 5000;
    if (timerId !== null) return;
    timerId = setInterval(() => {
        flush();
    }, flushInterval);
}

export function onFlush(cb: FlushCallback): void {
    flushCallback = cb;
}

export function addToQueue(item: TransportItem): void {
    queue.push(item);
    if (queue.length >= batchSize) {
        flush();
    }
}

export function flush(): void {
    if (queue.length === 0) return;
    const snapshot: TransportItem[] = [...queue];
    queue.length = 0;
    flushCallback?.(snapshot);
}