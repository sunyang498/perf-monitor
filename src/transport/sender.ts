// sender.ts — 双通道发送器 + IndexedDB 离线兜底
//
// 状态机决策：
//   发送 → 成功 → 补发 DB 残留数据 → 清 DB
//   发送 → 重试 3 次 → 全失败 → 写 DB + sendBeacon → 启动周期轮询补发
//   init() 时 → 检测 DB 残留 → 推入队列补发
//
// 重联策略（为什么不用 window.online）：
//   navigator.onLine 只反映 OS 网络状态（WiFi 通断），不反映特定服务端是否可达。
//   且 localhost 环境下 online 事件不可靠。因此采用 setInterval 周期轮询，
//   每隔 RETRY_INTERVAL ms 尝试补发一次 DB 数据，成功则停止轮询。

import type { PerfMonitorConfig, TransportItem } from '../types';
import { isError } from '../utils/helper';
import { saveToDB, loadAllFromDB, clearDB } from './storage';

export function createSender(config: PerfMonitorConfig) {
    const dedupMap = new Map<string, number>();

    // 周期轮询补发相关
    const RETRY_INTERVAL = 10000; // 每 10 秒尝试补发一次 DB 数据
    let retryTimerId: ReturnType<typeof setInterval> | null = null;

    // ============================================================
    // 对外暴露的 send 函数（作为 queue 的 flushCallback）
    // ============================================================

    async function send(items: TransportItem[]): Promise<void> {
        const now = Date.now();

        // ① 错误去重过滤
        const filtered = items.filter((item) => {
            if (isError(item)) {
                const key = `${item.type}:${item.message}`;
                const lastTime = dedupMap.get(key);
                const dedupWindow = config.errorDedupWindow ?? 10000;
                if (lastTime && now - lastTime < dedupWindow) {
                    return false; // 窗口内重复错误，跳过
                }
                dedupMap.set(key, now);
            }
            return true;
        });

        if (filtered.length === 0) return;

        const body = JSON.stringify(filtered);

        // ② 发送（含重试），成功返回 true
        const success = await trySend(config.url, body, 0);

        // ③ 成功后尝试补发 DB 中的历史残留数据
        if (success) {
            console.log('[perf-monitor] ✅ 发送成功，检查 DB 是否有历史数据需补发...');
            replayStaleData(config.url);
        } else {
            console.log('[perf-monitor] ❌ 发送失败，数据已落 DB 并由周期轮询接管');
        }
    }

    // ============================================================
    // trySend — 带重试的 fetch，全失败时写 DB + sendBeacon
    // ============================================================

    async function trySend(
        url: string,
        body: string,
        retryCount: number,
    ): Promise<boolean> {
        if (retryCount >= 3) {
            console.warn(
                `[perf-monitor] ❌ fetch 重试 3 次全部失败，数据将写入 IndexedDB`
            );

            // 数据持久化到 IndexedDB
            try {
                const items = JSON.parse(body) as TransportItem[];
                saveToDB(items).catch((e) =>
                    console.warn('[perf-monitor] IndexedDB 保存失败:', e),
                );
                console.log(
                    `[perf-monitor] 💾 已将 ${items.length} 条数据写入 IndexedDB`
                );
            } catch {
                console.warn('[perf-monitor] ⚠️ body 解析失败，无法保存到 IndexedDB');
            }

            // sendBeacon 最后一次尝试
            const beaconOk = navigator.sendBeacon?.(url, body);
            console.log(
                `[perf-monitor] 📡 sendBeacon 兜底发送: ${beaconOk ? '已入队' : '失败'}`
            );

            // 启动周期轮询补发（如果尚未启动）
            startPeriodicRetry();

            return false;
        }

        try {
            console.log(
                `[perf-monitor] 📤 fetch 尝试发送 (第 ${retryCount + 1} 次)...`
            );
            const res = await fetch(url, {
                method: 'POST',
                body,
                keepalive: true,
                headers: { 'Content-Type': 'application/json' },
            });
            console.log(
                `[perf-monitor] 📥 fetch 响应: HTTP ${res.status} ${res.ok ? '✅' : '⚠️'}`
            );
            return res.ok;
        } catch (err) {
            console.warn(
                `[perf-monitor] ⚠️ fetch 第 ${retryCount + 1} 次失败:`,
                (err as Error).message
            );
            // 失败则等待后递归重试
            await new Promise<void>((r) => setTimeout(r, 1000));
            return trySend(url, body, retryCount + 1);
        }
    }

    // ============================================================
    // startPeriodicRetry — 周期轮询补发 DB 数据（服务端重联检测）
    // ============================================================

    /**
     * 启动 setInterval 定时器，每隔 RETRY_INTERVAL ms 尝试补发 DB 数据。
     * 成功后自动停止。同一时间最多一个定时器。
     *
     * 为什么不用 window 'online' 事件：
     *   - navigator.onLine 只反映 OS 级网络状态（网卡/WiFi），不反映目标服务端可达性
     *   - localhost 环境下 online/offline 事件不会触发
     *   - 周期轮询简单可靠，服务端恢复后最多 RETRY_INTERVAL 延迟即可补发
     */
    function startPeriodicRetry(): void {
        if (retryTimerId !== null) {
            console.log('[perf-monitor] 🔄 周期轮询已在运行，跳过重复启动');
            return;
        }

        console.log(
            `[perf-monitor] 🔄 启动周期轮询补发（每 ${RETRY_INTERVAL / 1000}s 尝试一次）`
        );

        retryTimerId = setInterval(async () => {
            console.log('[perf-monitor] 🔍 周期轮询：检查 IndexedDB 是否有待补发数据...');
            try {
                const stale = await loadAllFromDB();
                if (stale.length === 0) {
                    console.log('[perf-monitor] 🔍 周期轮询：DB 为空，停止轮询');
                    stopPeriodicRetry();
                    return;
                }

                console.log(
                    `[perf-monitor] 🔍 周期轮询：发现 ${stale.length} 条数据，尝试发送...`
                );

                const body = JSON.stringify(stale);
                const res = await fetch(config.url, {
                    method: 'POST',
                    body,
                    keepalive: true,
                    headers: { 'Content-Type': 'application/json' },
                });

                if (res.ok) {
                    await clearDB();
                    console.log('[perf-monitor] ✅ 周期轮询补发成功，DB 已清空，停止轮询');
                    stopPeriodicRetry();
                } else {
                    console.warn(
                        `[perf-monitor] ⚠️ 周期轮询补发失败 (HTTP ${res.status})，下次继续尝试`
                    );
                }
            } catch (err) {
                console.warn(
                    '[perf-monitor] ⚠️ 周期轮询网络异常:',
                    (err as Error).message,
                    '— 服务端可能仍未恢复'
                );
            }
        }, RETRY_INTERVAL);
    }

    /**
     * 停止周期轮询定时器
     */
    function stopPeriodicRetry(): void {
        if (retryTimerId !== null) {
            clearInterval(retryTimerId);
            retryTimerId = null;
            console.log('[perf-monitor] 🛑 周期轮询已停止');
        }
    }

    // ============================================================
    // replayStaleData — 补发 IndexedDB 中残留的历史数据
    // ============================================================

    async function replayStaleData(url: string): Promise<void> {
        try {
            const stale = await loadAllFromDB();
            console.log(
                `[perf-monitor] 📦 replayStaleData: DB 中有 ${stale.length} 条数据`
            );
            if (stale.length === 0) return;

            console.log(
                `[perf-monitor] ⏳ 检测到 ${stale.length} 条历史数据，开始补发...`,
            );

            const body = JSON.stringify(stale);

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    body,
                    keepalive: true,
                    headers: { 'Content-Type': 'application/json' },
                });

                if (res.ok) {
                    await clearDB();
                    console.log('[perf-monitor] ✅ 历史数据补发成功，DB 已清空');
                    stopPeriodicRetry(); // 补发成功，停止轮询
                } else {
                    console.warn(
                        `[perf-monitor] ⚠️ 历史数据补发失败 (HTTP ${res.status})，保留在 DB 中`,
                    );
                }
            } catch (err) {
                console.warn(
                    '[perf-monitor] ⚠️ 历史数据补发网络异常:',
                    (err as Error).message,
                );
            }
        } catch (e) {
            console.warn('[perf-monitor] DB 读取异常:', e);
        }
    }

    return send;
}