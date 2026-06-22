/**
 * PARTS ANALYSER BY NAVEEN — AI INSIGHTS
 * ------------------------------------------------------------
 * Builds a compact statistics summary (never the raw ledger — that would
 * be too large and isn't needed) and sends it to the Google Apps Script
 * backend, which calls Gemini on the server side. The Gemini API key never
 * appears in the browser or in this website's public source code.
 * ------------------------------------------------------------
 */

const AiInsights = (() => {

  function buildSummaryPayload(analytics, orderPlanWeeks, meta) {
    const fsnCounts = { Fast: 0, Slow: 0, 'Non-moving': 0 };
    const abcCounts = { A: 0, B: 0, C: 0 };
    let totalStockValue = 0;
    let unpricedCount = 0;
    let zeroStockFastMovers = [];
    let deadStockHighValue = [];

    for (const p of analytics) {
      fsnCounts[p.fsnClass] = (fsnCounts[p.fsnClass] || 0) + 1;
      abcCounts[p.abcClass] = (abcCounts[p.abcClass] || 0) + 1;
      totalStockValue += p.stockValue;
      if (!p.hasPrice) unpricedCount++;

      if (p.fsnClass === 'Fast' && p.actualStockOnHand === 0) {
        zeroStockFastMovers.push({ part: p.partNumber, desc: p.description, avgDailyDemand: Number(p.avgDailyDemand.toFixed(2)) });
      }
      if (p.fsnClass === 'Non-moving' && p.stockValue > 5000) {
        deadStockHighValue.push({ part: p.partNumber, desc: p.description, value: Math.round(p.stockValue) });
      }
    }

    zeroStockFastMovers.sort((a, b) => b.avgDailyDemand - a.avgDailyDemand);
    deadStockHighValue.sort((a, b) => b.value - a.value);

    let weekTotals = [];
    if (orderPlanWeeks) {
      weekTotals = orderPlanWeeks.map(w => ({
        week: w.weekNumber,
        budget: Math.round(w.budget),
        spend: Math.round(w.spend),
        lines: w.lines.length,
      }));
    }

    return {
      asOfDate: meta?.lastInventoryUpload || new Date().toISOString(),
      totalParts: analytics.length,
      fsnCounts,
      abcCounts,
      totalStockValue: Math.round(totalStockValue),
      unpricedPartCount: unpricedCount,
      zeroStockFastMovers: zeroStockFastMovers.slice(0, 15),
      deadStockHighValue: deadStockHighValue.slice(0, 15),
      weeklyOrderPlan: weekTotals,
    };
  }

  async function getInsights(analytics, orderPlanWeeks, meta) {
    if (!Api.isConfigured()) {
      return {
        ok: false,
        error: 'NOT_CONFIGURED',
        message: 'Connect your Google Apps Script backend in js/config.js, and add your free Gemini API key to Code.gs, to enable AI insights.',
      };
    }

    const summary = buildSummaryPayload(analytics, orderPlanWeeks, meta);

    try {
      const result = await Api.generateAiInsights(summary);
      if (result.ok) return { ok: true, text: result.text, summary };
      return { ok: false, error: result.error || 'API_ERROR', message: result.message || 'Could not generate insights.' };
    } catch (err) {
      return { ok: false, error: 'NETWORK_ERROR', message: String(err.message || err) };
    }
  }

  return { getInsights, buildSummaryPayload };
})();
