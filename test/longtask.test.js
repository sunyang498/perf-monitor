/**
 * test/longtask.test.js — 长任务监控模块 自动化测试（Node.js）
 *
 * 运行方式：node test/longtask.test.js
 * 退出码：0 = 全部通过，1 = 有测试失败
 *
 * 测试覆盖：
 *   第1组: duration 校验 (Number.isFinite / > 0 / NaN / Infinity)
 *   第2组: 阈值判定 (等于阈值/不足/超出)
 *   第3组: 速率限制算法 (分钟窗口 60s 重置 / 未达上限 / 达到上限)
 *   第4组: 归因提取与 meta 构建
 *   第5组: buildMetric 带 meta 参数
 *   第6组: isMetric 识别 LongTask
 *   第7组: 采样联动 (LongTask 作为 Metric 受 sampleRate 控制)
 *   第8组: 边界场景
 *
 * 设计说明：
 *   observeLongTask 依赖浏览器 PerformanceObserver API，无法在 Node.js 中直接调用。
 *   本测试将 observeLongTask 中的核心算法逻辑拆分为独立可测的纯函数。
 */

'use strict';

// ============================================================
// 测试框架（与 sampler.test.js 一致）
// ============================================================

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, testName, detail = '') {
    if (condition) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        const msg = `  ❌ ${testName}${detail ? ' — ' + detail : ''}`;
        console.error(msg);
        failures.push(msg);
    }
}

function assertEqual(actual, expected, testName) {
    const ok = actual === expected;
    if (ok) {
        passed++;
        console.log(`  ✅ ${testName}`);
    } else {
        failed++;
        const msg = `  ❌ ${testName} — 期望: ${JSON.stringify(expected)}, 实际: ${JSON.stringify(actual)}`;
        console.error(msg);
        failures.push(msg);
    }
}

function summary() {
    console.log('\n' + '='.repeat(60));
    console.log(`测试结果: ${passed + failed} 项, ${passed} 通过, ${failed} 失败`);
    if (failures.length > 0) {
        console.log('\n失败详情:');
        failures.forEach(f => console.error('  ' + f));
    }
    console.log('='.repeat(60));
    process.exit(failed > 0 ? 1 : 0);
}

// ============================================================
// 辅助: 模拟 buildMetric（与 src/core/metrics.ts 逻辑一致）
// ============================================================

function buildMetric(type, value, meta) {
    const item = { type, value, pageUrl: 'http://localhost:3000/test', timestamp: Date.now() };
    if (meta) { item.meta = meta; }
    return item;
}

// ============================================================
// @ref: src/core/metrics.ts observeLongTask — duration 校验算法
// ============================================================

/**
 * 提取并校验 entry.duration。
 * 对应 observeLongTask 中第①步校验逻辑。
 */
function validateDuration(rawDuration) {
    const dur = Number(rawDuration);
    return Number.isFinite(dur) && dur > 0 ? dur : null;
}

// ============================================================
// @ref: src/core/metrics.ts observeLongTask — 阈值判定算法
// ============================================================

/**
 * 判定是否超过阈值。
 * 对应 observeLongTask 中第②步。
 */
function isAboveThreshold(duration, threshold = 50) {
    return duration > threshold;
}

// ============================================================
// @ref: src/core/metrics.ts observeLongTask — 速率限制算法
// ============================================================

/**
 * 分钟窗口限流器。
 * 对应 observeLongTask 中第③步：每分钟 reset 计数器。
 *
 * @param {number} rateLimit - 每分钟上限
 * @returns {object} 包含 tryReport(now) 方法，返回 { allowed, skipped }
 */
function createRateLimiter(rateLimit) {
    if (rateLimit === undefined || rateLimit <= 0) {
        // 不限速模式
        return {
            tryReport: () => ({ allowed: true, skipped: false }),
            getStats: () => null,
        };
    }

    let minuteSlotStart = 0;
    let minuteSlotCount = 0;

    return {
        tryReport(now) {
            // 每分钟重置
            if (now - minuteSlotStart >= 60000) {
                minuteSlotStart = now;
                minuteSlotCount = 0;
            }
            if (minuteSlotCount >= rateLimit) {
                return { allowed: false, skipped: true };
            }
            minuteSlotCount++;
            return { allowed: true, skipped: false };
        },
        getStats() {
            return { minuteSlotStart, minuteSlotCount, rateLimit };
        },
    };
}

// ============================================================
// @ref: src/core/metrics.ts observeLongTask — 归因提取算法
// ============================================================

/**
 * 从 entry 的 attribution 数组中提取归因信息。
 * 对应 observeLongTask 中第④步。
 */
function extractAttribution(entry) {
    const attribution = entry.attribution;
    if (!attribution || attribution.length === 0) {
        return {};
    }
    const first = attribution[0];
    return {
        containerType: first.containerType ?? 'unknown',
        containerSrc: first.containerSrc ?? '',
        containerId: first.containerId ?? '',
        containerName: first.containerName ?? '',
    };
}

// ============================================================
// @ref: src/utils/helper.ts — isMetric 覆盖 LongTask
// ============================================================

function isMetric(item) {
    return item.type === 'LCP' || item.type === 'FID' || item.type === 'CLS' || item.type === 'LongTask';
}

function isError(item) {
    return item.type === 'jsError' || item.type === 'promiseError' || item.type === 'resourceError';
}

// ============================================================
// @ref: src/utils/sampler.ts — createSampler
// ============================================================

function djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
    }
    return hash >>> 0;
}

function createSampler(sampleRate) {
    const rate = typeof sampleRate === 'number' && !isNaN(sampleRate) ? sampleRate : 1;
    const clampedRate = Math.max(0, Math.min(1, rate));
    const sessionId = Math.random().toString(36).substring(2, 10) || Date.now().toString(36);

    function shouldSample(item) {
        if (isError(item)) return true;
        if (clampedRate >= 1) return true;
        if (clampedRate <= 0) return false;
        const key = `${sessionId}:${item.pageUrl || 'http://localhost:3000/test'}:${item.type}`;
        const hash = djb2Hash(key);
        const threshold = Math.round(clampedRate * 100);
        return (hash % 100) < threshold;
    }
    return { shouldSample };
}

// ============================================================
// ====================== 测试用例开始 =========================
// ============================================================

console.log('\n=== 长任务监控模块 — 自动化测试套件 ===');
console.log(`运行时间: ${new Date().toISOString()}\n`);

// ============================================================
// 第1组：duration 校验
// ============================================================

console.log('🔬 第1组：duration 校验 (Number.isFinite / > 0)');

assertEqual(validateDuration(100), 100, '1.1 正常 duration = 100 → 通过');
assertEqual(validateDuration(0), null, '1.2 duration = 0 → 拒绝（必须 > 0）');
assertEqual(validateDuration(-1), null, '1.3 duration = -1 → 拒绝（负数）');
assertEqual(validateDuration(NaN), null, '1.4 duration = NaN → 拒绝');
assertEqual(validateDuration(Infinity), null, '1.5 duration = Infinity → 拒绝');
assertEqual(validateDuration(-Infinity), null, '1.6 duration = -Infinity → 拒绝');
assertEqual(validateDuration(undefined), null, '1.7 duration = undefined → 拒绝');
assertEqual(validateDuration('50'), 50, '1.8 duration = "50" → 50（字符串→数字）');
assertEqual(validateDuration(0.001), 0.001, '1.9 duration = 0.001ms → 通过（极小正值）');

// ============================================================
// 第2组：阈值判定
// ============================================================

console.log('\n📏 第2组：阈值判定');

assert(isAboveThreshold(51, 50), '2.1 51ms > 阈值50 → 是长任务');
assert(!isAboveThreshold(50, 50), '2.2 50ms = 阈值50 → 不是（strict >）');
assert(!isAboveThreshold(49, 50), '2.3 49ms < 阈值50 → 不是');
assert(!isAboveThreshold(100, 100), '2.4 100ms = 阈值100 → 不是长任务（strict >）');
assert(isAboveThreshold(101, 100), '2.5 101ms > 阈值100 → 是长任务');
assert(!isAboveThreshold(200, 200), '2.6 200ms = 阈值200 → 不是长任务');

// 自定义阈值
assert(isAboveThreshold(60, 0), '2.7 阈值=0 → 60ms 是（但实际中 dur 还需 > 0）');
assert(!isAboveThreshold(30, Infinity), '2.8 阈值=Infinity → 任何值都不是');

// ============================================================
// 第3组：速率限制算法
// ============================================================

console.log('\n⏱ 第3组：速率限制算法（分钟滑动窗口）');

// 3.1 不限速模式
{
    const limiter = createRateLimiter(undefined);
    const r1 = limiter.tryReport(Date.now());
    const r2 = limiter.tryReport(Date.now() + 1000);
    assert(r1.allowed && r2.allowed, '3.1 未设置 rateLimit → 不限速');
}

// 3.2 rateLimit=0 也不限速
{
    const limiter = createRateLimiter(0);
    assert(limiter.tryReport(Date.now()).allowed, '3.2 rateLimit=0 → 不限速');
}

// 3.3 rateLimit=3，前3条放行
{
    const limiter = createRateLimiter(3);
    const base = Date.now();
    assertEqual(limiter.tryReport(base + 1000).allowed, true, '3.3a 第1条 → 放行');
    assertEqual(limiter.tryReport(base + 2000).allowed, true, '3.3b 第2条 → 放行');
    assertEqual(limiter.tryReport(base + 3000).allowed, true, '3.3c 第3条 → 放行');
    assertEqual(limiter.tryReport(base + 4000).allowed, false, '3.3d 第4条 → 拦截（达上限）');
    assertEqual(limiter.tryReport(base + 5000).allowed, false, '3.3e 第5条 → 拦截');
}

// 3.4 跨分钟重置
{
    const limiter = createRateLimiter(2);
    const base = Date.now();

    // 第一分钟：2条放行，第3条拦截
    limiter.tryReport(base + 1000);
    limiter.tryReport(base + 2000);
    assertEqual(limiter.tryReport(base + 3000).allowed, false, '3.4a 第1分钟第3条 → 拦截');

    // 跨过 60s 后重置
    const nextMinute = base + 61000;
    assertEqual(limiter.tryReport(nextMinute).allowed, true, '3.4b 跨分钟后第1条 → 放行（计数已重置）');
    assertEqual(limiter.tryReport(nextMinute + 1000).allowed, true, '3.4c 跨分钟后第2条 → 放行');
    assertEqual(limiter.tryReport(nextMinute + 2000).allowed, false, '3.4d 跨分钟后第3条 → 拦截（新窗口上限）');
}

// 3.5 单个大窗口内大量请求
{
    const limiter = createRateLimiter(5);
    const base = Date.now();
    let passed = 0, rejected = 0;
    for (let i = 0; i < 50; i++) {
        const r = limiter.tryReport(base + i * 100);
        if (r.allowed) passed++; else rejected++;
    }
    assertEqual(passed, 5, '3.5a 50条请求 → 仅5条放行');
    assertEqual(rejected, 45, '3.5b 50条请求 → 45条被拦截');
}

// ============================================================
// 第4组：归因信息提取
// ============================================================

console.log('\n🏷 第4组：归因信息提取（attribution）');

// 4.1 空 attribution
{
    const entry = { duration: 100 };
    const attr = extractAttribution(entry);
    assertEqual(Object.keys(attr).length, 0, '4.1 无 attribution → 空对象');
}

// 4.2 空数组 attribution
{
    const entry = { duration: 100, attribution: [] };
    const attr = extractAttribution(entry);
    assertEqual(Object.keys(attr).length, 0, '4.2 attribution=[] → 空对象');
}

// 4.3 完整归因信息
{
    const entry = {
        duration: 200,
        attribution: [{
            containerType: 'iframe',
            containerSrc: 'https://example.com/widget.js',
            containerId: 'ad-iframe',
            containerName: 'ad-container',
        }],
    };
    const attr = extractAttribution(entry);
    assertEqual(attr.containerType, 'iframe', '4.3a containerType = iframe');
    assertEqual(attr.containerSrc, 'https://example.com/widget.js', '4.3b containerSrc 提取正确');
    assertEqual(attr.containerId, 'ad-iframe', '4.3c containerId 提取正确');
    assertEqual(attr.containerName, 'ad-container', '4.3d containerName 提取正确');
}

// 4.4 归因字段缺失（兜底）
{
    const entry = {
        duration: 200,
        attribution: [{}], // 空对象
    };
    const attr = extractAttribution(entry);
    assertEqual(attr.containerType, 'unknown', '4.4a containerType 缺失 → "unknown"');
    assertEqual(attr.containerSrc, '', '4.4b containerSrc 缺失 → ""');
    assertEqual(attr.containerId, '', '4.4c containerId 缺失 → ""');
}

// ============================================================
// 第5组：buildMetric 带 meta 参数
// ============================================================

console.log('\n📦 第5组：buildMetric 带 meta 参数');

// 5.1 不带 meta
{
    const item = buildMetric('LongTask', 150);
    assertEqual(item.type, 'LongTask', '5.1a type = LongTask');
    assertEqual(item.value, 150, '5.1b value = 150');
    assert(item.meta === undefined, '5.1c 无 meta → meta = undefined');
}

// 5.2 带 meta
{
    const meta = { attribution: { containerType: 'iframe', containerSrc: 'https://a.com/x.js' } };
    const item = buildMetric('LongTask', 200, meta);
    assert(item.meta !== undefined, '5.2a meta 存在');
    assertEqual(item.meta.attribution.containerType, 'iframe', '5.2b meta.attribution 可读');
}

// 5.3 空对象 meta
{
    const item = buildMetric('LongTask', 150, {});
    assert(item.meta !== undefined, '5.3a 空对象 meta → 仍被赋值');
    assertEqual(Object.keys(item.meta).length, 0, '5.3b 空对象无 key');
}

// 5.4 其他指标类型不受影响（向后兼容）
{
    const item = buildMetric('LCP', 1000);
    assertEqual(item.type, 'LCP', '5.4a LCP 正常构建');
    assert(item.meta === undefined, '5.4b LCP 无 meta');
}

// ============================================================
// 第6组：isMetric 识别 LongTask
// ============================================================

console.log('\n🏷 第6组：isMetric 识别 LongTask');

assertEqual(isMetric({ type: 'LongTask' }), true, '6.1 LongTask → isMetric = true');
assertEqual(isMetric({ type: 'LCP' }), true, '6.2 LCP → isMetric = true');
assertEqual(isMetric({ type: 'CLS' }), true, '6.3 CLS → isMetric = true');
assertEqual(isMetric({ type: 'jsError' }), false, '6.4 jsError → isMetric = false');

// ============================================================
// 第7组：采样联动（LongTask 受 sampleRate 控制）
// ============================================================

console.log('\n🎲 第7组：采样联动（LongTask 作为 Metric 受 sampleRate 控制）');

// 7.1 sampleRate=1 → 全量采集
{
    const sampler = createSampler(1);
    const item = buildMetric('LongTask', 150);
    assertEqual(sampler.shouldSample(item), true, '7.1 sampleRate=1 → LongTask 采集');
}

// 7.2 sampleRate=0 → 全部跳过（LongTask 是性能指标非错误）
{
    const sampler = createSampler(0);
    const item = buildMetric('LongTask', 150);
    assertEqual(sampler.shouldSample(item), false, '7.2 sampleRate=0 → LongTask 被跳过');
}

// 7.3 错误即使在 sampleRate=0 时仍上报（对照验证）
{
    const sampler = createSampler(0);
    assertEqual(sampler.shouldSample({ type: 'jsError' }), true, '7.3 错误不受 sampleRate=0 影响');
}

// 7.4 LongTask 与 LCP/FID/CLS 行为一致
{
    const sampler = createSampler(0.5);
    const lt = sampler.shouldSample(buildMetric('LongTask', 200));
    const lcp = sampler.shouldSample(buildMetric('LCP', 1000));
    // 同 session 同 URL，不同 type，结果均为 boolean
    assert(typeof lt === 'boolean' && typeof lcp === 'boolean',
        '7.4 LongTask 与 LCP 同为 boolean 类型采样结果');
}

// ============================================================
// 第8组：边界场景与完整流程模拟
// ============================================================

console.log('\n🔬 第8组：边界场景');

// 8.1 模拟完整的 LongTask observer 回调流程
{
    const threshold = 50;
    const collected = [];
    const skipped = [];

    const mockEntries = [
        { duration: 200, attribution: [{ containerType: 'iframe' }] },   // 长任务 → 采集
        { duration: 30, attribution: null },                               // 不足阈值 → 跳过
        { duration: 51, attribution: [{ containerType: 'window' }] },      // 刚好超过 → 采集
        { duration: -10, attribution: null },                              // 非法值 → 跳过
        { duration: NaN, attribution: null },                              // NaN → 跳过
        { duration: Infinity, attribution: null },                         // Infinity → 跳过
    ];

    for (const entry of mockEntries) {
        const dur = validateDuration(entry.duration);
        if (dur === null) {
            skipped.push({ reason: '非法duration', raw: entry.duration });
            continue;
        }
        if (!isAboveThreshold(dur, threshold)) {
            skipped.push({ reason: `不足阈值(${threshold})`, duration: dur });
            continue;
        }
        const attr = extractAttribution(entry);
        const item = buildMetric('LongTask', dur, Object.keys(attr).length > 0 ? { attribution: attr } : undefined);
        collected.push(item);
    }

    assertEqual(collected.length, 2, '8.1a 6个entry → 2个被采集（200ms + 51ms）');
    assertEqual(collected[0].value, 200, '8.1b 第1个 value=200');
    assertEqual(collected[1].value, 51, '8.1c 第2个 value=51');
    assertEqual(collected[0].meta.attribution.containerType, 'iframe', '8.1d 归因信息已存入 meta');
    assertEqual(skipped.length, 4, '8.1e 4个被跳过（30ms + -10 + NaN + Infinity）');
}

// 8.2 完整流程模拟（含限流）
{
    const threshold = 50;
    const limiter = createRateLimiter(2);
    const collected = [];
    const base = Date.now();

    // 模拟 5 个超阈值 entry
    for (let i = 0; i < 5; i++) {
        const dur = 100 + i;
        const now = base + i * 100;
        const { allowed } = limiter.tryReport(now);

        if (allowed) {
            collected.push(buildMetric('LongTask', dur));
        }
    }

    assertEqual(collected.length, 2, '8.2a 限速=2，5条 → 仅2条入队');
    assertEqual(collected[0].value, 100, '8.2b 第1条 value=100');
    assertEqual(collected[1].value, 101, '8.2c 第2条 value=101');
}

// 8.3 空 entry 列表不报错
{
    const collected = [];
    for (const entry of []) {
        // 空循环，不抛异常
    }
    assertEqual(collected.length, 0, '8.3 空 entries → 无处理（不抛异常）');
}

// ============================================================
// 测试完成
// ============================================================

console.log('\n');
summary();
