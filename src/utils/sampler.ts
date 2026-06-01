// sampler.ts — 数据采样模块（哈希分层采样）
//
// 设计原理：
//   大流量场景下不可能 100% 上报所有数据，需要采样降低服务端压力。
//   采用「字符串哈希 + 取模」的一致性采样策略：
//     - 对同一 session + 同一 pageUrl，哈希结果始终一致
//     - 从而保证同一次页面浏览中的同类指标要么全采要么全不采
//     - 避免「同页面同指标时而上报时而不报」导致的统计偏差
//
// 分层策略：
//   - 错误数据（jsError / resourceError / promiseError）→ 100% 上报
//     （错误发生频率通常远低于性能指标，且对稳定性至关重要）
//   - 性能指标（LCP / FID / CLS）→ 按 sampleRate 比例采样
//
// 使用方式：
//   const sampler = createSampler(0.5)  // 50% 采样
//   if (sampler.shouldSample(item)) { addToQueue(item) }

import type { TransportItem, Sampler } from '../types';
import { isError } from './helper';

// ============================================================
// 字符串哈希函数（DJB2 算法 — 标准加法版本）
// ============================================================

/**
 * DJB2 非加密哈希算法（标准加法版本），将任意字符串映射为一个非负整数。
 * 选择 DJB2 的原因：
 *   - 实现仅 4 行，无外部依赖
 *   - 哈希分布均匀，适合采样分桶
 *   - 确定性：相同输入始终得到相同输出
 *
 * @param str - 待哈希的字符串
 * @returns 非负整数哈希值（0 ~ 2^32-1）
 */
function djb2Hash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c（标准加法）
    }
    return hash >>> 0; // 确保为非负 32 位整数
}

// ============================================================
// Sampler 工厂函数
// ============================================================

/**
 * 创建一个采样器实例。
 *
 * @param sampleRate - 采样率，范围 0~1。
 *                     0 = 不采集任何性能指标（错误仍采集），
 *                     1 = 采集全部数据（默认）。
 *                     0.5 = 采集 50% 的性能指标。
 * @returns Sampler 对象，包含 shouldSample 方法
 */
export function createSampler(sampleRate: number): Sampler {
    // 兜底：非法值按 1 处理（全部采集）
    const rate = typeof sampleRate === 'number' && !isNaN(sampleRate) ? sampleRate : 1;
    // 限制范围 [0, 1]
    const clampedRate = Math.max(0, Math.min(1, rate));

    // 生成当前 session 的唯一标识，保证同一次页面浏览中采样一致性
    // 优先使用 crypto.randomUUID()（更规范），降级使用 Math.random + 时间戳兜底
    const sessionId =
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : Math.random().toString(36).substring(2, 10) || Date.now().toString(36);

    /**
     * 判断 item 是否应该被采集。
     *
     * 实现逻辑：
     *   1. 错误类型 → 始终采集
     *   2. sampleRate >= 1 → 全部采集
     *   3. sampleRate <= 0 → 跳过所有性能指标
     *   4. 其余按 hash(sessionId + pageUrl + metricType) % 100 < threshold 判定
     */
    function shouldSample(item: TransportItem): boolean {
        // 错误数据始终 100% 上报
        if (isError(item)) return true;

        // sampleRate = 1：全部采集（快速路径）
        if (clampedRate >= 1) return true;

        // sampleRate = 0：跳过所有性能指标
        if (clampedRate <= 0) return false;

        // 哈希采样：构造唯一键 → 哈希 → 取模判定
        const key = `${sessionId}:${item.pageUrl}:${item.type}`;
        const hash = djb2Hash(key);

        // 使用 Math.round 消除 IEEE 754 浮点精度误差
        const threshold = Math.round(clampedRate * 100);
        return (hash % 100) < threshold;
    }

    return { shouldSample };
}
