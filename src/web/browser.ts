import { z } from 'zod';
import { DASHBOARD_REFRESH_MS, dashboardResponseSchema, publicStockSchema } from '../dashboard-schema.ts';
import type { DashboardItem, PublicStock } from '../dashboard-schema.ts';
import { escapeHtml, renderIntradaySvg } from '../intraday-chart.ts';
import { beijingDate, sessionMinute } from '../intraday.ts';

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing required page element: ${id}`);
  return node;
}
const cards = element('cards');
const watchlist = element('watchlist');
const notice = element('notice');
const refreshStatus = element('refresh-status');
const countdown = element('countdown');
const button = document.getElementById('refresh-button');
const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', timeStyle: 'medium', hour12: false });
let observers: ResizeObserver[] = [];
let loading = false;
let nextRefreshAt = 0;
let refreshCount = 0;

function number(value: number | null | undefined, digits = 2): string {
  return value == null ? '—' : value.toFixed(digits);
}
function percent(value: number | null | undefined): string {
  return value == null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}
function amount(value: number | null | undefined): string {
  if (value == null) return '—';
  const absolute = Math.abs(value);
  if (absolute >= 1e8) return `${(value / 1e8).toFixed(2)} 亿`;
  if (absolute >= 1e4) return `${(value / 1e4).toFixed(2)} 万`;
  return value.toFixed(2);
}
function direction(value: number | null | undefined): string {
  return value == null || value === 0 ? 'flat' : value > 0 ? 'up' : 'down';
}
function metric(label: string, value: string, color = ''): string {
  return `<div class="metric"><small>${label}</small><strong class="${color}">${value}</strong></div>`;
}
function showNotice(message: string | null): void {
  notice.hidden = message === null;
  notice.textContent = message;
}

function render(stocks: PublicStock[], items: DashboardItem[] = []): void {
  const expanded = new Set([...cards.querySelectorAll<HTMLDetailsElement>('details[open]')].map(node => node.dataset['symbol']));
  observers.forEach(observer => observer.disconnect());
  observers = [];
  element('watchlist-count').textContent = String(stocks.length);
  watchlist.innerHTML = stocks.map((stock, index) => `<a class="watch-item" href="#security-${index}"><strong>${escapeHtml(stock.basicInfo?.name ?? stock.label ?? stock.symbol)}</strong><span>${escapeHtml(stock.symbol)}${stock.basicInfo?.securityType === 'etf' ? ' / ETF' : ''}</span></a>`).join('');
  cards.innerHTML = stocks.map((stock, index) => {
    const item = items[index];
    const snapshot = item?.snapshot;
    const quote = snapshot?.quote;
    const series = item?.intraday;
    const digits = series?.decimals ?? (stock.basicInfo?.securityType === 'etf' || stock.symbol.includes('159') ? 3 : 2);
    const name = quote?.name ?? series?.name ?? stock.basicInfo?.name ?? stock.label ?? stock.symbol;
    const change = quote?.changePercent;
    const flow = snapshot?.fundFlow;
    const old = snapshot && (snapshot.freshness === 'older-snapshot' || item?.snapshotRetained);
    const snapshotStatus = !snapshot ? '行情未就绪' : item?.snapshotRetained ? '保留上次行情' : old ? '较早快照' : '最新获取';
    const context = snapshot ? `行情 ${snapshot.quoteTimeBeijing}` : '等待行情时间';
    const errors = [item?.snapshotError ? `行情：${item.snapshotError.message}` : null,
      item?.intradayError ? `分时：${item.intradayError.message}${item.intradayRetained ? '（保留上次曲线）' : ''}` : null]
      .filter(message => message !== null).map(message => `<p class="component-error">${escapeHtml(message)}</p>`).join('');
    const distribution = flow ? [
      ['超大单', flow.superLarge], ['大单', flow.large], ['中单', flow.medium], ['小单', flow.small], ['主力合计', flow.main],
    ] satisfies [string, typeof flow.main][] : [];
    const funds = distribution.map(([label, bucket]) => `<tr><td>${label}</td><td class="${direction(bucket.netAmountYuan)}">${amount(bucket.netAmountYuan)}</td><td>${percent(bucket.netRatioPercent)}</td></tr>`).join('');
    return `<article id="security-${index}" class="security" data-index="${index}"><header class="security-top"><div class="identity"><div class="security-code">${escapeHtml(stock.symbol)}<span class="kind">${stock.basicInfo?.market ?? quote?.market ?? series?.market ?? ''} · ${stock.basicInfo?.securityType === 'etf' ? 'ETF' : '股票'}</span></div><h2>${escapeHtml(name)}</h2><div class="industry">${escapeHtml(stock.basicInfo?.industry ?? (stock.basicInfo?.securityType === 'etf' ? '场内基金' : '行业待补充'))}</div></div><div class="price"><strong>${number(quote?.latestPrice, digits)}</strong><span class="${direction(change)}">${percent(change)}</span></div></header><div class="metrics">${metric('今开 / 昨收', `${number(quote?.open, digits)} / ${number(quote?.previousClose, digits)}`)}${metric('日内低 / 高', `${number(quote?.low, digits)} / ${number(quote?.high, digits)}`)}${metric('换手率', quote?.turnoverRatePercent == null ? '—' : `${number(quote.turnoverRatePercent)}%`)}${metric('成交额 / 元', amount(quote?.turnoverYuan))}${metric('主力净流入 / 元', amount(flow?.main.netAmountYuan), direction(flow?.main.netAmountYuan))}${metric('主力净占比', percent(flow?.main.netRatioPercent), direction(flow?.main.netRatioPercent))}</div><div class="plot">${series ? '' : `<div class="plot-placeholder">${item ? '当前没有可用的日内曲线' : '<i class="loading-dot"></i>正在获取今天的分钟价格…'}</div>`}</div><p class="point-detail">${series ? `${series.date} · 截至 ${series.lastTime} · ${series.points.length} 根分钟线` : '—'}</p><div class="data-time"><span class="status ${snapshot && !old ? 'status-normal' : 'status-old'}">${snapshotStatus}</span><span>${escapeHtml(context)}</span>${snapshot ? `<a href="${escapeHtml(snapshot.sourceUrl)}" target="_blank" rel="noreferrer">行情来源 ↗</a>` : ''}</div>${errors}${item?.analysis ? `<p class="analysis">快照分析 · ${escapeHtml(item.analysis.label)}</p>` : ''}<details class="details" data-symbol="${escapeHtml(stock.symbol)}" ${expanded.has(stock.symbol) ? 'open' : ''}><summary>资金分布与分析依据</summary>${flow ? `<table class="fund-table"><thead><tr><th>分单</th><th>净流入 / 元</th><th>占成交额</th></tr></thead><tbody>${funds}</tbody></table>` : '<p>资金数据暂不可用</p>'}${item?.analysis ? `<ul class="evidence">${item.analysis.evidence.map(evidence => `<li>${escapeHtml(evidence)}</li>`).join('')}</ul>` : ''}</details></article>`;
  }).join('');
  cards.querySelectorAll<HTMLElement>('[data-index]').forEach(section => {
    const item = items[Number(section.dataset['index'])];
    const series = item?.intraday;
    if (!series) return;
    const plot = section.querySelector<HTMLElement>('.plot');
    const detail = section.querySelector<HTMLElement>('.point-detail');
    if (!plot || !detail) return;
    const draw = () => { plot.innerHTML = renderIntradaySvg(series, Math.max(260, Math.floor(plot.getBoundingClientRect().width))); };
    const observer = new ResizeObserver(draw);
    observer.observe(plot);
    observers.push(observer);
    draw();
    plot.addEventListener('pointermove', event => {
      const rectangle = plot.getBoundingClientRect();
      const minute = (event.clientX - rectangle.left - 66) / (rectangle.width - 86) * 240;
      let nearest = series.points[0];
      let distance = Infinity;
      for (const point of series.points) {
        const value = sessionMinute(point.time);
        if (value === null) continue;
        if (Math.abs(value - minute) < distance) { nearest = point; distance = Math.abs(value - minute); }
      }
      detail.textContent = nearest && distance <= 3
        ? `${nearest.time}　价格 ${nearest.close.toFixed(series.decimals)} 元　区间 ${nearest.low.toFixed(series.decimals)}—${nearest.high.toFixed(series.decimals)} 元`
        : `${series.date} · 截至 ${series.lastTime} · 此位置没有分钟数据`;
    });
  });
}

async function refresh(force = false): Promise<void> {
  if (loading) return;
  loading = true;
  if (button instanceof HTMLButtonElement) button.disabled = true;
  nextRefreshAt = Date.now() + DASHBOARD_REFRESH_MS;
  refreshStatus.textContent = '正在更新行情与日内曲线…';
  try {
    const response = await fetch(`/api/dashboard${force ? '?refresh=1' : ''}`, {
      cache: 'no-store', signal: AbortSignal.timeout(45_000),
    });
    const payload: unknown = await response.json();
    const parsed = dashboardResponseSchema.safeParse(payload);
    if (!parsed.success) {
      showNotice('返回的数据格式不符合预期，已保留页面上的上次数据。');
      refreshStatus.textContent = '更新失败，30 秒后重试';
      return;
    }
    if (!parsed.data.success) {
      showNotice(parsed.data.error.message);
      refreshStatus.textContent = '配置读取失败，30 秒后重试';
      return;
    }
    const data = parsed.data.data;
    render(data.items.map(item => item.stock), data.items);
    element('market-date').textContent = data.date;
    element('summary').textContent = `${data.summary.total} 个观察标的 · ${data.summary.snapshots} 份行情 · ${data.summary.charts} 张日内图`;
    refreshStatus.textContent = `上次获取 ${formatter.format(new Date(data.completedAt))}`;
    showNotice(data.summary.failed > 0 ? `${data.summary.failed} 个标的有数据获取失败，请查看卡片提示；保留的数据仍标注原始时间。` : null);
    refreshCount++;
    document.documentElement.dataset['refreshCount'] = String(refreshCount);
    document.documentElement.dataset['updatedAt'] = data.completedAt;
  } catch {
    showNotice('连接失败或响应超时，已保留页面上的上次数据，将自动重试。');
    refreshStatus.textContent = '更新失败，30 秒后重试';
  } finally {
    loading = false;
    if (button instanceof HTMLButtonElement) button.disabled = false;
  }
}

const initialSchema = z.object({ stocks: z.array(publicStockSchema), error: z.string().nullable() });
try {
  const input: unknown = JSON.parse(element('initial-watchlist').textContent ?? 'null');
  const initial = initialSchema.safeParse(input);
  if (initial.success) { render(initial.data.stocks); showNotice(initial.data.error); }
} catch {
  showNotice('初始观察列表读取失败，将通过行情接口重新加载。');
}
element('market-date').textContent = beijingDate();
button?.addEventListener('click', () => { void refresh(true); });
window.setInterval(() => {
  countdown.textContent = loading ? '更新进行中' : `${Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000))} 秒后自动刷新`;
  if (Date.now() >= nextRefreshAt && !loading) void refresh();
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && Date.now() >= nextRefreshAt) void refresh();
});
void refresh();
