import type { ConfiguredStock } from './batch-config.ts';

export function renderDashboardPage(stocks: ConfiguredStock[], error: string | null = null): string {
  const initial = JSON.stringify({ stocks, error }).replaceAll('<', '\\u003c');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Will · 行情观察</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/assets/dashboard.css">
<script type="module" src="/assets/dashboard.js"></script></head>
<body><div class="app-shell"><aside class="sidebar"><a class="wordmark" href="/">Will<span>MARKET OBSERVATORY</span></a><div class="rail-caption">我的观察列表 <span id="watchlist-count">—</span></div><nav id="watchlist" aria-label="观察证券"></nav><div class="rail-note">东方财富公开行情<br>股票 · ETF<br><span>北京时间 / Asia·Shanghai</span></div></aside>
<main class="workspace"><header class="page-heading"><div><div class="eyebrow">WATCH THE MARKET. KEEP THE CONTEXT.</div><h1>行情观察<span id="market-date"></span></h1><p>价格、资金与日内走势，在同一个视野。</p></div><div class="refresh-panel"><span class="live-label"><i></i>每 30 秒刷新</span><button id="refresh-button" type="button">立即刷新 <span aria-hidden="true">↻</span></button><div id="refresh-status" role="status" aria-live="polite">正在读取行情…</div><div id="countdown" class="mono">—</div></div></header>
<div class="overview-line"><span id="summary">正在加载配置中的证券</span><span class="chart-legend"><i class="legend-price"></i>分钟价格 <i class="legend-reference"></i>昨收</span></div>
<p id="notice" class="notice" role="alert" hidden></p><div id="cards" class="security-grid" aria-live="off"></div>
<footer class="page-footer">行情与分时可能存在延迟，以每张图的来源时间为准。曲线来自一分钟 OHLC，并非全部逐笔成交；午休已压缩。资金分类为平台估算，缺失数据保持空值。页面每 30 秒发起更新，未完成的请求不会重叠。</footer>
</main></div><script id="initial-watchlist" type="application/json">${initial}</script></body></html>`;
}
