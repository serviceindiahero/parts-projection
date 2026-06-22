/**
 * PARTS ANALYSER BY NAVEEN — CONFIGURATION
 * ------------------------------------------------------------
 * Edit the values below, then save. Nothing else in the codebase
 * needs to change for basic setup.
 * ------------------------------------------------------------
 */

const CONFIG = {
  // Paste your Google Apps Script Web App URL here (ends in /exec).
  // See google-apps-script/Code.gs for setup instructions.
  GOOGLE_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxpASOdurXhTy3UtX2m-ucDZeB5SYbaVCDWPeZL8I2xP8Ur_FFsJFJF8r9afswoKoWP/exec',

  // NOTE: there is no Gemini API key here on purpose. AI Insights now runs
  // through your Google Apps Script backend (Code.gs) instead of directly
  // from the browser. This keeps the key off the public website entirely,
  // and avoids Google's API key restrictions blocking calls made from a
  // public GitHub Pages domain. Paste your free Gemini key into the
  // GEMINI_API_KEY constant near the top of Code.gs instead, then redeploy.

  // ---- Business rules (edit these to match your dealership) ----

  // Monthly order ceiling across all parts, in rupees.
  MONTHLY_ORDER_CAP: 700000,

  // FSN lookback window in days (sales activity used to classify Fast/Slow/Non-moving).
  // Must match FSN_WINDOW_DAYS in Code.gs if you change it — they're kept in
  // sync manually since one runs in the browser and one runs on Google's servers.
  FSN_WINDOW_DAYS: 90,

  // Weeks of average demand the order planner targets as a stock cover.
  ORDER_COVER_WEEKS: 2,

  // FSN thresholds: a part is "Fast" if it sold on at least this many
  // distinct days in the window; "Slow" if it sold at least once but
  // fewer days than this; "Non-moving" if zero sales in the window.
  FSN_FAST_MIN_DAYS_SOLD: 6,

  // ABC thresholds as cumulative % of total consumption value.
  ABC_A_CUTOFF: 0.70,
  ABC_B_CUTOFF: 0.90,

  // Order Planning only suggests orders for parts in these categories.
  // Set to an empty array [] to include every category instead.
  // Your inventory file's "Category" column values must match exactly.
  ORDER_PLANNING_CATEGORIES: ['HHML Parts'],

  // Ledger Explorer page size when fetching from the backend (keeps each
  // request small and fast rather than pulling the whole ledger at once).
  LEDGER_PAGE_SIZE: 300,
};
