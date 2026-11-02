# 东方财富行情数据服务

独立的 Node.js 24.15+（推荐 24.22.1）+ TypeScript 项目，对接东方财富公开接口，查询沪深京 A 股价格、成交量及分单资金流。支持 Web 看板、命令行、本地 HTTP API 和只读 MCP；服务端由 Node.js 原生执行 TypeScript，网页脚本启动前自动打包。

## 开始使用

```bash
cd /Users/willwang/workspace/Will/eastmoney-market-data
npm ci
npm run quote -- 600127
npm run funds -- 600127
npm run snapshot -- 600127
```

证券代码支持 `600127`、`SH600127`、`600127.SH`，也支持深市及北交所 A 股，以及 `159` 开头的深市 ETF（例如 `159502`、`159502.SZ`）。**不支持指数、其他基金、港美股或股票名称搜索**。例如 `000001` 表示深市个股，不表示上证指数。格式校验不等于证券一定存在，上游无记录时返回 `NOT_FOUND`。

ETF 报告价格保留三位小数；公开接口未提供的资金字段保持 `null`，不会填为零或生成资金强弱判断。ETF 分单资金仅描述场内成交，不等于基金申购赎回或标的资产的资金流。

## Web 行情看板

```bash
cd /Users/willwang/workspace/Will/eastmoney-market-data
npm run chart
# 也可使用 npm start 或 npm run web
# 自定义端口：PORT=3001 npm run chart
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)。页面展示 `config/stocks.json` 中全部启用的股票和 ETF，包括名称、行业、最新价、涨跌幅、今开/昨收、日内高低、换手率、成交额、分单资金和当天分钟价格图。展开“资金分布与分析依据”可查看各分单净流入和规则分析。

页面每 **30 秒**自动刷新，也可手动更新。修改配置后下一次刷新自动生效，无需重启。行情标注上游时间；部分请求失败时保留同日的上次成功数据并显示错误和原始时间。当天没有分钟数据时显示原因，不使用前一交易日曲线。

后端合并多个页面的同时请求，并共享一轮 30 秒采集缓存；手动更新最短间隔 5 秒。每轮最多同时处理两只证券，按 `request.intervalMs` 错开开始时间，单只证券的行情与分钟线同时请求，各次上游请求限时 3 秒并允许备用源回退。请求超过刷新周期时等待本轮完成，不叠加新一轮。观察列表较长或上游较慢时，整轮耗时可能超过 30 秒；页面刷新频率不代表上游每 30 秒一定产生新数据。仅打开页面时轮询，关闭页面后不继续定时采集。

`npm run chart` 现在启动 Web 服务；原来的离线图表导出改为 `npm run chart:export`。

## 配置一批股票并分析

编辑 `config/stocks.json`，然后运行：

```bash
npm run batch
# 使用其他配置：
npm run batch -- --config ./config/my-stocks.json
```

配置已包含观察列表中的 `600664`、`603618`、`600127`、`000519`、`603127`、`159502`，并保留原有的贵州茅台、平安银行示例；不需要的条目可设置 `enabled: false`。

```json
{
  "$schema": "./stocks.schema.json",
  "stocks": [
    { "symbol": "600127", "label": "金健米业", "enabled": true },
    { "symbol": "000001", "label": "平安银行", "enabled": false }
  ],
  "request": { "intervalMs": 1000 },
  "analysis": {
    "priceChangeThresholdPercent": 3,
    "mainFlowThresholdPercent": 5,
    "highTurnoverThresholdPercent": 10,
    "maxSnapshotAgeSeconds": 180
  },
  "output": { "directory": "../reports", "formats": ["json", "markdown"] }
}
```

| 配置 | 作用 |
| --- | --- |
| `stocks[].symbol` | A 股或支持的 ETF 代码，使用字符串保留前导零；最多 100 只 |
| `stocks[].label` | 可选备注；成功报告以行情返回的真实股票名称为准 |
| `stocks[].enabled` | 是否获取，默认 `true` |
| `stocks[].basicInfo` | 可选证券基本信息：`name` 名称、`market` 市场（SH/SZ/BJ）、`securityType` 类型（stock/etf）、`industry` 东方财富行业分类、`source` 来源、`fetchedAt` 获取时间 |
| `request.intervalMs` | 批量命令为查询完成后等待间隔；Web 看板为各证券开始请求的最小间隔；默认 1000 毫秒，最少 500 毫秒 |
| `analysis.priceChangeThresholdPercent` | 涨跌幅强弱阈值；默认上涨 ≥3% 为正向、下跌 ≤−3% 为负向 |
| `analysis.mainFlowThresholdPercent` | 主力净流入占成交额的强弱阈值，默认 ±5% |
| `analysis.highTurnoverThresholdPercent` | 高换手观察阈值，默认 10% |
| `analysis.maxSnapshotAgeSeconds` | 行情时间超过此间隔时标记为较早快照，默认 180 秒 |
| `output.directory` | 报告目录，**相对于配置文件所在目录**解析；也可使用绝对路径 |
| `output.formats` | 可选 `json`、`markdown`，至少一种 |

配置只要求提供 `stocks`，其余项可以省略并采用默认值。JSON 不支持注释；编辑器可通过 `stocks.schema.json` 提供字段提示。运行时还会检查市场冲突、启用股票的重复代码（包括不同写法）以及是否至少启用一只股票，配置不合法时不发送任何行情请求。Schema 变更后可运行 `npm run config:schema` 更新编辑器提示。

当前观察列表已补齐东方财富名称、交易市场、股票/ETF 类型及行业分类，字段位于各条目的 `basicInfo`，`label` 同时补齐名称以便阅读。行业分类按东方财富原值保存，ETF 未返回行业时记为 `null`。`fetchedAt` 是获取时间（UTC），不是公司公告日期。这些信息保存在配置中，不随每次批量行情查询自动更新；实时价格和资金仍以接口快照为准。提供 `basicInfo` 时，市场和证券类型必须与代码一致，原有未填写基本信息的配置仍可使用。

批量执行为顺序查询，各股票行情时间可能不同；不会启动持续监控或后台任务。单只失败仍继续处理后面的股票，报告保留成功数据和失败原因。每次生成带时间和随机标识的独立报告，不覆盖以往报告。

JSON 报告保留完整行情、分单资金、来源时间、分析阈值及每只股票的分析证据；Markdown 报告展示汇总表和各股资金分布。输出目录默认是项目 `reports/`。

**分析范围：**价格和主力资金都达到正向阈值时标记“价资同向偏强”，都达到负向阈值时标记“价资同向偏弱”，达到相反方向的阈值时标记“价格与资金分歧”；其余情况区分部分指标触及阈值、未触及阈值和数据不足。高换手和较早快照单独提示。这是可复核的快照规则分析，不使用大模型，不包含历史技术趋势、基本面或未来价格预测，也不生成买卖指令。

批量命令退出码：`0` 全部查询成功；`1` 配置或保存失败；`2` 部分或全部股票查询失败，但报告仍已保存。配置错误和输出错误分别返回 `CONFIG_ERROR`、`OUTPUT_ERROR`。

## 当天分时数据与价格波动图

现有 `quote`、`snapshot` 和 HTTP 行情接口返回最新快照（含今开、最高、最低等日内汇总），不包含所有分钟或逐笔成交。新的分钟线功能另外调用东方财富 `klt=1`、`fqt=0` 接口，取得指定日的一分钟开盘、收盘、最高、最低、成交量和成交额。

```bash
npm run intraday -- 600127   # 输出今天的一分钟线 JSON
npm run chart:export -- 600127 # 生成金健米业今天的离线图表
npm run chart:export           # 为配置中全部启用的证券导出图表
```

“今天”按 `Asia/Shanghai` 计算。图表保存在 `output.directory` 下新建的 `charts-YYYY-MM-DD-标识/` 目录：

- `index.html`：可离线打开的响应式图表页面，悬停或轻触查看分钟价格。
- `代码.svg`：每只证券的独立矢量图。
- `data.json`：完整的分钟 OHLC 数据、来源、交易日期和截止时间，便于复查。

曲线连接每分钟收盘字段，浅蓝竖线表示各分钟高低区间，虚线表示昨收；存在 09:31 数据时，额外使用该分钟开盘价表示起点。午休被压缩为 11:30 / 13:00 分界，缺失分钟不补值、不跨缺口连线，未来时间不外推。纵轴按各证券实际价格范围缩放，不可直接用线条斜率跨图比较涨幅。

盘中只能获取开盘至数据截止点，末根分钟线可能仍在更新；收盘后可获取上游返回的收盘数据，但不能保证无遗漏。它不是完整逐笔成交。`hasClosingBar` 只表示存在 15:00 分钟线，不表示 240 分钟全部完整。休市、停牌或无数据时显示失败原因，不会拿前一交易日冒充今天。

分钟线优先使用 `push2his.eastmoney.com`，网络失败或临时 HTTP 错误时回退 `push2delay.eastmoney.com`；行情快照也支持从 `push2.eastmoney.com` 回退到 `push2delay.eastmoney.com`。实际 URL 保存在数据中。公开源均可能延迟或限流。导出的离线图表是保存时的数据，不后台刷新。

## 本地 HTTP API

```bash
npm start
# 自定义端口：PORT=3001 npm start
```

默认监听 `127.0.0.1:3000`。

| GET 路径 | 用途 |
| --- | --- |
| `/` | Web 行情看板 |
| `/api/dashboard` | 配置内全部启用证券的行情、资金、分钟线和规则分析；单只失败体现在对应条目的错误字段 |
| `/health` | 本地进程健康检查，不请求东方财富 |
| `/api/quote?symbol=600127` | 股票行情和来源时间 |
| `/api/fund-flow?symbol=600127` | 资金分布和来源时间 |
| `/api/snapshot?symbol=600127` | 同一上游快照的行情及资金分布 |

```bash
curl 'http://127.0.0.1:3000/api/snapshot?symbol=600127'
```

成功响应为 `{ "success": true, "data": ... }`。可预期的错误作为数据返回：`{ "success": false, "error": { "code": "INVALID_INPUT", "message": "..." } }`。

看板响应还包含 `startedAt`、`completedAt`、`refreshIntervalMs`、`summary` 和 `items`。`/api/dashboard?refresh=1` 请求手动更新，仍受 5 秒间隔限制；配置读取失败返回 HTTP 500 和 `CONFIG_ERROR`。单只证券失败不阻止其余证券展示。

| 错误代码 | HTTP 状态 | 含义 |
| --- | --- | --- |
| `INVALID_INPUT` | 400 | 缺少参数、格式不正确或市场冲突 |
| `NOT_FOUND` | 404 | 股票或路由不存在 |
| `UPSTREAM_UNAVAILABLE` | 503 | 网络失败或超时 |
| `UPSTREAM_HTTP_ERROR` | 502 | 上游 HTTP 错误 |
| `UPSTREAM_REJECTED` | 502 | 上游业务状态码非零 |
| `UPSTREAM_INVALID_DATA` | 502 | 非 JSON、字段结构变化或数据不匹配 |

## MCP 接入

```bash
npm run mcp
```

提供一个只读工具 `get_stock_snapshot`，输入 `{ "symbol": "600127" }`，输出完整结构化快照。stdout 仅承载 MCP 协议。

供支持 `mcpServers` 配置格式的客户端参考（不同客户端的配置格式可能不同）：

```json
{
  "mcpServers": {
    "eastmoney-market-data": {
      "command": "node",
      "args": ["/Users/willwang/workspace/Will/eastmoney-market-data/src/mcp.ts"]
    }
  }
}
```

客户端启动时需要能找到 Node.js 24；若桌面客户端的 PATH 不含该版本，将 `command` 替换为本机 Node 可执行文件的绝对路径。项目只附接入示例，不自动修改客户端配置。

## 数据口径与时间

调用 `https://push2.eastmoney.com/api/qt/ulist.np/get`，指定 `fltt=2`，不经过 APP 抓包，不需要账号或 API Key。

- `fetchedAt`：本地完成请求的 UTC 时间。
- `quoteTime`：上游 `f124` 给出的行情 UTC 时间；`quoteTimeBeijing` 为北京时间。
- `ageSeconds`：本地时间与行情时间之差，最小为 0。
- `freshness`：差值不超过 60 秒为 `recent`，否则为 `older-snapshot`。这只是时间差标签，不是实时性承诺，也不能判断是否正在交易。
- 休市、停牌时可能返回最近交易快照；不会拿请求时间冒充行情时间。
- 价格、成交额、资金金额和市值均以人民币元表示；百分比 `2.73` 表示 `2.73%`。
- `volumeLots` 的单位为手，`volumeShares` 按 A 股 1 手 = 100 股换算。
- 主力是超大单与大单的汇总项，不要把主力与所有分单重复相加。分单身份和净流向都是平台统计，不能推断真实庄家持仓或交易意图。
- `null` 代表上游缺失或 `-`，不代表零；上游各字段可能存在刷新时差和舍入差异。
- 单只行情 API、CLI、MCP 每次独立请求，默认每次请求超时 8 秒，失败最多回退一次；分钟线命令默认每次超时 6 秒。Web 看板使用上述共享缓存和 3 秒超时。公开接口可能限流或变更。
- 不获取付费 Level-2 专有数据，不包含委托交易或自动买卖功能。

主要字段映射：

| 上游字段 | 输出 |
| --- | --- |
| `f2/f3/f4` | 最新价／涨跌幅／涨跌额 |
| `f5/f6/f8` | 成交量（手）／成交额／换手率 |
| `f15/f16/f17/f18` | 最高／最低／开盘／昨收 |
| `f62` | 主力净流入金额 |
| `f66/f69` | 超大单净流入金额／占成交额比例 |
| `f72/f75` | 大单净流入金额／占比 |
| `f78/f81` | 中单净流入金额／占比 |
| `f84/f87` | 小单净流入金额／占比 |
| `f124` | 行情 Unix 时间戳（秒） |

主力净占比由 `f62 / f6 * 100` 推导；成交额为 0 或缺失时返回 `null`。金额正数表示净流入，负数表示净流出。

## 验证

```bash
npm run check        # 严格类型检查和离线测试，不请求外网
npm run smoke        # 请求真实东方财富接口；需要网络
```

测试覆盖代码解析、单位换算、来源时间、缺失数据、上游格式变化、业务拒绝、备用源回退、HTTP 路由、MCP 工具调用、批量配置、分析阈值、部分失败、报告保存、看板缓存及并发合并、配置热加载，以及离线页面渲染与 30 秒自动刷新。测试会先自动构建网页脚本。

源码入口：`src/eastmoney.ts`（数据适配）、`src/cli.ts`（命令行）、`src/http-server.ts`（HTTP）、`src/dashboard.ts`（看板采集）、`src/web/browser.ts`（页面交互）、`src/mcp-server.ts`（MCP）。
