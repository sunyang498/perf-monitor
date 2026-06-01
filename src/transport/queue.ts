import type { FlushCallback, PerfMonitorConfig, TransportItem, Sampler } from '../types';

const queue: TransportItem[] = [];
let flushCallback: FlushCallback | null = null;
let timerId: ReturnType<typeof setInterval> | null = null;
let batchSize = 5;
let flushInterval = 5000;
let sampler: Sampler | null = null;

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

/**
 * 设置采样器实例。在 init() 中由 createSampler 创建后注入。
 * 采集层对采样器无感知，只需调用 addToQueue，内部自动过滤。
 */
export function setSampler(s: Sampler): void {
    sampler = s;
}

export function addToQueue(item: TransportItem): void {
    // 采样过滤：如果采样器判定不应采集，则跳过此条数据
    if (sampler && !sampler.shouldSample(item)) {
        return;
    }
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

/**
 * 取出队列中所有数据并清空，返回快照。
 * 供页面卸载时使用——不经过异步 sender，直接由调用方处理。
 */
export function drainQueue(): TransportItem[] {
    if (queue.length === 0) return [];
    const snapshot: TransportItem[] = [...queue];
    queue.length = 0;
    return snapshot;
}

/**
 * 离线数据回放入队——绕过采样器直接入队。
 *
 * 为什么需要这个函数：
 *   init() 中从 IndexedDB 取出的历史数据，在上次被采集时已经做过采样判定（存入 DB 即意味着当时被判定为"应采集"）。
 *   如果回放时走 addToQueue()，会因为当前 session 的 sessionId 不同而可能产生不同的哈希判定结果，
 *   导致原本被采集的数据被二次过滤丢弃。
 *
 *   因此 replayFromDB 直接 push 到内存队列，不做任何采样检查。
 *
 * @param items - 从 IndexedDB 取出的待补发数据
 */
export function replayFromDB(items: TransportItem[]): void {
    for (const item of items) {
        queue.push(item);
    }
    // 如果回放后队列达到批量阈值，立即触发 flush
    if (queue.length >= batchSize) {
        flush();
    }
}