

let flushFn: (() => void) | null = null
let flushed = false

export function setupUnload(flush: () => void): void {
    flushFn = flush
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            doFlush()
        } else {
            flushed = false
        }
    })
    window.addEventListener('pagehide', () => doFlush())
}

function doFlush() {
    if (flushed || !flushFn) return
    flushed = true
    flushFn()
}