import { MetricData, ErrorData, MetricType, ErrorType, TransportItem } from '../types';

export function isMetric(item: TransportItem): item is MetricData {
    return item.type === 'LCP' || item.type === 'FID' || item.type === 'CLS';
}

export function isError(item: TransportItem): item is ErrorData {
    return item.type === 'jsError' || item.type === 'promiseError' || item.type === 'resourceError';
}