'use strict';
const express   = require('express');
const router    = express.Router();
const monitor   = require('../monitor');
const reporter  = require('../reporter');
const dataStore = require('../dataStore');
const birdeye   = require('../birdeye');

router.get('/dashboard', (_req, res) => res.json({
  tokens: monitor.getTokens(),
  dryRun: monitor.DRY_RUN,
}));

// ★ V5-20: 实时诊断接口 —— 检查 OHLCV 实时刷新是否生效
router.get('/diag', (_req, res) => {
  const ohlcvStats = birdeye.getOhlcvCacheStats();
  const tokens = monitor.getTokens();
  // 抽样 5 个币看 K 线源
  const sample = tokens.slice(0, 5).map(t => ({
    symbol: t.symbol,
    address: t.address.slice(0, 8) + '...',
    closedCount: t.closedCount,
    candleStats: t.candleStats,
  }));
  res.json({
    serverTime: new Date().toISOString(),
    env: {
      OHLCV_REALTIME_ENABLED: process.env.OHLCV_REALTIME_ENABLED || '(unset, default true)',
      OHLCV_REFRESH_SEC: process.env.OHLCV_REFRESH_SEC || '(unset, default 30)',
      OHLCV_REALTIME_BARS: process.env.OHLCV_REALTIME_BARS || '(unset, default 120)',
      LOG_LEVEL: process.env.LOG_LEVEL || '(unset, default info)',
    },
    callStats: monitor.getCallStats(),
    ohlcvCache: ohlcvStats,
    tokenCount: tokens.length,
    tokenSample: sample,
  });
});

router.get('/tokens', (_req, res) => res.json(monitor.getTokens()));

// ── 手动添加代币（必须在 /tokens/:address 之前，避免 :address 匹配 "add"）──
router.post('/tokens/add', async (req, res) => {
  const { address, symbol } = req.body || {};
  if (!address) {
    return res.status(400).json({ error: '缺少 address' });
  }
  // ★ V5-16: symbol 自动匹配 —— 没传就从 Birdeye 查
  let sym = symbol;
  if (!sym) {
    try {
      sym = await birdeye.getSymbol(address);
    } catch (_) {}
  }
  if (!sym) sym = address.slice(0, 6); // 兜底
  const added = await monitor.addToken(address, sym, { network: 'solana', source: 'manual' });
  if (!added) {
    return res.status(409).json({ error: '代币已在监控中', address });
  }
  res.json({ ok: true, address, symbol: sym });
});

router.get('/tokens/:address', (req, res) => {
  const t = monitor.getToken(req.params.address);
  if (!t) return res.status(404).json({ error: 'not found' });
  res.json(t);
});

router.delete('/tokens/:address', async (req, res) => {
  await monitor.removeToken(req.params.address, 'manual_delete');
  res.json({ ok: true });
});

// ★ 手动重拉历史K线（Birdeye 429 导致某些币历史K线为空时使用）
router.post('/tokens/:address/refetch-history', (req, res) => {
  const result = monitor.refetchHistory(req.params.address);
  if (!result.ok) return res.status(404).json(result);
  res.json(result);
});

router.get('/trades', (_req, res) => {
  const logs = monitor.getTokens().flatMap(t => t.tradeLogs || []);
  logs.sort((a, b) => b.ts - a.ts);
  res.json(logs.slice(0, 200));
});

router.get('/trade-records', (_req, res) => {
  res.json(monitor.getAllTradeRecords());
});

// 持久化数据统计
router.get('/data-stats', (_req, res) => {
  const files = dataStore.listTickFiles();
  const trades = dataStore.loadTrades();
  const signals = dataStore.loadSignals();
  res.json({
    tickFiles: files.length,
    totalTicks: files.reduce((s, f) => s + Math.floor(f.size / 50), 0),
    tradeCount: trades.length,
    signalCount: signals.length,
    dataDir: dataStore.DATA_DIR,
  });
});

// 信号历史
router.get('/signals', (req, res) => {
  const limit = parseInt(req.query.limit || '100', 10);
  const signals = dataStore.loadSignals();
  res.json(signals.slice(-limit));
});

router.get('/reports', (_req, res) => res.json(reporter.listReports()));

module.exports = router;
