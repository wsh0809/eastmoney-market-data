import type { IntradaySeries } from './intraday.ts';
import { sessionMinute } from './intraday.ts';
import type { Failure } from './result.ts';

export type ChartItem =
  | { symbol: string; success: true; series: IntradaySeries }
  | { symbol: string; success: false; error: Failure['error'] };

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

// 纯 JavaScript 函数：Node 生成独立 SVG，浏览器复用同一函数响应式重绘。
// 通过 stripTypeScriptTypes 去除类型后嵌入浏览器，避免维护两套坐标算法。
export function renderIntradaySvg(series: IntradaySeries, width = 1000): string {
  const height = width < 500 ? 280 : 330;
  const left = 66;
  const right = width - 20;
  const top = 22;
  const bottom = height - 48;
  const prices = series.points.flatMap(point => [point.low, point.high]);
  if (series.previousClose !== null) prices.push(series.previousClose);
  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const padding = Math.max((maximum - minimum) * 0.12, 10 ** -series.decimals * 2);
  const low = minimum - padding;
  const high = maximum + padding;
  const x = (minute: number) => left + minute / 240 * (right - left);
  const y = (price: number) => top + (high - price) / (high - low) * (bottom - top);
  const coordinates = series.points.map(point => ({ ...point, minute: sessionMinute(point.time) ?? 0 }));
  const first = coordinates[0];
  const latest = coordinates.at(-1);
  const lineSegments: string[] = [];
  let previousMinute: number | null = null;
  if (first?.time === '09:31') {
    lineSegments.push(`M${x(0).toFixed(2)},${y(first.open).toFixed(2)}`);
    previousMinute = 0;
  }
  for (const point of coordinates) {
    const command = previousMinute !== null && point.minute - previousMinute <= 1 ? 'L' : 'M';
    lineSegments.push(`${command}${x(point.minute).toFixed(2)},${y(point.close).toFixed(2)}`);
    previousMinute = point.minute;
  }
  const grids: string[] = [];
  for (let index = 0; index <= 4; index++) {
    const value = low + (high - low) * index / 4;
    grids.push(`<line x1="${left}" x2="${right}" y1="${y(value)}" y2="${y(value)}" stroke="#e5e7eb"/><text x="${left - 10}" y="${y(value) + 4}" text-anchor="end">${value.toFixed(series.decimals)}</text>`);
  }
  const ticks = width < 500 ? [[0, '09:30'], [120, '11:30 / 13:00'], [240, '15:00']]
    : [[0, '09:30'], [60, '10:30'], [120, '11:30 / 13:00'], [180, '14:00'], [240, '15:00']];
  const labels = ticks.map(([minute, label]) => {
    const position = typeof minute === 'number' ? minute : 0;
    const anchor = position === 0 ? 'start' : position === 240 ? 'end' : 'middle';
    return `<text x="${x(position)}" y="${bottom + 24}" text-anchor="${anchor}">${label}</text>`;
  }).join('');
  const reference = series.previousClose === null ? ''
    : `<line x1="${left}" x2="${right}" y1="${y(series.previousClose)}" y2="${y(series.previousClose)}" stroke="#7b8492" stroke-dasharray="5 4"/>`;
  const ranges = coordinates.map(point => `<line x1="${x(point.minute)}" x2="${x(point.minute)}" y1="${y(point.high)}" y2="${y(point.low)}" stroke="#c5d8f3" stroke-width="2"/>`).join('');
  const marker = latest ? `<circle cx="${x(latest.minute)}" cy="${y(latest.close)}" r="3.5" fill="#1556b8"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="price-chart" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${series.code} ${series.date} 分钟价格，数据截止 ${series.lastTime}"><title>${escapeHtml(series.name)} ${series.date} 日内价格</title><desc>蓝线为分钟收盘价，浅蓝竖线为每分钟高低区间，灰色虚线为昨收。午休压缩，不向未来延伸。</desc><style>text{font:12px 'SFMono-Regular',Consolas,monospace;fill:#536174}.price-chart{background:#fff}</style><rect width="${width}" height="${height}" fill="#fff"/>${grids.join('')}${reference}<line x1="${x(120)}" x2="${x(120)}" y1="${top}" y2="${bottom}" stroke="#e5e7eb"/>${ranges}<path d="${lineSegments.join(' ')}" fill="none" stroke="#1556b8" stroke-width="2" stroke-linejoin="round"/>${marker}${labels}<text x="${left}" y="14">价格 / 元</text><text x="${right}" y="${height - 5}" text-anchor="end">北京时间 · 午休压缩</text></svg>`;
}

export function renderChartHtml(items: ChartItem[], date: string, browserRenderer: string): string {
  const safeData = JSON.stringify(items).replaceAll('<', '\\u003c');
  const sections = items.map((item, index) => {
    if (!item.success) return `<section class="security"><h2>${escapeHtml(item.symbol)}</h2><p class="error">${escapeHtml(item.error.message)}</p></section>`;
    const { series } = item;
    const last = series.points.at(-1);
    const change = last && series.previousClose !== null ? (last.close / series.previousClose - 1) * 100 : null;
    const changeText = change === null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
    return `<section class="security" data-series="${index}"><header class="security-heading"><div><span class="code">${series.market} ${series.code}</span><h2>${escapeHtml(series.name)}</h2></div><div class="price"><strong>${last?.close.toFixed(series.decimals) ?? '—'}</strong><span class="${change !== null && change >= 0 ? 'up' : 'down'}">${changeText}</span></div></header><p class="context">${series.date} · 截至 ${series.lastTime} · ${series.points.length} 根分钟线 · 昨收 ${series.previousClose?.toFixed(series.decimals) ?? '—'}</p><div class="plot">${renderIntradaySvg(series)}</div><p class="point-detail" aria-live="polite">移动指针或轻触图表，查看对应分钟价格</p><footer><a href="${series.code}.svg">独立图</a><a href="${escapeHtml(series.sourceUrl)}" rel="noreferrer">数据来源</a><span>${series.hasClosingBar ? '包含收盘分钟' : '尚未覆盖收盘分钟'}</span></footer></section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${date} 日内价格观察</title><style>
  :root{color-scheme:light;--ink:#182738;--muted:#607084;--paper:#f5f3ee;--line:#dddeda;--blue:#1556b8}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:'PingFang SC','Hiragino Sans GB',sans-serif;font-size:14px;line-height:1.6}.page{max-width:1480px;margin:auto;padding:40px 36px}.masthead{border-top:4px solid var(--ink);padding:22px 0 28px;display:flex;justify-content:space-between;gap:24px;align-items:end}.eyebrow{font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;letter-spacing:2px;color:var(--muted)}h1{font-family:'Iowan Old Style','Songti SC',serif;font-size:36px;letter-spacing:1px;line-height:1.2;margin:8px 0}h2{font-size:20px;line-height:1.4;margin:3px 0;font-weight:500}.dateline{white-space:nowrap;color:var(--muted)}.legend{display:flex;flex-wrap:wrap;gap:8px 24px;color:var(--muted);border-top:1px solid var(--line);padding:14px 0 20px}.legend span:before{content:'';display:inline-block;vertical-align:middle;width:20px;border-top:2px solid var(--blue);margin-right:8px}.legend .reference:before{border-top:1px dashed #7b8492}.legend .range:before{border-top:5px solid #c5d8f3}.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:30px}.security{min-width:0;background:#fff;padding:22px 18px 12px;border-top:2px solid var(--ink)}.security-heading{display:flex;justify-content:space-between;gap:12px}.code{font:12px 'SFMono-Regular',Consolas,monospace;letter-spacing:1px;color:var(--muted)}.price{text-align:right;white-space:nowrap;display:flex;flex-direction:column;font-family:'SFMono-Regular',Consolas,monospace}.price strong{font-size:25px;font-weight:500;line-height:1.2}.up{color:#bd3b35}.down{color:#14765e}.context{font-size:12px;color:var(--muted);margin:12px 0 0}.plot{position:relative;width:100%;overflow:hidden}.price-chart{display:block;max-width:100%}.point-detail{min-height:22px;color:var(--muted);font-family:'SFMono-Regular',Consolas,monospace;font-size:12px;margin:0 0 8px}.security footer{display:flex;flex-wrap:wrap;gap:8px 20px;border-top:1px solid #eceeea;padding-top:9px;color:var(--muted);font-size:12px}.security footer span{margin-left:auto}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}.footnote{margin:28px 0 0;padding-top:15px;border-top:1px solid var(--line);color:var(--muted);max-width:1000px}.error{color:#bd3b35}@media(max-width:1000px){.grid{grid-template-columns:minmax(0,1fr)}.page{max-width:850px}}@media(max-width:520px){.page{padding:20px 12px}.masthead{display:block}h1{font-size:28px}.dateline{margin-top:10px}.security{padding:18px 8px 12px}h2{font-size:17px}.price strong{font-size:23px}.context{line-height:1.8}.security footer span{margin-left:0}}
  </style></head><body><main class="page"><header class="masthead"><div><div class="eyebrow">WILL / MARKET OBSERVATORY</div><h1>日内价格观察</h1></div><div class="dateline">${date} · 北京时间</div></header><div class="legend"><span>分钟收盘价</span><span class="reference">昨收参考线</span><span class="range">分钟内高低区间</span></div><div class="grid">${sections}</div><p class="footnote">东方财富公开一分钟 OHLC 数据。若有 09:31 分钟线，曲线起点使用该分钟的开盘价表示开盘位置。盘中只展示已返回的数据，末根分钟线可能仍在更新；不会补齐缺失分钟或延伸至未来。公开数据可能延迟；这不是全部逐笔成交。页面已保存数据，打开后不会自动刷新。</p></main><script type="application/json" id="series-data">${safeData}</script><script>
  ${browserRenderer}
  const items=JSON.parse(document.getElementById('series-data').textContent);
  document.querySelectorAll('[data-series]').forEach(section=>{
    const item=items[Number(section.dataset.series)];
    if(!item||!item.success)return;
    const plot=section.querySelector('.plot');
    const detail=section.querySelector('.point-detail');
    const redraw=()=>{
      const width=Math.max(260,Math.floor(plot.getBoundingClientRect().width));
      plot.innerHTML=renderIntradaySvg(item.series,width);
    };
    new ResizeObserver(redraw).observe(plot);redraw();
    plot.addEventListener('pointermove',event=>{
      const rect=plot.getBoundingClientRect();const minute=Math.max(0,Math.min(240,(event.clientX-rect.left-66)/(rect.width-86)*240));
      const points=item.series.points;let nearest=null;let distance=Infinity;
      points.forEach(point=>{const d=Math.abs(sessionMinute(point.time)-minute);if(d<distance){distance=d;nearest=point;}});
      if(!nearest||distance>3){detail.textContent='此位置没有分钟数据';return;}
      detail.textContent=nearest.time+'　价格 '+nearest.close.toFixed(item.series.decimals)+' 元　区间 '+nearest.low.toFixed(item.series.decimals)+'—'+nearest.high.toFixed(item.series.decimals)+' 元';
    });
  });
  </script></body></html>`;
}
