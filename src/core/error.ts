import { ErrorData } from "../types";
import { addToQueue } from "../transport/queue";

export function listenJSError(): void {
    window.addEventListener('error', (event: Event) => {
        if (event instanceof ErrorEvent) {
            const item: ErrorData = {
                type: 'jsError',
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack,
                timestamp: Date.now(),
            };
            addToQueue(item);
        }
    }, true);
}

export function listenResourceError(): void {
    window.addEventListener('error', (event: Event) => {
        if (event instanceof ErrorEvent) return
        const target = event.target as HTMLElement;
        const url: string =
            (target as HTMLImageElement).src ||
            (target as HTMLScriptElement).src ||
            (target as HTMLLinkElement).href ||
            '未知资源';

        const item: ErrorData = {
            type: 'resourceError',
            message: `加载 ${target.tagName} 失败: ${url}`,
            filename: url,
            timestamp: Date.now(),
        };
        addToQueue(item);
    }, true);
}

export function listenPromiseError(): void {
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason
        let message: string
        let stack: string | undefined
        if (reason instanceof Error) {
            message = reason.message
            stack = reason.stack
        } else {
            message = String(reason)
        }
        const item: ErrorData = {
            type: 'promiseError',
            message,
            stack,
            timestamp: Date.now(),
        };
        addToQueue(item);
    });
}