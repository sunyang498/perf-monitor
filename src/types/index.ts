// types/index.ts — SDK 所有公共类型定义
// 这里定义接口、枚举和类型别名，是整个项目的"契约层"

// ============================================================
// 配置相关
// ============================================================

/**
 * 用户初始化 SDK 时传入的配置项
 * 对应 PerfMonitor.init({ ... }) 的参数
 */
export interface PerfMonitorConfig {
    /** 上报地址，如 '/report' */
    url: string;
    /** 批量队列达到多少条时立即发送，默认 5 */
    batchSize?: number;
    /** 定时发送间隔（毫秒），默认 5000 */
    flushInterval?: number;
    /** 相同错误去重的时间窗口（毫秒），默认 10000 */
    errorDedupWindow?: number;
    /** 数据采样率（0-1），默认 1（100%上报）。例如 0.5 表示只采集 50% 的性能指标数据，错误始终 100% 上报 */
    sampleRate?: number;
    /** 长任务判定阈值（毫秒），默认 50。entry.duration > 此值才视为长任务并上报 */
    longTaskThreshold?: number;
    /** 长任务每分钟最大上报条数，默认无限制。用于控制 LongTask 高频触发场景的下数据量 */
    longTaskRateLimit?: number;
    /** 是否开启调试日志，默认 false。开启后会在控制台输出采样过滤、归因等调试信息 */
    debug?: boolean;
}

// ============================================================
// 性能指标相关
// ============================================================

/** 我们关心的核心性能指标 */
export type MetricType = 'LCP' | 'FID' | 'CLS' | 'LongTask';

/** 一条性能指标的标准化数据结构 */
export interface MetricData {
    /** 指标类型 */
    type: MetricType;
    /** 指标值（LCP/FID/LongTask 单位 ms，CLS 无单位） */
    value: number;
    /** 指标发生的页面 URL */
    pageUrl: string;
    /** 采集时间戳（毫秒） */
    timestamp: number;
    /** 扩展元数据，如 LongTask 的归因信息等。向后兼容，可选字段 */
    meta?: Record<string, unknown>;
}

// ============================================================
// 错误相关
// ============================================================

/** 错误类型枚举 */
export type ErrorType = 'jsError' | 'resourceError' | 'promiseError';

/** 一条错误的标准化数据结构 */
export interface ErrorData {
    /** 错误类型 */
    type: ErrorType;
    /** 错误消息或描述 */
    message: string;
    /** 出错的文件 URL */
    filename?: string;
    /** 出错行号 */
    lineno?: number;
    /** 出错列号 */
    colno?: number;
    /** 错误堆栈 */
    stack?: string;
    /** 采集时间戳 */
    timestamp: number;
}

// ============================================================
// 传输 / 队列相关
// ============================================================

/** 队列中存放的数据项，可能是指标或错误 */
export type TransportItem = MetricData | ErrorData;

/**
 * 获取 item 类型的标签，方便接收端区分
 */
export type ItemKind = 'metric' | 'error';

/** 队列刷新时的回调 */
export type FlushCallback = (items: TransportItem[]) => void;

// ============================================================
// 采样相关
// ============================================================

/**
 * 采样器接口，由 createSampler() 工厂函数创建。
 * 判断一条数据是否应被采集上报——错误始终 true，性能指标按 sampleRate 判定。
 */
export interface Sampler {
    /**
     * 判断一条数据是否应该被采集上报。
     * - 错误数据始终返回 true（100% 上报）
     * - 性能指标按 sampleRate 判定
     */
    shouldSample: (item: TransportItem) => boolean;
}
