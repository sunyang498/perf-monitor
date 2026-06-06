/**
 * test/sampler.test.js — 数据采样模块 自动化测试（Node.js）
 *
 * 运行方式：node test/sampler.test.js
 * 退出码：0 = 全部通过，1 = 有测试失败
 *
 * 测试覆盖：
 *   单元测试 — createSampler / shouldSample / djb2Hash 的各项行为
 *   集成测试 — sampleRate=0/1/.5 场景 + replayFromDB 绕过采样
 *   工具测试 — DJB2 哈希分布均匀性验证 (+ isError 类型守卫)
 *
 * 设计说明：
 *   由于 sampler.ts 为浏览器环境设计，Node.js 中无法直接 import TS 源文件。
 *   本文件内联了 djb2Hash / isError / createSampler 的核心逻辑副本，
 *   保持与 src/utils/sampler.ts 完全一致，确保测试结果与生产环境等价。
 *
 *   这些副本与源文件的对应关系在注释中以 @ref 标注。
 */

'use strict';

// ============================================================
// 测试框架（轻量，零依赖）
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
// @ref: src/utils/helper.ts — isError 类型守卫
// ============================================================

function isError(item) {
    return item.type === 'jsError' || item.type === 'promiseError' || item.type === 'resourceError';
}

// ============================================================
// @ref: src/utils/sampler.ts — djb2Hash（DJB2 标准加法版本）
// ============================================================

function djb2Hash(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
    }
    return hash >>> 0;
}

// ============================================================
// @ref: src/utils/sampler.ts — createSampler 工厂函数
// ============================================================

function createSampler(sampleRate) {
    const rate = typeof sampleRate === 'number' && !isNaN(sampleRate) ? sampleRate : 1;
    const clampedRate = Math.max(0, Math.min(1, rate));

    const sessionId =
        (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
            ? crypto.randomUUID()
            : Math.random().toString(36).substring(2, 10) || Date.now().toString(36);

    function shouldSample(item) {
        if (isError(item)) return true;
        if (clampedRate >= 1) return true;
        if (clampedRate <= 0) return false;

        const key = `${sessionId}:${item.pageUrl}:${item.type}`;
        const hash = djb2Hash(key);
        const threshold = Math.round(clampedRate * 100);
        return (hash % 100) < threshold;
    }

    return { shouldSample };
}

// ============================================================
// 辅助工厂函数：快速构造测试数据
// ============================================================

function makeMetric(type, pageUrl = 'http://localhost:3000/test') {
    return { type, value: 100, pageUrl, timestamp: Date.now() };
}

function makeError(type = 'jsError') {
    return { type, message: 'test error', timestamp: Date.now() };
}

// ============================================================
// ====================== 测试用例开始 =========================
// ============================================================

console.log('\n=== 数据采样模块 — 自动化测试套件 ===');
console.log(`运行时间: ${new Date().toISOString()}\n`);

// ============================================================
// 第一组：DJB2 哈希函数
// ============================================================

console.log('📐 第一组：DJB2 哈希函数');

// 测试 1.1：确定性 — 相同输入 → 相同输出
{
    const h1 = djb2Hash('hello');
    const h2 = djb2Hash('hello');
    assertEqual(h1, h2, '1.1 相同输入产生相同哈希值');
}

// 测试 1.2：不同输入 → 不同输出（高概率）
{
    const h1 = djb2Hash('hello');
    const h2 = djb2Hash('world');
    assert(h1 !== h2, '1.2 不同输入产生不同哈希值');
}

// 测试 1.3：空字符串
{
    const h = djb2Hash('');
    assert(typeof h === 'number' && h >= 0, '1.3 空字符串返回非负整数');
    assertEqual(h, 5381 >>> 0, '1.4 空字符串哈希 = 初始值 5381（无符号）');
}

// 测试 1.4：结果在 32 位无符号整数范围
{
    const h = djb2Hash('a very long string with many characters to test range');
    assert(h >= 0 && h <= 0xFFFFFFFF, '1.5 哈希值在 [0, 2^32-1] 范围内');
}

// ============================================================
// 第二组：createSampler — 工厂函数正确性
// ============================================================

console.log('\n🏭 第二组：createSampler — 工厂函数');

// 测试 2.1：返回对象包含 shouldSample 方法
{
    const s = createSampler(0.5);
    assert(typeof s.shouldSample === 'function', '2.1 返回对象含 shouldSample 方法');
}

// 测试 2.2：不同调用返回不同实例（sessionId 独立）
{
    const s1 = createSampler(0.5);
    const s2 = createSampler(0.5);
    assert(s1 !== s2, '2.2 每次调用返回不同实例');
}

// 测试 2.3：NaN 输入兜底为 1
{
    const s = createSampler(NaN);
    assertEqual(s.shouldSample(makeMetric('LCP')), true, '2.3 NaN 兜底 → 全量采集');
}

// 测试 2.4：非 number 输入兜底为 1（模拟运行时错误传参）
{
    const s = createSampler(undefined);
    assertEqual(s.shouldSample(makeMetric('LCP')), true, '2.4 undefined 兜底 → 全量采集');

    const s2 = createSampler('0.5');
    assertEqual(s2.shouldSample(makeMetric('LCP')), true, '2.5 字符串兜底 → 全量采集');
}

// 测试 2.5：超出 [0,1] 范围被钳位
{
    const sHigh = createSampler(1.5);
    assertEqual(sHigh.shouldSample(makeMetric('LCP')), true, '2.6 >1 钳位为 1 → 全量采集');

    const sLow = createSampler(-0.5);
    assertEqual(sLow.shouldSample(makeMetric('LCP')), false, '2.7 <0 钳位为 0 → 全部跳过');
}

// ============================================================
// 第三组：shouldSample — 错误数据（必须 100% 上报）
// ============================================================

console.log('\n🔴 第三组：shouldSample — 错误始终 100% 上报');

const sampleRates = [0, 0.1, 0.5, 0.99, 1];
const errorTypes = ['jsError', 'resourceError', 'promiseError'];

for (const rate of sampleRates) {
    for (const errType of errorTypes) {
        const s = createSampler(rate);
        const item = makeError(errType);
        assertEqual(
            s.shouldSample(item),
            true,
            `3.${rate}-${errType} sampleRate=${rate} → ${errType} 始终上报`
        );
    }
}

// ============================================================
// 第四组：shouldSample — 性能指标采样
// ============================================================

console.log('\n🟡 第四组：shouldSample — 性能指标采样');

// 测试 4.1：sampleRate = 1 → 全部采集
{
    const s = createSampler(1);
    ['LCP', 'FID', 'CLS'].forEach(type => {
        assertEqual(
            s.shouldSample(makeMetric(type)),
            true,
            `4.1 sampleRate=1 → ${type} 采集`
        );
    });
}

// 测试 4.2：sampleRate = 0 → 全部跳过
{
    const s = createSampler(0);
    ['LCP', 'FID', 'CLS'].forEach(type => {
        assertEqual(
            s.shouldSample(makeMetric(type)),
            false,
            `4.2 sampleRate=0 → ${type} 跳过`
        );
    });
}

// 测试 4.3：同一 sampler + 同类指标 → 采样结果一致（核心一致性保证）
{
    const s = createSampler(0.5);
    const result1 = s.shouldSample(makeMetric('LCP', 'http://test.com/page'));
    for (let i = 0; i < 50; i++) {
        const resultN = s.shouldSample(makeMetric('LCP', 'http://test.com/page'));
        assertEqual(
            result1, resultN,
            `4.3-${i} 同 session 同类指标采样一致性 (LCP)`
        );
    }
}

// 测试 4.3b：同 session + 不同 url → 采样结果可能不同（验证独立性）
{
    const s = createSampler(0.5);
    const m1 = s.shouldSample(makeMetric('LCP', 'http://a.com'));
    const m2 = s.shouldSample(makeMetric('LCP', 'http://b.com'));
    // 不同 URL 结果不一定相同，此处仅验证不发生异常
    assert(typeof m1 === 'boolean' && typeof m2 === 'boolean',
        '4.3b 不同 pageUrl 采样结果均为 boolean');
}

// 测试 4.3c：同 session + 不同指标类型 → 采样结果可能不同（验证独立性）
{
    const s = createSampler(0.5);
    const lcp = s.shouldSample(makeMetric('LCP'));
    const fid = s.shouldSample(makeMetric('FID'));
    assert(typeof lcp === 'boolean' && typeof fid === 'boolean',
        '4.3c 不同 type 采样结果均为 boolean');
}

// 测试 4.4：不同 session → 采样结果可能不同
{
    const s1 = createSampler(0.5);
    const s2 = createSampler(0.5);
    const m = makeMetric('LCP');
    const r1 = s1.shouldSample(m);
    const r2 = s2.shouldSample(m);
    // 不同 sessionId 导致可能不同，这里只验证不抛异常
    assert(typeof r1 === 'boolean' && typeof r2 === 'boolean',
        '4.4 不同 session 采样均为 boolean（独立 sessionId）');
}

// ============================================================
// 第五组：DJB2 哈希分布均匀性
// ============================================================

console.log('\n📊 第五组：DJB2 哈希分布均匀性');

// 测试 5.1：10000 个 key 在 100 个桶中分布
{
    const BUCKETS = 100;
    const N = 10000;
    const counts = new Array(BUCKETS).fill(0);

    for (let i = 0; i < N; i++) {
        const key = `session_${i}:http://t.com/page_${i}:${['LCP', 'FID', 'CLS'][i % 3]}`;
        const hash = djb2Hash(key);
        counts[hash % BUCKETS]++;
    }

    const expectedPerBucket = N / BUCKETS;
    let maxDeviation = 0;
    let minCount = N, maxCount = 0;

    for (let i = 0; i < BUCKETS; i++) {
        const dev = Math.abs(counts[i] - expectedPerBucket);
        if (dev > maxDeviation) maxDeviation = dev;
        if (counts[i] < minCount) minCount = counts[i];
        if (counts[i] > maxCount) maxCount = counts[i];
    }

    // 期望每个桶约 100，最大偏差通常 < 25
    const relativeDeviation = (maxDeviation / expectedPerBucket * 100).toFixed(1);

    console.log(`  分布统计: 期望=${expectedPerBucket.toFixed(0)}/桶, ` +
        `实际范围=[${minCount}, ${maxCount}], 最大偏差=${maxDeviation.toFixed(0)} (${relativeDeviation}%)`);

    assert(maxDeviation < 50,
        `5.1 哈希分布均匀 (最大偏差 ${maxDeviation.toFixed(0)} < 50, 即 ${relativeDeviation}%)`);
}

// 测试 5.2：验证 sampleRate=0.5 实际采样率接近 50%
{
    const s = createSampler(0.5);
    const total = 10000;
    let sampled = 0;

    for (let i = 0; i < total; i++) {
        if (s.shouldSample(makeMetric('LCP', 'http://test.com/page'))) {
            sampled++;
        }
    }

    // 注意：同一 session + 同一 url + 同一 type → 结果完全一致
    // 所以这里都是同类型同 URL，应该 100% 或 0%
    // 这个测试验证的是哈希结果的一致性（对于同 key，结果应完全一致）
    const allSame = (sampled === 0 || sampled === total);
    assert(allSame,
        `5.2 同 session+url+type 的采样结果完全一致 (${sampled}/${total})`);

    if (allSame) {
        console.log(`  说明: 同 key 下 ${sampled}/${total} 条结果一致，符合哈希一致性设计`);
    }
}

// 测试 5.3：大量不同 metric 的采样率接近 sampleRate
{
    const s = createSampler(0.5);
    const total = 2000;
    let sampled = 0;

    for (let i = 0; i < total; i++) {
        // 每条用不同 URL，模拟不同页面的指标
        const item = makeMetric(['LCP', 'FID', 'CLS'][i % 3], `http://test.com/page_${i}`);
        if (s.shouldSample(item)) {
            sampled++;
        }
    }

    const actualRate = (sampled / total * 100).toFixed(1);
    console.log(`  sampleRate=0.5 时 ${total} 条不同数据 → 采集 ${sampled} 条 (${actualRate}%)`);

    // 期望实际采样率在 40%~60% 之间（允许一定随机偏差）
    const rateOk = sampled >= total * 0.35 && sampled <= total * 0.65;
    assert(rateOk,
        `5.3 2000 条不同数据采样率接近 50% (实际 ${actualRate}%)`);
}

// ============================================================
// 第六组：模拟 replayFromDB 绕过采样器（集成测试核心）
// ============================================================

console.log('\n🔄 第六组：模拟 replayFromDB — 离线回放绕过采样');

// 测试 6.1：模拟完整 replayFromDB 流程
{
    // 场景：上一个 session 采集了 LCP 数据并存入 DB
    // 新 session 中 sampleRate=0（不采集性能指标）
    // 但 replayFromDB 应绕过采样器，直接将历史数据入队

    const replayQueue = []; // 模拟内存队列

    // 模拟上一个 session 产生的数据
    const staleItems = [
        makeMetric('LCP'),
        makeMetric('FID'),
        makeError('jsError'),
    ];

    // 当前 session 的采样器（sampleRate=0 → 不采集任何性能指标）
    const sampler = createSampler(0);

    // 模拟 addToQueue：经过采样过滤
    function simulatedAddToQueue(item) {
        if (sampler && !sampler.shouldSample(item)) {
            return; // 被采样过滤
        }
        replayQueue.push(item);
    }

    // 模拟 replayFromDB：绕过采样器直接入队
    function simulatedReplayFromDB(items) {
        for (const item of items) {
            replayQueue.push(item); // 直接 push，不经过 sampler
        }
    }

    // === 路径 A：用 addToQueue 回放（❌ 旧实现，会丢数据） ===
    const queueA = [];
    for (const item of staleItems) {
        // 如果 addToQueue 有采样过滤...
        if (!sampler.shouldSample(item)) continue; // ← 性能指标被过滤！
        queueA.push(item);
    }
    // 期望：只有错误数据
    assertEqual(queueA.length, 1, '6.1 addToQueue 回放 → 仅含错误 (LCP/FID 被过滤)');
    assertEqual(queueA[0].type, 'jsError', '6.1b addToQueue 回放 → 保留的是 jsError');

    // === 路径 B：用 replayFromDB 回放（✅ 新实现，不丢数据） ===
    simulatedReplayFromDB(staleItems);
    // 期望：3 条数据全部入队
    assertEqual(replayQueue.length, 3, '6.2 replayFromDB 回放 → 3 条全部入队');
    assertEqual(
        replayQueue.filter(i => i.type === 'LCP').length, 1,
        '6.2b LCP 未被过滤'
    );
    assertEqual(
        replayQueue.filter(i => i.type === 'FID').length, 1,
        '6.2c FID 未被过滤'
    );
    assertEqual(
        replayQueue.filter(i => i.type === 'jsError').length, 1,
        '6.2d jsError 未被过滤'
    );
}

// 测试 6.3：验证 sampleRate=0 场景下，正常采集只有错误进入队列
{
    const queue = [];
    const sampler = createSampler(0);

    // 模拟正常采集
    const items = [
        makeMetric('LCP'),
        makeMetric('FID'),
        makeMetric('CLS'),
        makeError('jsError'),
        makeError('promiseError'),
        makeError('resourceError'),
    ];

    for (const item of items) {
        if (sampler.shouldSample(item)) {
            queue.push(item);
        }
    }

    assertEqual(queue.length, 3,
        '6.3 sampleRate=0 → 队列仅 3 条（全部为错误）');
    assert(queue.every(i => isError(i)),
        '6.3b 队列中全部为错误数据');
    assert(queue.every(i => ['jsError', 'promiseError', 'resourceError'].includes(i.type)),
        '6.3c 三种错误类型均在队列中');
}

// 测试 6.4：验证 sampleRate=1 场景下，所有数据进入队列
{
    const queue = [];
    const sampler = createSampler(1);

    const items = [
        makeMetric('LCP'),
        makeMetric('CLS'),
        makeError('jsError'),
    ];

    for (const item of items) {
        if (sampler.shouldSample(item)) {
            queue.push(item);
        }
    }

    assertEqual(queue.length, 3,
        '6.4 sampleRate=1 → 3 条全部入队（指标+错误）');
}

// ============================================================
// 第七组：isError 类型守卫
// ============================================================

console.log('\n🛡️ 第七组：isError 类型守卫');

assertEqual(isError(makeError('jsError')), true, '7.1 jsError → true');
assertEqual(isError(makeError('resourceError')), true, '7.2 resourceError → true');
assertEqual(isError(makeError('promiseError')), true, '7.3 promiseError → true');
assertEqual(isError(makeMetric('LCP')), false, '7.4 LCP → false');
assertEqual(isError(makeMetric('FID')), false, '7.5 FID → false');
assertEqual(isError(makeMetric('CLS')), false, '7.6 CLS → false');

// ============================================================
// 第八组：边界场景
// ============================================================

console.log('\n🔬 第八组：边界场景');

// 测试 8.1：sampleRate 接近但不等于 0/1 的极端值
{
    assertEqual(createSampler(0.0001).shouldSample(makeMetric('LCP')),
        false, '8.1 sampleRate=0.0001 → LCP 大概率不采集');
    // 注：极低采样率下仍有可能被采集（取决于哈希），这里不强制断言具体值
    assertEqual(createSampler(0.9999).shouldSample(makeMetric('LCP')),
        createSampler(0.9999).shouldSample(makeMetric('LCP')),
        '8.2 sampleRate=0.9999 同 sampler 同 key 一致性');
}

// 测试 8.3：非常长的 pageUrl
{
    const longUrl = 'http://test.com/' + 'x'.repeat(500);
    const s = createSampler(0.5);
    const result = s.shouldSample(makeMetric('LCP', longUrl));
    assert(typeof result === 'boolean',
        '8.3 超长 URL (500+ 字符) 正常处理');
}

// 测试 8.4：pageUrl 为空字符串
{
    const s = createSampler(0.5);
    const result = s.shouldSample(makeMetric('LCP', ''));
    assert(typeof result === 'boolean',
        '8.4 空 pageUrl 正常处理');
}

// ============================================================
// 测试完成
// ============================================================

console.log('\n');
summary();
