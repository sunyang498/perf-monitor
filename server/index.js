import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const DATA_FILE = path.join(__dirname, 'data.json');

// ============================================================
// 中间件
// ============================================================

app.use(cors());
app.use(express.json());

// 托管静态文件：同时兼容 Live Server(../dist/) 和 Express(/perf-monitor.js)
const rootDir = path.resolve(__dirname, '..');
app.use(express.static(path.join(rootDir, 'dist')));
app.use('/dist', express.static(path.join(rootDir, 'dist')));
app.use(express.static(path.join(rootDir, 'test')));

// 默认首页 → 测试页面
app.get('/', (_req, res) => {
    res.sendFile(path.join(rootDir, 'test', 'index.html'));
});

// ============================================================
// API 路由
// ============================================================

app.post('/report', (req, res) => {
    const items = req.body;
    console.log(`收到 ${items.length} 条上报数据`);
    const existing = readData();
    existing.push(...items);
    writeData(existing);
    res.json({ success: true });
});

app.get('/report/data', (req, res) => {
    res.json(readData());
});

app.listen(3001, () => {
    console.log('perf-monitor 接收服务: http://localhost:3001');
});

function readData() {
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    } catch {
        return [];
    }
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}