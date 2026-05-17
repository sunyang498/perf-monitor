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
}

// ============================================================
// 性能指标相关
// ============================================================

/** 我们关心的三种核心性能指标 */
export type MetricType = 'LCP' | 'FID' | 'CLS';

/** 一条性能指标的标准化数据结构 */
export interface MetricData {
    /** 指标类型 */
    type: MetricType;
    /** 指标值（LCP/FID 单位 ms，CLS 无单位） */
    value: number;
    /** 指标发生的页面 URL */
    pageUrl: string;
    /** 采集时间戳（毫秒） */
    timestamp: number;
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
