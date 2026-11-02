import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';
import { JSDOM } from 'jsdom';
import { renderDashboardPage } from '../src/dashboard-page.ts';
import { createDashboardService } from '../src/dashboard.ts';
import { DASHBOARD_REFRESH_MS } from '../src/dashboard-schema.ts';
import { dashboardConfig, dashboardIntraday, dashboardNow, dashboardSnapshot, readDashboardConfig } from './dashboard-fixtures.ts';

describe('离线页面渲染与自动刷新', () => {
  it('should render real schema-valid fixtures, poll every 30 seconds and retain the view on network errors', async () => {
    const snapshot = await dashboardSnapshot();
    const intraday = await dashboardIntraday();
    const service = createDashboardService({
      now: () => dashboardNow, readConfig: readDashboardConfig,
      snapshotClient: { getSnapshot: async () => ({ success: true, data: snapshot }) },
      intradayClient: { getIntraday: async () => ({ success: true, data: intraday }) },
    });
    const payload = await service.getDashboard();
    const script = await readFile(new URL('../public/dashboard.js', import.meta.url), 'utf8');
    // 纯离线 DOM 环境，不启动浏览器，也不访问任何网络地址。
    const dom = new JSDOM(renderDashboardPage(dashboardConfig.stocks), { runScripts: 'outside-only', url: 'https://dashboard.test/' });
    let now = dashboardNow;
    let fetches = 0;
    let fail = false;
    const timers: (() => void)[] = [];
    const window = dom.window;
    class Observer {
      constructor(privateCallback: ResizeObserverCallback) { this.callback = privateCallback; }
      callback: ResizeObserverCallback;
      observe(): void { this.callback([], this); }
      unobserve(): void {}
      disconnect(): void {}
    }
    Object.defineProperty(window, 'ResizeObserver', { value: Observer });
    Object.defineProperty(window, 'AbortSignal', { value: AbortSignal });
    Object.defineProperty(window, 'fetch', { value: async () => {
      fetches++;
      if (fail) throw new TypeError('Simulated test fetch failure');
      return Response.json(payload);
    } });
    window.Date.now = () => now;
    window.setInterval = handler => {
      timers.push(() => { if (typeof handler === 'function') handler(); });
      return timers.length;
    };
    try {
      window.eval(script);
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(fetches, 1);
      assert.equal(window.document.querySelectorAll('.security').length, dashboardConfig.stocks.length);
      assert.equal(window.document.querySelectorAll('svg.price-chart').length, 1);
      assert.match(window.document.querySelector('h2')?.textContent ?? '', /金健米业/);
      const price = window.document.querySelector('.price strong')?.textContent;
      assert.equal(price, snapshot.quote.latestPrice?.toFixed(2));
      now += DASHBOARD_REFRESH_MS - 1000;
      timers.forEach(tick => tick());
      assert.equal(fetches, 1);
      now += 1000;
      timers.forEach(tick => tick());
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(fetches, 2);
      assert.equal(window.document.documentElement.dataset['refreshCount'], '2');
      fail = true;
      now += DASHBOARD_REFRESH_MS;
      timers.forEach(tick => tick());
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(fetches, 3);
      assert.equal(window.document.querySelector('.price strong')?.textContent, price);
      assert.match(window.document.getElementById('notice')?.textContent ?? '', /连接失败/);
    } finally {
      dom.window.close();
    }
  });
});
