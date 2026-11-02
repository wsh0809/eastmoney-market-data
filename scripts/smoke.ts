import { createEastmoneyClient } from '../src/eastmoney.ts';

const symbol = process.argv[2] ?? '600127';
const result = await createEastmoneyClient().getSnapshot(symbol);
if (!result.success) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  const { quote, fundFlow, quoteTimeBeijing, ageSeconds, sourceUrl } = result.data;
  console.log(JSON.stringify({
    success: true,
    code: quote.code,
    name: quote.name,
    latestPrice: quote.latestPrice,
    changePercent: quote.changePercent,
    quoteTimeBeijing,
    ageSeconds,
    mainNetInflowYuan: fundFlow.main.netAmountYuan,
    sourceUrl,
  }, null, 2));
}
