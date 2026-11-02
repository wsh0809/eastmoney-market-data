import type { AnalysisSettings } from './batch-config.ts';
import type { Snapshot } from './eastmoney.ts';

export type Signal = 'positive' | 'negative' | 'neutral' | 'unavailable';
export type Assessment = 'strong' | 'weak' | 'divergent' | 'mixed' | 'neutral' | 'insufficient-data';
export type SnapshotAnalysis = {
  assessment: Assessment;
  priceSignal: Signal;
  mainFlowSignal: Signal;
  highTurnover: boolean | null;
  olderThanConfiguredLimit: boolean;
  evidence: string[];
};

export const assessmentLabels: Record<Assessment, string> = {
  strong: '价资同向偏强',
  weak: '价资同向偏弱',
  divergent: '价格与资金分歧',
  mixed: '部分指标触及阈值',
  neutral: '未触及强弱阈值',
  'insufficient-data': '数据不足',
};

function classify(value: number | null, threshold: number): Signal {
  if (value === null) return 'unavailable';
  if (value >= threshold) return 'positive';
  if (value <= -threshold) return 'negative';
  return 'neutral';
}

export function analyzeSnapshot(snapshot: Snapshot, settings: AnalysisSettings): SnapshotAnalysis {
  const { quote, fundFlow } = snapshot;
  const hasPrice = quote.latestPrice !== null && quote.latestPrice > 0;
  const hasTurnover = quote.turnoverYuan !== null && quote.turnoverYuan > 0;
  const priceSignal = classify(hasPrice ? quote.changePercent : null, settings.priceChangeThresholdPercent);
  const mainFlowSignal = classify(hasTurnover ? fundFlow.main.netRatioPercent : null, settings.mainFlowThresholdPercent);
  const highTurnover = quote.turnoverRatePercent === null ? null
    : quote.turnoverRatePercent >= settings.highTurnoverThresholdPercent;
  const olderThanConfiguredLimit = snapshot.ageSeconds > settings.maxSnapshotAgeSeconds;

  let assessment: Assessment;
  if (priceSignal === 'unavailable' || mainFlowSignal === 'unavailable') assessment = 'insufficient-data';
  else if (priceSignal === 'positive' && mainFlowSignal === 'positive') assessment = 'strong';
  else if (priceSignal === 'negative' && mainFlowSignal === 'negative') assessment = 'weak';
  else if ((priceSignal === 'positive' && mainFlowSignal === 'negative')
    || (priceSignal === 'negative' && mainFlowSignal === 'positive')) assessment = 'divergent';
  else if (priceSignal === 'neutral' && mainFlowSignal === 'neutral') assessment = 'neutral';
  else assessment = 'mixed';

  const evidence: string[] = [];
  evidence.push(quote.changePercent === null ? '涨跌幅缺失。'
    : `快照涨跌幅 ${quote.changePercent.toFixed(2)}%，强弱阈值为 ±${settings.priceChangeThresholdPercent}%。`);
  const mainRatio = fundFlow.main.netRatioPercent;
  evidence.push(mainRatio === null ? '主力净流入占比缺失或成交额不足。'
    : `主力净流入占成交额 ${mainRatio.toFixed(2)}%，强弱阈值为 ±${settings.mainFlowThresholdPercent}%。`);
  if (!hasPrice) evidence.push('最新价缺失或无效，不生成价格强弱判断。');
  if (!hasTurnover) evidence.push('当前成交额为零或缺失，不生成资金强弱判断。');
  if (highTurnover) evidence.push(`换手率达到 ${settings.highTurnoverThresholdPercent}% 的观察阈值，留意成交活跃度及波动。`);
  if (olderThanConfiguredLimit) {
    evidence.push(`快照距请求时间 ${snapshot.ageSeconds} 秒，超过配置的 ${settings.maxSnapshotAgeSeconds} 秒；以下仅描述该历史快照。`);
  }
  evidence.push('仅按单次行情快照和配置阈值描述价资状态，不包含历史趋势、基本面或未来涨跌预测。');
  return { assessment, priceSignal, mainFlowSignal, highTurnover, olderThanConfiguredLimit, evidence };
}
