

// unload.ts — 页面卸载兜底
//
// 两个事件、两条路径：
//   visibilitychange → 走正常 flush（异步 sender + 重试）
//   pagehide        → 走快速通道（同步 drainQueue + 写 DB + sendBeacon）
//   pagehide 不能用异步 sender，因为页面销毁时 setTimeout/Promise 会被取消

let normalFlushFn: (() => void) | null = null
let urgentFlushFn: (() => void) | null = null
let flushed = false

export function setupUnload(
    normalFlush: () => void,
    urgentFlush: () => void,
): void {
    normalFlushFn = normalFlush
    urgentFlushFn = urgentFlush

    // visibilitychange：切 Tab / 锁屏 → 走正常 flush（有重试）
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            doFlush()
        } else {
            flushed = false
        }
    })

    // pagehide：页面确定要销毁 → 走快速通道
    window.addEventListener('pagehide', () => {
        if (urgentFlushFn) {
            urgentFlushFn()
        }
    })
}

function doFlush() {
    if (flushed || !normalFlushFn) return
    flushed = true
    normalFlushFn()
}