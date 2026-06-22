/**
 * PARTS ANALYSER BY NAVEEN — API LAYER
 * ------------------------------------------------------------
 * Wraps every call to the Google Apps Script backend. The backend now
 * serves a pre-aggregated "summary bundle" (inventory + per-part summary +
 * order plans + meta) for fast page loads, and the full raw ledger only
 * on demand, paginated, for Ledger Explorer.
 * ------------------------------------------------------------
 */

const Api = (() => {
  let cache = {
    inventory: [],
    summary: [],       // pre-aggregated per-part summary from PartSummary sheet
    orderPlans: [],
    meta: {},
    loaded: false,
  };

  function isConfigured() {
    return CONFIG.GOOGLE_SCRIPT_URL && CONFIG.GOOGLE_SCRIPT_URL.startsWith('http');
  }

  async function callGet(action, params = {}) {
    if (!isConfigured()) throw new Error('NOT_CONFIGURED');
    const url = new URL(CONFIG.GOOGLE_SCRIPT_URL);
    url.searchParams.set('action', action);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) throw new Error('Network error: ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown backend error');
    return json;
  }

  async function callPost(action, payload = {}) {
    if (!isConfigured()) throw new Error('NOT_CONFIGURED');
    const res = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, ...payload }),
    });
    if (!res.ok) throw new Error('Network error: ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Unknown backend error');
    return json;
  }

  /**
   * The main fast load: inventory + per-part summary + order plans + meta.
   * This is the only call made on every page load — it never touches the
   * raw ledger, which is what keeps load times fast regardless of how many
   * transactions are in the ledger.
   */
  async function loadSummaryBundle() {
    const json = await callGet('getSummaryBundle');
    cache.inventory = json.inventory || [];
    cache.summary = json.summary || [];
    cache.orderPlans = json.orderPlans || [];
    cache.meta = json.meta || {};
    cache.loaded = true;
    return cache;
  }

  async function uploadLedger(rows) {
    const result = await callPost('uploadLedger', { rows, mode: 'replace' });
    return result;
  }

  async function uploadInventory(rows) {
    const result = await callPost('uploadInventory', { rows });
    cache.inventory = rows;
    return result;
  }

  async function saveOrderPlan(rows) {
    return callPost('saveOrderPlan', { rows });
  }

  async function updateOrderPlanStatus(planId, status, approvedQtyMap) {
    return callPost('updateOrderPlanStatus', { planId, status, approvedQtyMap });
  }

  /**
   * Paginated raw ledger read — only called by Ledger Explorer when the
   * user actually opens that view, never on initial page load.
   */
  async function getLedgerPage(page, pageSize) {
    return callGet('getLedgerPage', { page, pageSize: pageSize || CONFIG.LEDGER_PAGE_SIZE });
  }

  /**
   * Full transaction history for a single part — used when Ledger Explorer
   * is filtered down to one part number, so the whole history (even beyond
   * the current page) is visible.
   */
  async function getLedgerForPart(partNumber) {
    const json = await callGet('getLedgerForPart', { partNumber });
    return json.data || [];
  }

  /**
   * AI insights now run on the Apps Script server (where your free Gemini
   * key lives), not in the browser. This sidesteps Google's API key
   * referrer restrictions, which block calls made directly from a public
   * GitHub Pages site.
   */
  async function generateAiInsights(summaryPayload) {
    return callPost('generateAiInsights', { summaryPayload });
  }

  function getCache() {
    return cache;
  }

  return {
    isConfigured,
    loadSummaryBundle,
    uploadLedger,
    uploadInventory,
    saveOrderPlan,
    updateOrderPlanStatus,
    getLedgerPage,
    getLedgerForPart,
    generateAiInsights,
    getCache,
    callPostSafe: callPost,
  };
})();
