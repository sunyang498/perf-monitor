// storage.ts — IndexedDB 离线队列持久化
// 将未发送的上报数据存入 IndexedDB，页面关闭/离线不丢数据，下次打开自动补发。
//
// 架构决策：
// ① 每条记录存一个批量（items 数组），而非逐条存 —— 减少事务开销
// ② 自增主键保证写入顺序，补发时按 FIFO 顺序取出
// ③ Promise 封装所有事件回调，提供 async/await 风格的 API

import type { TransportItem } from '../types';

// ============================================================
// 常量
// ============================================================

const DB_NAME = 'perf-monitor-db';
const DB_VERSION = 1;
const STORE_NAME = 'pending-reports';

/** 单条记录的 Schema */
interface PendingRecord {
    id?: number;                // 自增主键（写入时可选，读取时必有）
    items: TransportItem[];     // 一批待发送数据
    timestamp: number;          // 写入时间
}

// ============================================================
// 数据库实例（单例缓存，避免重复 open）
// ============================================================

let dbInstance: IDBDatabase | null = null;

// ============================================================
// ① openDB — 打开/创建数据库
// ============================================================

/**
 * 打开 IndexedDB 数据库，首次调用时自动创建 ObjectStore。
 * 返回缓存的单例，避免重复连接。
 */
function openDB(): Promise<IDBDatabase> {
    // 已有实例直接返回
    if (dbInstance) return Promise.resolve(dbInstance);

    return new Promise<IDBDatabase>((resolve, reject) => {
        // SSR / 极端老浏览器可能没有 indexedDB
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB 不可用'));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        // --- onupgradeneeded：首次创建或版本升级时触发 ---
        // 这是唯一能创建/修改 ObjectStore 的地方
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // 防御：如果 ObjectStore 已存在（多 Tab 同时打开的情况），跳过创建
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, {
                    keyPath: 'id',
                    autoIncrement: true,
                });
                console.log('[perf-monitor] IndexedDB ObjectStore 已创建:', STORE_NAME);
            }
        };

        // --- onsuccess：数据库打开成功 ---
        request.onsuccess = (event) => {
            dbInstance = (event.target as IDBOpenDBRequest).result;

            // 数据库连接断开时（如用户清除浏览器数据），重置缓存
            dbInstance.onclose = () => {
                dbInstance = null;
            };

            resolve(dbInstance);
        };

        // --- onerror：打开失败（如隐私模式禁止 IndexedDB）---
        request.onerror = (event) => {
            reject((event.target as IDBOpenDBRequest).error);
        };
    });
}

// ============================================================
// ② saveToDB — 将一批数据写入 DB
// ============================================================

/**
 * 写入一批待发送数据到 IndexedDB。
 * 每条记录包含 items 数组和时间戳，一个 flush 批次对应一条 DB 记录。
 *
 * @returns Promise<void> — 写入完成时 resolve
 */
export async function saveToDB(items: TransportItem[]): Promise<void> {
    if (items.length === 0) return;

    const db = await openDB();

    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const record: PendingRecord = {
            items,
            timestamp: Date.now(),
        };

        const addRequest = store.add(record);

        addRequest.onsuccess = () => {
            console.log(
                `[perf-monitor] IndexedDB 已保存 ${items.length} 条数据`
            );
        };
        addRequest.onerror = () => reject(addRequest.error);

        // 事务完成时 resolve（不是 add 成功时，因为事务可能还未提交）
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============================================================
// ③ loadAllFromDB — 取出所有未发送数据（扁平化为 TransportItem[]）
// ============================================================

/**
 * 从 IndexedDB 读取所有未发送的上报数据，按写入顺序（自增 ID 升序）返回。
 * 返回的是所有记录的 items 扁平合并后的数组。
 *
 * @returns Promise<TransportItem[]> — 所有待补发数据
 */
export async function loadAllFromDB(): Promise<TransportItem[]> {
    const db = await openDB();

    return new Promise<TransportItem[]>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        const getAllRequest = store.getAll();

        getAllRequest.onsuccess = () => {
            const records: PendingRecord[] = getAllRequest.result;

            // 扁平化：把所有记录的 items 数组合并为一个数组
            // 按 ID 升序（记录本身已按自增主键排序），保证 FIFO
            const allItems: TransportItem[] = [];
            for (const record of records) {
                allItems.push(...record.items);
            }

            if (allItems.length > 0) {
                console.log(
                    `[perf-monitor] IndexedDB 读取到 ${allItems.length} 条待补发数据`
                );
            }

            resolve(allItems);
        };

        getAllRequest.onerror = () => reject(getAllRequest.error);
    });
}

// ============================================================
// ④ clearDB — 清空所有已发送的数据
// ============================================================

/**
 * 数据成功发送到服务端后，清空 IndexedDB 中的所有记录。
 *
 * @returns Promise<void>
 */
export async function clearDB(): Promise<void> {
    const db = await openDB();

    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);

        const clearRequest = store.clear();

        clearRequest.onsuccess = () => {
            console.log('[perf-monitor] IndexedDB 已清空');
        };
        clearRequest.onerror = () => reject(clearRequest.error);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// ============================================================
// ⑤ isSupported — 检测 IndexedDB 是否可用
// ============================================================

/**
 * 检测当前环境是否支持 IndexedDB。
 * 用于 SDK 初始化时决定是否启用离线持久化。
 */
export function isDBSupported(): boolean {
    return typeof indexedDB !== 'undefined';
}
