import { z } from 'zod';
import { failure, success } from './result.ts';
import type { Result } from './result.ts';

export const stockSymbolSchema = z.string().trim().min(1).max(12);
export const marketSchema = z.enum(['SH', 'SZ', 'BJ']);
export type Market = z.infer<typeof marketSchema>;
export type Stock = { code: string; market: Market; secid: string };

export function resolveStock(input: unknown): Result<Stock> {
  const parsed = stockSymbolSchema.safeParse(input);
  if (!parsed.success) {
    return failure('INVALID_INPUT', '请提供六位 A 股或支持的 ETF 代码，例如 600127、SH600127 或 159502.SZ。');
  }

  const symbol = parsed.data.toUpperCase();
  const matched = /^(?:(SH|SZ|BJ)(\d{6})|(\d{6})(?:\.(SH|SZ|BJ))?)$/.exec(symbol);
  const code = matched?.[2] ?? matched?.[3];
  if (!code) {
    return failure('INVALID_INPUT', '股票代码格式无效，例如：600127、SH600127、600127.SH。');
  }

  const inferred = code.startsWith('6') ? 'SH'
    : /^(?:[03]|159)/.test(code) ? 'SZ'
    : /^(?:[48]|92)/.test(code) ? 'BJ'
    : null;
  if (!inferred) {
    return failure('INVALID_INPUT', '当前支持沪深京 A 股和 159 开头的深市 ETF，不支持指数、其他基金或港美股代码。');
  }
  const explicit = matched?.[1] ?? matched?.[4];
  if (explicit && explicit !== inferred) {
    return failure('INVALID_INPUT', `代码 ${code} 与指定市场 ${explicit} 不匹配，应为 ${inferred}。`);
  }
  return success({ code, market: inferred, secid: `${inferred === 'SH' ? '1' : '0'}.${code}` });
}
