/**
 * PARTS ANALYSER BY NAVEEN — APP CONTROLLER
 * ------------------------------------------------------------
 * Owns application state, hash-based navigation (so the browser back
 * button moves between tabs instead of leaving the site), and the render
 * functions for every view. Calls into Engine for all analysis, Api for
 * all backend I/O, Charts for visualisations, and UI for DOM rendering.
 * ------------------------------------------------------------
 */

const App = (() => {

  // ---- Central state ----
  let state = {
    rawInventory: [],
    rawSummary: [],        // pre-aggregated per-part summary from backend
    rawOrderPlans: [],
    normInventory: [],
    partAnalytics: [],
    orderPlan: null,       // { weeks: [...], skippedNoPrice: [...] }
    referenceDate: null,
    meta: {},
    dataLoaded: false,

    // Ledger Explorer paged state (fetched from backend on demand)
    ledgerPage: 0,
    ledgerPageData: [],
    ledgerTotalPages: 1,
    ledgerTotalRows: 0,
    ledgerSinglePartMode: false,
    ledgerSinglePartData: [],
  };

  const VALID_VIEWS = ['dashboard', 'fsn', 'abc', 'category', 'trends', 'parts', 'ledger', 'orderplanning', 'ai', 'upload', 'settings'];

  const viewTitles = {
    dashboard: ['Dashboard', 'Inventory health at a glance'],
    fsn: ['FSN Analysis', 'Fast / Slow / Non-moving classification'],
    abc: ['ABC Analysis', 'Value-based part classification'],
    category: ['Category Analytics', 'Stock and consumption value by category'],
    trends: ['Trend Analytics', 'Monthly trend and momentum by part'],
    parts: ['Part Explorer', 'Search and inspect every part'],
    ledger: ['Ledger Explorer', 'Full transaction history'],
    orderplanning: ['Order Planning', 'Weekly Monday order plan within monthly budget'],
    ai: ['AI Insights', 'Plain-language analysis powered by Gemini'],
    upload: ['Upload Data', 'Load your Parts Ledger and Parts Inventory'],
    settings: ['Settings', 'Backend connection and business rules'],
  };

  function currentViewFromHash() {
    const h = (location.hash || '').replace('#', '').trim();
    return VALID_VIEWS.includes(h) ? h : 'dashboard';
  }

  function navigateTo(viewName, pushHash = true) {
    if (!VALID_VIEWS.includes(viewName)) viewName = 'dashboard';
    if (pushHash) {
      if (location.hash !== '#' + viewName) location.hash = viewName;
    }

    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + viewName);
    if (target) target.classList.add('active');

    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === viewName));

    const titlePair = viewTitles[viewName] || [viewName, ''];
    document.getElementById('topbarTitle').textContent = titlePair[0];
    document.getElementById('topbarSubtitle').textContent = titlePair[1];

    closeSidebarMobile();
    renderView(viewName);
  }

  function closeSidebarMobile() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarScrim').classList.remove('show');
  }

  function wireNavigation() {
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', () => navigateTo(el.dataset.view));
    });
    document.getElementById('menuToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebarScrim').classList.add('show');
    });
    document.getElementById('sidebarScrim').addEventListener('click', closeSidebarMobile);

    window.addEventListener('hashchange', () => {
      navigateTo(currentViewFromHash(), false);
    });
  }

  function recomputeAnalytics() {
    state.normInventory = Engine.normaliseInventory(state.rawInventory);

    let refDate = new Date();
    if (state.meta.latestLedgerDate) {
      const d = new Date(state.meta.latestLedgerDate);
      if (!isNaN(d.getTime())) refDate = d;
    }
    state.referenceDate = refDate;

    state.partAnalytics = Engine.buildPartAnalyticsFromSummary(state.rawSummary, state.normInventory, CONFIG);
    state.orderPlan = null;
    state.dataLoaded = state.normInventory.length > 0;
  }

  async function loadFromBackend(showSpinner) {
    if (showSpinner === undefined) showSpinner = true;
    if (!Api.isConfigured()) {
      updateSyncStatus(false, 'Backend not configured');
      return;
    }
    try {
      if (showSpinner) UI.showLoading('Loading your data…');
      const result = await Api.loadSummaryBundle();
      state.rawInventory = result.inventory;
      state.rawSummary = result.summary;
      state.rawOrderPlans = result.orderPlans;
      state.meta = result.meta;
      recomputeAnalytics();
      updateSyncStatus(true, 'Connected');
      const lastInv = result.meta.lastInventoryUpload ? new Date(result.meta.lastInventoryUpload) : null;
      document.getElementById('lastSyncText').textContent = lastInv
        ? ('Inventory as of ' + UI.fmtDate(lastInv))
        : 'No inventory uploaded yet';
      renderCurrentView();
    } catch (err) {
      updateSyncStatus(false, 'Connection failed');
      UI.toast('Could not load data: ' + err.message, 'error');
    } finally {
      if (showSpinner) UI.hideLoading();
    }
  }

  function updateSyncStatus(online, text) {
    const dot = document.getElementById('syncDot');
    dot.classList.remove('online', 'offline');
    dot.classList.add(online ? 'online' : 'offline');
    document.getElementById('syncStatusText').textContent = text;
  }

  function renderCurrentView() {
    renderView(currentViewFromHash());
  }

  function renderView(viewName) {
    if (viewName === 'dashboard') return renderDashboard();
    if (viewName === 'fsn') return renderFsn();
    if (viewName === 'abc') return renderAbc();
    if (viewName === 'category') return renderCategory();
    if (viewName === 'trends') return renderTrends();
    if (viewName === 'parts') return renderParts();
    if (viewName === 'ledger') return renderLedger();
    if (viewName === 'orderplanning') return renderOrderPlanning();
    if (viewName === 'ai') return renderAi();
    if (viewName === 'settings') return renderSettings();
  }

  function noDataGuard(emptyElId, contentElId) {
    const emptyEl = document.getElementById(emptyElId);
    const contentEl = document.getElementById(contentElId);
    if (!state.dataLoaded) {
      UI.emptyState(emptyEl, {
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/></svg>',
        title: 'No data loaded yet',
        sub: 'Upload your Parts Ledger and Parts Inventory to see this analysis.',
        actionLabel: 'Go to Upload Data',
        actionView: 'upload',
      });
      emptyEl.classList.remove('hidden');
      contentEl.classList.add('hidden');
      wireNavigation();
      return true;
    }
    emptyEl.classList.add('hidden');
    emptyEl.innerHTML = '';
    contentEl.classList.remove('hidden');
    return false;
  }

  // ============================================================
  // DASHBOARD
  // ============================================================

  function renderDashboard() {
    if (noDataGuard('dashboardEmptyState', 'dashboardContent')) return;

    const a = state.partAnalytics;
    const totalStockValue = a.reduce(function (s, p) { return s + p.stockValue; }, 0);
    const totalParts = a.length;
    const zeroStockParts = a.filter(function (p) { return p.actualStockOnHand <= 0; }).length;
    const fastZeroStock = a.filter(function (p) { return p.fsnClass === 'Fast' && p.actualStockOnHand <= 0; });
    const unpriced = a.filter(function (p) { return !p.hasPrice; });
    const unpricedWithStock = unpriced.filter(function (p) { return p.actualStockOnHand > 0; });

    const unpricedNotice = document.getElementById('unpricedNotice');
    if (unpriced.length > 0) {
      unpricedNotice.style.display = 'flex';
      document.getElementById('unpricedNoticeText').innerHTML =
        '<strong>' + UI.fmtNum(unpriced.length) + '</strong> parts have no DLC (dealer cost) recorded in your inventory file' +
        (unpricedWithStock.length > 0 ? (', including <strong>' + UI.fmtNum(unpricedWithStock.length) + '</strong> that currently have stock on hand.') : '.') +
        ' Total stock value below only counts parts with a price — it is a <strong>floor</strong>, not the true total. Add a DLC in your DMS for these parts to close the gap.';
    } else {
      unpricedNotice.style.display = 'none';
    }

    document.getElementById('dashboardExportBtn').onclick = function () {
      UI.exportToExcel(a.map(function (p) {
        return {
          'Part Number': p.partNumber, 'Description': p.description, 'Category': p.category,
          'FSN Class': p.fsnClass, 'ABC Class': p.abcClass, 'Current Stock': p.actualStockOnHand,
          'Avg Daily Demand (90d)': Number(p.avgDailyDemand.toFixed(2)), 'Total Sold (all-time)': p.totalSoldAllTime,
          'MRP': p.mrp, 'DLC': p.dlc, 'Has Price': p.hasPrice ? 'Yes' : 'No', 'Stock Value': Math.round(p.stockValue),
          'Consumption Value': Math.round(p.consumptionValue),
        };
      }), 'Parts_Analyser_Full_Inventory.xlsx', 'Inventory');
    };

    const kpis = [
      UI.kpiCard({
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-9"/></svg>',
        iconClass: 'blue', label: 'Total stock value (priced parts)', value: UI.fmtINR(totalStockValue),
        deltaText: unpriced.length > 0 ? (UI.fmtNum(unpriced.length) + ' parts excluded — no price on file') : 'All parts priced',
        deltaClass: unpriced.length > 0 ? 'down' : 'flat',
      }),
      UI.kpiCard({
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
        iconClass: 'amber', label: 'Total parts tracked', value: UI.fmtNum(totalParts),
      }),
      UI.kpiCard({
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/></svg>',
        iconClass: 'red', label: 'Parts at zero stock', value: UI.fmtNum(zeroStockParts),
        deltaText: UI.fmtNum(fastZeroStock.length) + ' are fast movers', deltaClass: fastZeroStock.length > 0 ? 'down' : 'flat',
      }),
      UI.kpiCard({
        icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
        iconClass: 'green', label: 'Fast moving parts', value: UI.fmtNum(a.filter(function (p) { return p.fsnClass === 'Fast'; }).length),
      }),
    ];
    document.getElementById('kpiCards').innerHTML = kpis.join('');

    const fsnTotals = { Fast: 0, Slow: 0, 'Non-moving': 0 };
    const abcTotals = { A: 0, B: 0, C: 0 };
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      fsnTotals[p.fsnClass] += p.stockValue;
      abcTotals[p.abcClass] += p.consumptionValue;
    }
    Charts.fsnValueChart('chartFsnValue', fsnTotals);
    Charts.abcValueChart('chartAbcValue', abcTotals);

    const monthMap = new Map();
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      if (!p.monthlySalesJson) continue;
      let monthly;
      try { monthly = JSON.parse(p.monthlySalesJson); } catch (e) { continue; }
      const keys = Object.keys(monthly);
      for (let j = 0; j < keys.length; j++) {
        const month = keys[j];
        monthMap.set(month, (monthMap.get(month) || 0) + monthly[month]);
      }
    }
    const sortedMonths = Array.from(monthMap.keys()).sort().slice(-6);
    const monthLabels = sortedMonths.map(function (m) {
      const parts = m.split('-');
      return new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    });
    Charts.salesTrendChart('chartSalesTrend', monthLabels, sortedMonths.map(function (m) { return monthMap.get(m); }));

    const topParts = a.slice().sort(function (x, y) { return y.consumptionValue - x.consumptionValue; }).slice(0, 10).reverse();
    Charts.topPartsChart('chartTopParts', topParts.map(function (p) { return p.partNumber; }), topParts.map(function (p) { return p.consumptionValue; }));

    const riskCols = [
      { key: 'partNumber', label: 'Part Number', render: function (r) { return '<span class="cell-strong cell-mono">' + UI.escapeHtml(r.partNumber) + '</span>'; } },
      { key: 'description', label: 'Description', wrap: true },
      { key: 'category', label: 'Category' },
      { key: 'avgDailyDemand', label: 'Avg Daily Demand', align: 'num', render: function (r) { return UI.fmtNum1(r.avgDailyDemand); } },
      { key: 'abcClass', label: 'ABC', render: function (r) { return UI.abcPill(r.abcClass); } },
      { key: 'dlc', label: 'Unit Cost (DLC)', align: 'num', render: function (r) { return UI.fmtPrice(r.dlc); } },
    ];
    UI.renderTable(document.getElementById('riskTable'), riskCols, fastZeroStock, { defaultSortKey: 'avgDailyDemand', pageSize: 10 });
  }

  // ============================================================
  // FSN ANALYSIS
  // ============================================================

  function renderFsn() {
    if (noDataGuard('fsnEmptyState', 'fsnContent')) return;
    const a = state.partAnalytics;

    document.getElementById('fsnFastCount').textContent = UI.fmtNum(a.filter(function (p) { return p.fsnClass === 'Fast'; }).length);
    document.getElementById('fsnSlowCount').textContent = UI.fmtNum(a.filter(function (p) { return p.fsnClass === 'Slow'; }).length);
    document.getElementById('fsnNonCount').textContent = UI.fmtNum(a.filter(function (p) { return p.fsnClass === 'Non-moving'; }).length);

    const categories = Array.from(new Set(a.map(function (p) { return p.category; }).filter(Boolean))).sort();
    UI.populateSelect(document.getElementById('fsnFilterCategory'), categories, 'All categories');

    const cols = [
      { key: 'partNumber', label: 'Part Number', render: function (r) { return '<span class="cell-strong cell-mono">' + UI.escapeHtml(r.partNumber) + '</span>'; } },
      { key: 'description', label: 'Description', wrap: true },
      { key: 'category', label: 'Category' },
      { key: 'fsnClass', label: 'FSN', render: function (r) { return UI.fsnPill(r.fsnClass); } },
      { key: 'daysSoldInWindow', label: 'Days Sold (90d)', align: 'num' },
      { key: 'qtySoldWindow', label: 'Qty Sold (90d)', align: 'num', render: function (r) { return UI.fmtNum(r.qtySoldWindow); } },
      { key: 'actualStockOnHand', label: 'Current Stock', align: 'num', render: function (r) { return UI.fmtNum(r.actualStockOnHand); } },
    ];

    function currentRows() {
      const search = document.getElementById('fsnSearch').value.trim().toLowerCase();
      const cls = document.getElementById('fsnFilterClass').value;
      const cat = document.getElementById('fsnFilterCategory').value;
      let rows = a;
      if (search) rows = rows.filter(function (p) { return p.partNumber.toLowerCase().includes(search) || p.description.toLowerCase().includes(search); });
      if (cls) rows = rows.filter(function (p) { return p.fsnClass === cls; });
      if (cat) rows = rows.filter(function (p) { return p.category === cat; });
      return rows;
    }
    function applyFilters() {
      UI.renderTable(document.getElementById('fsnTable'), cols, currentRows(), { defaultSortKey: 'qtySoldWindow' });
    }
    document.getElementById('fsnSearch').oninput = applyFilters;
    document.getElementById('fsnFilterClass').onchange = applyFilters;
    document.getElementById('fsnFilterCategory').onchange = applyFilters;
    document.getElementById('fsnExportBtn').onclick = function () {
      UI.exportToExcel(currentRows().map(function (r) {
        return {
          'Part Number': r.partNumber, 'Description': r.description, 'Category': r.category,
          'FSN Class': r.fsnClass, 'Days Sold (90d)': r.daysSoldInWindow, 'Qty Sold (90d)': r.qtySoldWindow,
          'Current Stock': r.actualStockOnHand,
        };
      }), 'FSN_Analysis.xlsx', 'FSN Analysis');
    };
    applyFilters();
  }

  // ============================================================
  // ABC ANALYSIS
  // ============================================================

  function renderAbc() {
    if (noDataGuard('abcEmptyState', 'abcContent')) return;
    const a = state.partAnalytics;

    const categories = Array.from(new Set(a.map(function (p) { return p.category; }).filter(Boolean))).sort();
    UI.populateSelect(document.getElementById('abcFilterCategory'), categories, 'All categories');

    const cols = [
      { key: 'partNumber', label: 'Part Number', render: function (r) { return '<span class="cell-strong cell-mono">' + UI.escapeHtml(r.partNumber) + '</span>'; } },
      { key: 'description', label: 'Description', wrap: true },
      { key: 'category', label: 'Category' },
      { key: 'abcClass', label: 'ABC', render: function (r) { return UI.abcPill(r.displayAbcClass || r.abcClass); } },
      { key: 'consumptionValue', label: 'Consumption Value', align: 'num', render: function (r) { return UI.fmtINR(r.consumptionValue); } },
      { key: 'totalSoldAllTime', label: 'Qty Sold (all-time)', align: 'num', render: function (r) { return UI.fmtNum(r.totalSoldAllTime); } },
      { key: 'dlc', label: 'Unit Cost (DLC)', align: 'num', render: function (r) { return UI.fmtPrice(r.dlc); } },
      { key: 'actualStockOnHand', label: 'Current Stock', align: 'num', render: function (r) { return UI.fmtNum(r.actualStockOnHand); } },
    ];

    function currentRows() {
      const search = document.getElementById('abcSearch').value.trim().toLowerCase();
      const cls = document.getElementById('abcFilterClass').value;
      const cat = document.getElementById('abcFilterCategory').value;
      let rows = a;
      if (cat) {
        rows = rows.filter(function (p) { return p.category === cat; });
        const sorted = rows.slice().sort(function (x, y) { return y.consumptionValue - x.consumptionValue; });
        const totalVal = sorted.reduce(function (s, p) { return s + p.consumptionValue; }, 0);
        let cum = 0;
        const classMap = new Map();
        for (let i = 0; i < sorted.length; i++) {
          const p = sorted[i];
          cum += p.consumptionValue;
          const pct = totalVal > 0 ? cum / totalVal : 0;
          let cls2 = 'C';
          if (totalVal > 0 && p.consumptionValue > 0) {
            if (pct <= CONFIG.ABC_A_CUTOFF) cls2 = 'A';
            else if (pct <= CONFIG.ABC_B_CUTOFF) cls2 = 'B';
          }
          classMap.set(p.partNumber, cls2);
        }
        rows = rows.map(function (p) { return Object.assign({}, p, { displayAbcClass: classMap.get(p.partNumber) }); });
        document.getElementById('abcCategoryNote').textContent =
          'Showing ABC classes recomputed within "' + cat + '" only (' + rows.length + ' parts), so this category\u2019s own A/B/C bands are independent of every other category\u2019s pricing.';
      } else {
        rows = rows.map(function (p) { return Object.assign({}, p, { displayAbcClass: p.abcClass }); });
        document.getElementById('abcCategoryNote').textContent =
          'Showing ABC classes computed across all categories combined. Select a category above to recompute A/B/C bands within just that category.';
      }
      if (search) rows = rows.filter(function (p) { return p.partNumber.toLowerCase().includes(search) || p.description.toLowerCase().includes(search); });
      if (cls) rows = rows.filter(function (p) { return (p.displayAbcClass || p.abcClass) === cls; });
      return rows;
    }
    function applyFilters() {
      const rows = currentRows();
      UI.renderTable(document.getElementById('abcTable'), cols, rows, { defaultSortKey: 'consumptionValue' });

      const inScopeRows = document.getElementById('abcFilterCategory').value ? rows : a;
      const classA = inScopeRows.filter(function (p) { return (p.displayAbcClass || p.abcClass) === 'A'; });
      const classB = inScopeRows.filter(function (p) { return (p.displayAbcClass || p.abcClass) === 'B'; });
      const classC = inScopeRows.filter(function (p) { return (p.displayAbcClass || p.abcClass) === 'C'; });
      document.getElementById('abcACount').textContent = UI.fmtNum(classA.length);
      document.getElementById('abcBCount').textContent = UI.fmtNum(classB.length);
      document.getElementById('abcCCount').textContent = UI.fmtNum(classC.length);
      document.getElementById('abcAValue').textContent = UI.fmtINR(classA.reduce(function (s, p) { return s + p.consumptionValue; }, 0)) + ' consumption value';
      document.getElementById('abcBValue').textContent = UI.fmtINR(classB.reduce(function (s, p) { return s + p.consumptionValue; }, 0)) + ' consumption value';
      document.getElementById('abcCValue').textContent = UI.fmtINR(classC.reduce(function (s, p) { return s + p.consumptionValue; }, 0)) + ' consumption value';
    }
    document.getElementById('abcSearch').oninput = applyFilters;
    document.getElementById('abcFilterClass').onchange = applyFilters;
    document.getElementById('abcFilterCategory').onchange = applyFilters;
    document.getElementById('abcExportBtn').onclick = function () {
      UI.exportToExcel(currentRows().map(function (r) {
        return {
          'Part Number': r.partNumber, 'Description': r.description, 'Category': r.category,
          'ABC Class': r.displayAbcClass || r.abcClass, 'Consumption Value': Math.round(r.consumptionValue),
          'Qty Sold (all-time)': r.totalSoldAllTime, 'DLC': r.dlc, 'Current Stock': r.actualStockOnHand,
        };
      }), 'ABC_Analysis.xlsx', 'ABC Analysis');
    };
    applyFilters();
  }

  // ============================================================
  // CATEGORY ANALYTICS
  // ============================================================

  function renderCategory() {
    if (noDataGuard('categoryEmptyState', 'categoryContent')) return;
    const a = state.partAnalytics;
    const rollup = Engine.buildCategoryRollup(a);

    Charts.categoryValueChart('chartCategoryValue',
      rollup.map(function (c) { return c.category; }),
      rollup.map(function (c) { return c.consumptionValue; }),
      rollup.map(function (c) { return c.stockValue; }));

    const cols = [
      { key: 'category', label: 'Category', render: function (r) { return '<span class="cell-strong">' + UI.escapeHtml(r.category) + '</span>'; } },
      { key: 'partCount', label: 'Parts', align: 'num', render: function (r) { return UI.fmtNum(r.partCount); } },
      { key: 'stockValue', label: 'Stock Value', align: 'num', render: function (r) { return UI.fmtINR(r.stockValue); } },
      { key: 'consumptionValue', label: 'Consumption Value', align: 'num', render: function (r) { return UI.fmtINR(r.consumptionValue); } },
      { key: 'fastCount', label: 'Fast', align: 'num', render: function (r) { return UI.fmtNum(r.fastCount); } },
      { key: 'slowCount', label: 'Slow', align: 'num', render: function (r) { return UI.fmtNum(r.slowCount); } },
      { key: 'nonMovingCount', label: 'Non-moving', align: 'num', render: function (r) { return UI.fmtNum(r.nonMovingCount); } },
      { key: 'aCount', label: 'A', align: 'num', render: function (r) { return UI.fmtNum(r.aCount); } },
      { key: 'zeroStockCount', label: 'Zero Stock', align: 'num', render: function (r) { return UI.fmtNum(r.zeroStockCount); } },
      { key: 'unpricedCount', label: 'Unpriced', align: 'num', render: function (r) { return r.unpricedCount > 0 ? ('<span style="color:var(--warning);font-weight:600;">' + UI.fmtNum(r.unpricedCount) + '</span>') : '0'; } },
    ];
    UI.renderTable(document.getElementById('categoryTable'), cols, rollup, { defaultSortKey: 'consumptionValue', paginate: false });

    document.getElementById('categoryExportBtn').onclick = function () {
      UI.exportToExcel(rollup.map(function (c) {
        return {
          'Category': c.category, 'Parts': c.partCount, 'Stock Value': Math.round(c.stockValue),
          'Consumption Value': Math.round(c.consumptionValue), 'Fast': c.fastCount, 'Slow': c.slowCount,
          'Non-moving': c.nonMovingCount, 'A Class': c.aCount, 'B Class': c.bCount, 'C Class': c.cCount,
          'Zero Stock': c.zeroStockCount, 'Unpriced': c.unpricedCount,
        };
      }), 'Category_Analytics.xlsx', 'Categories');
    };
  }

  // ============================================================
  // TREND ANALYTICS
  // ============================================================

  function renderTrends() {
    if (noDataGuard('trendsEmptyState', 'trendsContent')) return;
    const a = state.partAnalytics;

    const monthMap = new Map();
    for (let i = 0; i < a.length; i++) {
      const p = a[i];
      if (!p.monthlySalesJson) continue;
      let monthly;
      try { monthly = JSON.parse(p.monthlySalesJson); } catch (e) { continue; }
      const keys = Object.keys(monthly);
      for (let j = 0; j < keys.length; j++) {
        const month = keys[j];
        if (!monthMap.has(month)) monthMap.set(month, { qty: 0, value: 0 });
        const m = monthMap.get(month);
        m.qty += monthly[month];
        const dlcForMath = p.dlc !== null ? p.dlc : 0;
        m.value += monthly[month] * dlcForMath;
      }
    }
    const sortedMonths = Array.from(monthMap.keys()).sort();
    const labels = sortedMonths.map(function (m) {
      const parts = m.split('-');
      return new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    });
    Charts.monthlyTrendChart('chartMonthlyTrend', labels,
      sortedMonths.map(function (m) { return monthMap.get(m).qty; }),
      sortedMonths.map(function (m) { return monthMap.get(m).value; }));

    const trendRows = a.map(function (p) {
      return {
        partNumber: p.partNumber, description: p.description, category: p.category,
        recentQty: p.qtySoldLast30 || 0, priorQty: p.qtySoldPrior30 || 0,
        delta: (p.qtySoldLast30 || 0) - (p.qtySoldPrior30 || 0),
      };
    }).filter(function (r) { return r.recentQty > 0 || r.priorQty > 0; });

    const trendUp = trendRows.filter(function (r) { return r.delta > 0; }).sort(function (a2, b) { return b.delta - a2.delta; }).slice(0, 15);
    const trendDown = trendRows.filter(function (r) { return r.delta < 0; }).sort(function (a2, b) { return a2.delta - b.delta; }).slice(0, 15);

    const trendCols = [
      { key: 'partNumber', label: 'Part Number', render: function (r) { return '<span class="cell-strong cell-mono">' + UI.escapeHtml(r.partNumber) + '</span>'; } },
      { key: 'description', label: 'Description', wrap: true },
      { key: 'recentQty', label: 'Last 30d', align: 'num', render: function (r) { return UI.fmtNum(r.recentQty); } },
      { key: 'priorQty', label: 'Prior 30d', align: 'num', render: function (r) { return UI.fmtNum(r.priorQty); } },
      { key: 'delta', label: 'Change', align: 'num', render: function (r) { return '<span style="color:' + (r.delta >= 0 ? 'var(--success)' : 'var(--danger)') + ';font-weight:600;">' + (r.delta >= 0 ? '+' : '') + UI.fmtNum(r.delta) + '</span>'; } },
    ];
    UI.renderTable(document.getElementById('trendUpTable'), trendCols, trendUp, { paginate: false, defaultSortKey: 'delta' });
    UI.renderTable(document.getElementById('trendDownTable'), trendCols, trendDown, { paginate: false, defaultSortKey: 'delta', defaultSortDir: 'asc' });
  }

  // ============================================================
  // PART EXPLORER
  // ============================================================

  function renderParts() {
    if (noDataGuard('partsEmptyState', 'partsContent')) return;
    const a = state.partAnalytics;

    const categories = Array.from(new Set(a.map(function (p) { return p.category; }).filter(Boolean))).sort();
    UI.populateSelect(document.getElementById('partsFilterCategory'), categories, 'All categories');

    const cols = [
      { key: 'partNumber', label: 'Part Number', render: function (r) { return '<span class="cell-strong cell-mono">' + UI.escapeHtml(r.partNumber) + '</span>'; } },
      { key: 'description', label: 'Description', wrap: true },
      { key: 'category', label: 'Category' },
      { key: 'fsnClass', label: 'FSN', render: function (r) { return UI.fsnPill(r.fsnClass); } },
      { key: 'abcClass', label: 'ABC', render: function (r) { return UI.abcPill(r.abcClass); } },
      { key: 'actualStockOnHand', label: 'Stock', align: 'num', render: function (r) { return UI.fmtNum(r.actualStockOnHand); } },
      { key: 'avgDailyDemand', label: 'Avg Daily Demand', align: 'num', render: function (r) { return UI.fmtNum1(r.avgDailyDemand); } },
      { key: 'totalSoldAllTime', label: 'Sold (all-time)', align: 'num', render: function (r) { return UI.fmtNum(r.totalSoldAllTime); } },
      { key: 'lastSaleDate', label: 'Last Sale', render: function (r) { return UI.fmtDate(r.lastSaleDate); } },
      { key: 'mrp', label: 'MRP', align: 'num', render: function (r) { return UI.fmtPrice(r.mrp); } },
      { key: 'dlc', label: 'DLC', align: 'num', render: function (r) { return UI.fmtPrice(r.dlc); } },
    ];

    function currentRows() {
      const search = document.getElementById('partsSearch').value.trim().toLowerCase();
      const cat = document.getElementById('partsFilterCategory').value;
      const fsn = document.getElementById('partsFilterFsn').value;
      const abc = document.getElementById('partsFilterAbc').value;
      const stockFilter = document.getElementById('partsFilterStock').value;
      let rows = a;
      if (search) rows = rows.filter(function (p) { return p.partNumber.toLowerCase().includes(search) || p.description.toLowerCase().includes(search); });
      if (cat) rows = rows.filter(function (p) { return p.category === cat; });
      if (fsn) rows = rows.filter(function (p) { return p.fsnClass === fsn; });
      if (abc) rows = rows.filter(function (p) { return p.abcClass === abc; });
      if (stockFilter === 'zero') rows = rows.filter(function (p) { return p.actualStockOnHand <= 0; });
      if (stockFilter === 'low') rows = rows.filter(function (p) { return p.actualStockOnHand < p.avgDailyDemand * 14; });
      if (stockFilter === 'unpriced') rows = rows.filter(function (p) { return !p.hasPrice; });
      return rows;
    }
    function applyFilters() {
      UI.renderTable(document.getElementById('partsTable'), cols, currentRows(), { defaultSortKey: 'partNumber', defaultSortDir: 'asc' });
    }
    document.getElementById('partsSearch').oninput = applyFilters;
    ['partsFilterCategory', 'partsFilterFsn', 'partsFilterAbc', 'partsFilterStock'].forEach(function (id) {
      document.getElementById(id).onchange = applyFilters;
    });
    document.getElementById('partsExportBtn').onclick = function () {
      UI.exportToExcel(currentRows().map(function (r) {
        return {
          'Part Number': r.partNumber, 'Description': r.description, 'Category': r.category,
          'FSN': r.fsnClass, 'ABC': r.abcClass, 'Stock': r.actualStockOnHand,
          'Avg Daily Demand': Number(r.avgDailyDemand.toFixed(2)), 'Sold (all-time)': r.totalSoldAllTime,
          'Last Sale': r.lastSaleDate ? UI.fmtDate(r.lastSaleDate) : '', 'MRP': r.mrp, 'DLC': r.dlc,
        };
      }), 'Part_Explorer.xlsx', 'Parts');
    };
    applyFilters();
  }

  // ============================================================
  // LEDGER EXPLORER (paginated from backend — never loads the full ledger)
  // ============================================================

  function renderLedger() {
    if (noDataGuard('ledgerEmptyState', 'ledgerContent')) return;

    const orderTypes = ['Service Order', 'Parts Sale Order', 'Purchase Order', 'b2b', 'Parts Inventory Addition', 'Stock Adjustment'];
    UI.populateSelect(document.getElementById('ledgerFilterOrderType'), orderTypes, 'All order types');
    UI.populateSelect(document.getElementById('ledgerFilterStatus'), ['Open', 'Closed', 'Cancelled'], 'All statuses');

    const cols = [
      { key: 'Date', label: 'Date', render: function (r) { return UI.fmtDate(r['Date']); } },
      { key: 'Part Number', label: 'Part Number', render: function (r) { return '<span class="cell-mono">' + UI.escapeHtml(r['Part Number']) + '</span>'; } },
      { key: 'Order Type', label: 'Order Type' },
      { key: 'Order Number', label: 'Order #', render: function (r) { return '<span class="cell-mono">' + UI.escapeHtml(r['Order Number']) + '</span>'; } },
      { key: 'Invoice Number', label: 'Invoice #', render: function (r) { return '<span class="cell-mono">' + UI.escapeHtml(r['Invoice Number']) + '</span>'; } },
      { key: 'Invoice Status', label: 'Status' },
      { key: 'Quantity In', label: 'Qty In', align: 'num', render: function (r) { return r['Quantity In'] ? UI.fmtNum(r['Quantity In']) : '—'; } },
      { key: 'Quantity Out', label: 'Qty Out', align: 'num', render: function (r) { return r['Quantity Out'] ? UI.fmtNum(r['Quantity Out']) : '—'; } },
    ];

    function loadAndRenderPage(page) {
      UI.showLoading('Loading transactions…');
      Api.getLedgerPage(page, CONFIG.LEDGER_PAGE_SIZE).then(function (result) {
        state.ledgerPage = result.page;
        state.ledgerPageData = result.data;
        state.ledgerTotalPages = result.totalPages;
        state.ledgerTotalRows = result.totalRows;
        renderTableForCurrentState();
      }).catch(function (err) {
        UI.toast('Could not load ledger page: ' + err.message, 'error');
      }).finally(function () {
        UI.hideLoading();
      });
    }

    function searchSinglePart(partNumber) {
      UI.showLoading('Loading full history for ' + partNumber + '…');
      Api.getLedgerForPart(partNumber).then(function (data) {
        state.ledgerSinglePartMode = true;
        state.ledgerSinglePartData = data;
        renderTableForCurrentState();
      }).catch(function (err) {
        UI.toast('Could not load part history: ' + err.message, 'error');
      }).finally(function () {
        UI.hideLoading();
      });
    }

    function applyClientFilters(rows) {
      const orderType = document.getElementById('ledgerFilterOrderType').value;
      const status = document.getElementById('ledgerFilterStatus').value;
      const from = document.getElementById('ledgerFilterFrom').value;
      const to = document.getElementById('ledgerFilterTo').value;
      let filtered = rows;
      if (orderType) filtered = filtered.filter(function (r) { return r['Order Type'] === orderType; });
      if (status) filtered = filtered.filter(function (r) { return r['Invoice Status'] === status; });
      if (from) filtered = filtered.filter(function (r) { return new Date(r['Date']) >= new Date(from); });
      if (to) filtered = filtered.filter(function (r) { return new Date(r['Date']) <= new Date(to + 'T23:59:59'); });
      return filtered;
    }

    function renderTableForCurrentState() {
      const source = state.ledgerSinglePartMode ? state.ledgerSinglePartData : state.ledgerPageData;
      const filtered = applyClientFilters(source);

      if (state.ledgerSinglePartMode) {
        document.getElementById('ledgerRowCount').innerHTML =
          'Showing full history for this part — <strong>' + UI.fmtNum(filtered.length) + '</strong> transactions. <a href="#" id="ledgerBackToPaged" style="color:var(--accent);font-weight:600;">&larr; Back to browsing all transactions</a>';
        const backLink = document.getElementById('ledgerBackToPaged');
        if (backLink) backLink.onclick = function (e) {
          e.preventDefault();
          state.ledgerSinglePartMode = false;
          document.getElementById('ledgerSearch').value = '';
          renderTableForCurrentState();
        };
        document.getElementById('ledgerPrevPage').style.visibility = 'hidden';
        document.getElementById('ledgerNextPage').style.visibility = 'hidden';
        document.getElementById('ledgerPageInfo').textContent = '';
      } else {
        document.getElementById('ledgerRowCount').textContent =
          'Page ' + (state.ledgerPage + 1) + ' of ' + state.ledgerTotalPages + ' — ' + UI.fmtNum(state.ledgerTotalRows) + ' transactions total. Type a full part number and press Enter to see one part\u2019s complete history.';
        document.getElementById('ledgerPrevPage').style.visibility = 'visible';
        document.getElementById('ledgerNextPage').style.visibility = 'visible';
        document.getElementById('ledgerPageInfo').textContent = 'Page ' + (state.ledgerPage + 1) + ' of ' + state.ledgerTotalPages;
      }

      UI.renderTable(document.getElementById('ledgerTable'), cols, filtered, { defaultSortKey: 'Date', paginate: false });
    }

    document.getElementById('ledgerSearch').onkeydown = function (e) {
      if (e.key === 'Enter') {
        const val = e.target.value.trim();
        if (val) searchSinglePart(val);
      }
    };
    document.getElementById('ledgerSearch').oninput = function (e) {
      if (e.target.value.trim() === '' && state.ledgerSinglePartMode) {
        state.ledgerSinglePartMode = false;
        renderTableForCurrentState();
      }
    };
    ['ledgerFilterOrderType', 'ledgerFilterStatus', 'ledgerFilterFrom', 'ledgerFilterTo'].forEach(function (id) {
      document.getElementById(id).addEventListener('change', renderTableForCurrentState);
    });
    document.getElementById('ledgerPrevPage').onclick = function () { if (state.ledgerPage > 0) loadAndRenderPage(state.ledgerPage - 1); };
    document.getElementById('ledgerNextPage').onclick = function () { if (state.ledgerPage < state.ledgerTotalPages - 1) loadAndRenderPage(state.ledgerPage + 1); };

    document.getElementById('ledgerExportBtn').onclick = function () {
      const source = state.ledgerSinglePartMode ? state.ledgerSinglePartData : state.ledgerPageData;
      const filtered = applyClientFilters(source);
      UI.exportToExcel(filtered, 'Ledger_Export.xlsx', 'Ledger');
    };

    if (state.ledgerPageData.length === 0 && !state.ledgerSinglePartMode) {
      loadAndRenderPage(0);
    } else {
      renderTableForCurrentState();
    }
  }

  // ============================================================
  // ORDER PLANNING (restricted to configured categories — default HHML Parts)
  // ============================================================

  function renderOrderPlanning() {
    if (noDataGuard('orderEmptyState', 'orderContent')) return;

    const categories = CONFIG.ORDER_PLANNING_CATEGORIES;
    const notice = document.getElementById('orderCategoryNotice');
    if (categories && categories.length > 0) {
      notice.style.display = 'flex';
      document.getElementById('orderCategoryNoticeText').innerHTML =
        'Suggested orders only include parts in: <strong>' + categories.map(UI.escapeHtml).join(', ') + '</strong>. ' +
        'Parts in other categories are never suggested here, even if they qualify by stock and sales. Change this in <code>ORDER_PLANNING_CATEGORIES</code> in js/config.js.';
      document.getElementById('budgetCockpitSubtitle').textContent =
        '\u20B9' + CONFIG.MONTHLY_ORDER_CAP.toLocaleString('en-IN') + ' monthly cap split across 4 Mondays — ' + categories.join(', ') + ' only, funded by FSN/ABC priority';
    } else {
      notice.style.display = 'none';
      document.getElementById('budgetCockpitSubtitle').textContent =
        '\u20B9' + CONFIG.MONTHLY_ORDER_CAP.toLocaleString('en-IN') + ' monthly cap split across 4 Mondays — funded by FSN/ABC priority';
    }

    document.getElementById('generatePlanBtn').onclick = function () {
      state.orderPlan = Engine.buildOrderPlan(state.partAnalytics, CONFIG);
      UI.toast('Weekly order plan generated', 'success');
      renderOrderPlanCockpit();
    };

    document.getElementById('exportPlanBtn').onclick = exportCurrentPlanExcel;
    document.getElementById('approvePlanBtn').onclick = approveCurrentPlan;
    document.getElementById('planWeekSelect').onchange = renderPlanLineTable;
    document.getElementById('planSearch').oninput = renderPlanLineTable;
    document.getElementById('planHistoryExportBtn').onclick = function () {
      UI.exportToExcel(state.rawOrderPlans, 'Order_Plan_History.xlsx', 'Order Plans');
    };

    renderOrderPlanCockpit();
    renderPlanHistory();
  }

  function renderOrderPlanCockpit() {
    const result = state.orderPlan;
    const mondays = Engine.nextFourMondays(state.referenceDate < new Date() ? new Date() : state.referenceDate);
    const select = document.getElementById('planWeekSelect');
    select.innerHTML = mondays.map(function (d, i) { return '<option value="' + i + '">Week ' + (i + 1) + ' — ' + UI.fmtDate(d) + '</option>'; }).join('');

    const weekStrip = document.getElementById('weekStrip');
    const skippedCard = document.getElementById('skippedNoPriceCard');

    if (!result) {
      weekStrip.innerHTML = '<div class="text-sm text-muted">Click "Generate this week\'s plan" to calculate suggested order quantities from current stock and 90-day sales velocity.</div>';
      document.getElementById('gaugeMonthPct').textContent = '0%';
      document.getElementById('gaugeMonthSpend').textContent = '\u20B90 of ' + UI.fmtINR(CONFIG.MONTHLY_ORDER_CAP) + ' planned this month';
      setGaugeArc(0);
      document.getElementById('planWeekSubtitle').textContent = 'Generate a plan to see suggested order lines';
      document.getElementById('planTable').innerHTML = '';
      skippedCard.style.display = 'none';
      return;
    }

    const plan = result.weeks;
    const totalSpend = plan.reduce(function (s, w) { return s + w.spend; }, 0);
    const monthPct = CONFIG.MONTHLY_ORDER_CAP > 0 ? totalSpend / CONFIG.MONTHLY_ORDER_CAP : 0;
    document.getElementById('gaugeMonthPct').textContent = Math.round(monthPct * 100) + '%';
    document.getElementById('gaugeMonthSpend').textContent = UI.fmtINR(totalSpend) + ' of ' + UI.fmtINR(CONFIG.MONTHLY_ORDER_CAP) + ' planned this month';
    setGaugeArc(monthPct);

    weekStrip.innerHTML = plan.map(function (w, i) {
      const pct = Math.min(100, w.utilisationPct * 100);
      const over = w.spend > w.budget;
      return '' +
        '<div class="week-row">' +
          '<div>' +
            '<div class="week-label">Week ' + w.weekNumber + '</div>' +
            '<span class="week-date">' + UI.fmtDate(mondays[i]) + '</span>' +
          '</div>' +
          '<div class="week-bar-track"><div class="week-bar-fill ' + (over ? 'over' : '') + '" style="width:' + pct + '%"></div></div>' +
          '<div class="week-amount">' + UI.fmtINR(w.spend) + ' / ' + UI.fmtINR(w.budget) + '</div>' +
          '<div class="week-lines">' + w.lines.length + ' parts</div>' +
        '</div>';
    }).join('');

    if (result.skippedNoPrice && result.skippedNoPrice.length > 0) {
      skippedCard.style.display = 'block';
      const skippedCols = [
        { key: 'partNumber', label: 'Part Number', render: function (r) { return '<span class="cell-mono">' + UI.escapeHtml(r.partNumber) + '</span>'; } },
        { key: 'description', label: 'Description', wrap: true },
        { key: 'suggestedQty', label: 'Would-be Qty', align: 'num', render: function (r) { return UI.fmtNum(r.suggestedQty); } },
      ];
      UI.renderTable(document.getElementById('skippedNoPriceTable'), skippedCols, result.skippedNoPrice, { paginate: false, defaultSortKey: 'suggestedQty' });
    } else {
      skippedCard.style.display = 'none';
    }

    renderPlanLineTable();
  }

  function setGaugeArc(pct) {
    const circumference = 2 * Math.PI * 78;
    const arc = document.getElementById('gaugeArc');
    arc.setAttribute('stroke-dasharray', circumference);
    arc.setAttribute('stroke-dashoffset', circumference * (1 - Math.min(1, pct)));
    arc.setAttribute('stroke', pct > 1 ? '#E2483D' : '#F2994A');
  }

  function renderPlanLineTable() {
    const result = state.orderPlan;
    if (!result) return;
    const weekIdx = Number(document.getElementById('planWeekSelect').value || 0);
    const week = result.weeks[weekIdx];
    const mondays = Engine.nextFourMondays(state.referenceDate < new Date() ? new Date() : state.referenceDate);
    document.getElementById('planWeekSubtitle').textContent = 'Week ' + week.weekNumber + ' — Monday ' + UI.fmtDate(mondays[weekIdx]) + ' — ' + UI.fmtINR(week.spend) + ' of ' + UI.fmtINR(week.budget) + ' budget used';

    const search = document.getElementById('planSearch').value.trim().toLowerCase();
    let lines = week.lines;
    if (search) lines = lines.filter(function (l) { return l.partNumber.toLowerCase().includes(search) || (l.description || '').toLowerCase().includes(search); });

    const cols = [
      { key: 'partNumber', label: 'Part Number', render: function (r) { return '<span class="cell-strong cell-mono">' + UI.escapeHtml(r.partNumber) + '</span>'; } },
      { key: 'description', label: 'Description', wrap: true },
      { key: 'category', label: 'Category' },
      { key: 'fsnClass', label: 'FSN', render: function (r) { return UI.fsnPill(r.fsnClass); } },
      { key: 'abcClass', label: 'ABC', render: function (r) { return UI.abcPill(r.abcClass); } },
      { key: 'actualStockOnHand', label: 'Current Stock', align: 'num', render: function (r) { return UI.fmtNum(r.actualStockOnHand); } },
      { key: 'avgDailyDemand', label: 'Avg Daily Demand', align: 'num', render: function (r) { return UI.fmtNum1(r.avgDailyDemand); } },
      { key: 'moq', label: 'MOQ', align: 'num', render: function (r) { return r.moq ? UI.fmtNum(r.moq) : '—'; } },
      { key: 'approvedQty', label: 'Order Qty', align: 'num', render: function (r) {
        let extra = '';
        if (r.fundedFully === false && !r.deferred) extra = ' <span class="text-sm" style="color:var(--warning)">(partial)</span>';
        if (r.deferred) extra = ' <span class="text-sm" style="color:var(--danger)">(deferred)</span>';
        return '<span class="cell-strong">' + UI.fmtNum(r.approvedQty) + '</span>' + extra;
      } },
      { key: 'dlc', label: 'Unit Cost', align: 'num', render: function (r) { return UI.fmtPrice(r.dlc); } },
      { key: 'lineValue', label: 'Line Value', align: 'num', render: function (r) { return UI.fmtINR(r.lineValue); } },
    ];
    UI.renderTable(document.getElementById('planTable'), cols, lines, { defaultSortKey: 'lineValue', paginate: false });
  }

  function exportCurrentPlanExcel() {
    const result = state.orderPlan;
    if (!result) { UI.toast('Generate a plan first', 'error'); return; }
    const weekIdx = Number(document.getElementById('planWeekSelect').value || 0);
    const week = result.weeks[weekIdx];
    const mondays = Engine.nextFourMondays(state.referenceDate < new Date() ? new Date() : state.referenceDate);

    UI.exportToExcel(week.lines.map(function (l) {
      return {
        'Part Number': l.partNumber, 'Description': l.description, 'Category': l.category,
        'FSN Class': l.fsnClass, 'ABC Class': l.abcClass, 'Current Stock': l.actualStockOnHand,
        'Avg Daily Demand': Number(l.avgDailyDemand.toFixed(2)), 'MOQ': l.moq, 'Order Qty': l.approvedQty,
        'Unit Cost (DLC)': l.dlc, 'Line Value': Math.round(l.lineValue),
      };
    }), 'Order_Plan_Week' + (weekIdx + 1) + '_' + mondays[weekIdx].toISOString().slice(0, 10) + '.xlsx', 'Order Plan');
  }

  function approveCurrentPlan() {
    const result = state.orderPlan;
    if (!result) { UI.toast('Generate a plan first', 'error'); return; }
    if (!Api.isConfigured()) { UI.toast('Connect Google Sheets backend in config.js to save plans', 'error'); return; }

    const weekIdx = Number(document.getElementById('planWeekSelect').value || 0);
    const week = result.weeks[weekIdx];
    const mondays = Engine.nextFourMondays(state.referenceDate < new Date() ? new Date() : state.referenceDate);
    const planId = 'PLAN-' + mondays[weekIdx].toISOString().slice(0, 10) + '-' + Date.now();

    const rows = week.lines.map(function (l) {
      return {
        'Plan ID': planId,
        'Monday Date': mondays[weekIdx].toISOString().slice(0, 10),
        'Part Number': l.partNumber,
        'Part Description': l.description,
        'Category': l.category,
        'FSN Class': l.fsnClass,
        'ABC Class': l.abcClass,
        'Suggested Qty': l.suggestedQty,
        'Approved Qty': l.approvedQty,
        'Unit Cost (DLC)': l.dlc,
        'Line Value': l.lineValue,
        'Status': 'Approved',
      };
    });

    UI.showLoading('Saving order plan…');
    Api.saveOrderPlan(rows).then(function () {
      UI.toast('Plan saved — ' + rows.length + ' parts, ' + UI.fmtINR(week.spend), 'success');
      return loadFromBackend(false);
    }).then(function () {
      renderOrderPlanning();
    }).catch(function (err) {
      UI.toast('Could not save plan: ' + err.message, 'error');
    }).finally(function () {
      UI.hideLoading();
    });
  }

  function renderPlanHistory() {
    const rows = state.rawOrderPlans || [];
    const cols = [
      { key: 'Monday Date', label: 'Monday', render: function (r) { return r['Monday Date']; } },
      { key: 'Part Number', label: 'Part Number', render: function (r) { return '<span class="cell-mono">' + UI.escapeHtml(r['Part Number']) + '</span>'; } },
      { key: 'Part Description', label: 'Description', wrap: true },
      { key: 'FSN Class', label: 'FSN', render: function (r) { return UI.fsnPill(r['FSN Class']); } },
      { key: 'ABC Class', label: 'ABC', render: function (r) { return UI.abcPill(r['ABC Class']); } },
      { key: 'Approved Qty', label: 'Qty', align: 'num' },
      { key: 'Line Value', label: 'Line Value', align: 'num', render: function (r) { return UI.fmtINR(r['Line Value']); } },
      { key: 'Status', label: 'Status', render: function (r) { return UI.statusPill(r['Status']); } },
    ];
    UI.renderTable(document.getElementById('planHistoryTable'), cols, rows, { defaultSortKey: 'Monday Date', pageSize: 15 });
  }

  // ============================================================
  // AI INSIGHTS
  // ============================================================

  function renderAi() {
    if (noDataGuard('aiEmptyState', 'aiContent')) return;

    document.getElementById('generateAiBtn').onclick = function () {
      const body = document.getElementById('aiPanelBody');
      const btn = document.getElementById('generateAiBtn');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner light"></span> Generating…';
      body.classList.remove('placeholder');
      body.textContent = 'Analysing your inventory…';

      const orderPlanWeeks = state.orderPlan ? state.orderPlan.weeks : null;
      AiInsights.getInsights(state.partAnalytics, orderPlanWeeks, state.meta).then(function (result) {
        btn.disabled = false;
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="4"/></svg> Generate insights';

        if (result.ok) {
          body.textContent = result.text;
        } else if (result.error === 'NOT_CONFIGURED') {
          body.innerHTML = 'Add your free Gemini API key to <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;">GEMINI_API_KEY</code> in <code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;">Code.gs</code> (in your Google Sheet\'s Apps Script editor), then redeploy. Get one free at <a href="https://aistudio.google.com/app/apikey" target="_blank" style="color:var(--accent);text-decoration:underline;">aistudio.google.com/app/apikey</a>.';
          body.classList.add('placeholder');
        } else {
          body.textContent = result.message || 'Could not generate insights right now. Please try again.';
          UI.toast('AI insight generation failed', 'error');
        }
      });
    };
  }

  // ============================================================
  // SETTINGS
  // ============================================================

  function renderSettings() {
    const statusEl = document.getElementById('settingsConnectionStatus');
    if (Api.isConfigured()) {
      statusEl.innerHTML = '<div class="upload-result success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg><span>Google Apps Script URL is configured.</span></div>';
    } else {
      statusEl.innerHTML = '<div class="upload-result error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span>No backend connected. Paste your Google Apps Script Web App URL into js/config.js as GOOGLE_SCRIPT_URL.</span></div>';
    }

    const rulesGrid = document.getElementById('settingsRulesGrid');
    const rules = [
      ['Monthly order cap', UI.fmtINR(CONFIG.MONTHLY_ORDER_CAP)],
      ['FSN lookback window', CONFIG.FSN_WINDOW_DAYS + ' days'],
      ['Order cover target', CONFIG.ORDER_COVER_WEEKS + ' weeks of demand'],
      ['Fast-moving threshold', 'sold on ' + CONFIG.FSN_FAST_MIN_DAYS_SOLD + '+ distinct days'],
      ['ABC class A cutoff', Math.round(CONFIG.ABC_A_CUTOFF * 100) + '% cumulative value'],
      ['ABC class B cutoff', Math.round(CONFIG.ABC_B_CUTOFF * 100) + '% cumulative value'],
      ['Order planning categories', (CONFIG.ORDER_PLANNING_CATEGORIES && CONFIG.ORDER_PLANNING_CATEGORIES.length) ? CONFIG.ORDER_PLANNING_CATEGORIES.join(', ') : 'All categories'],
    ];
    rulesGrid.innerHTML = rules.map(function (pair) {
      return '<div class="stat-card"><div class="stat-label">' + UI.escapeHtml(pair[0]) + '</div><div class="stat-value" style="font-size:18px;">' + UI.escapeHtml(pair[1]) + '</div></div>';
    }).join('');

    document.getElementById('clearLedgerBtn').onclick = function () {
      UI.showModal({
        title: 'Clear ledger data?',
        body: 'This permanently deletes all ledger rows and the part summary from the connected Google Sheet. This cannot be undone.',
        confirmLabel: 'Clear ledger', danger: true,
        onConfirm: function () {
          UI.showLoading('Clearing ledger…');
          Api.callPostSafe('clearLedger').then(function () {
            UI.toast('Ledger cleared', 'success');
            return loadFromBackend(false);
          }).then(function () {
            renderCurrentView();
          }).catch(function (err) {
            UI.toast('Failed: ' + err.message, 'error');
          }).finally(function () {
            UI.hideLoading();
          });
        },
      });
    };
    document.getElementById('clearInventoryBtn').onclick = function () {
      UI.showModal({
        title: 'Clear inventory data?',
        body: 'This permanently deletes the inventory snapshot from the connected Google Sheet. This cannot be undone.',
        confirmLabel: 'Clear inventory', danger: true,
        onConfirm: function () {
          UI.showLoading('Clearing inventory…');
          Api.callPostSafe('clearInventory').then(function () {
            UI.toast('Inventory cleared', 'success');
            return loadFromBackend(false);
          }).then(function () {
            renderCurrentView();
          }).catch(function (err) {
            UI.toast('Failed: ' + err.message, 'error');
          }).finally(function () {
            UI.hideLoading();
          });
        },
      });
    };
  }

  // ============================================================
  // UPLOAD HANDLING
  // ============================================================

  function wireUploadZone(zoneId, inputId, resultId, kind) {
    const zone = document.getElementById(zoneId);
    const input = document.getElementById(inputId);
    const resultEl = document.getElementById(resultId);

    zone.addEventListener('click', function () { input.click(); });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('dragover'); });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) handleUploadFile(e.dataTransfer.files[0], kind, resultEl);
    });
    input.addEventListener('change', function () {
      if (input.files.length > 0) handleUploadFile(input.files[0], kind, resultEl);
      input.value = '';
    });
  }

  function handleUploadFile(file, kind, resultEl) {
    resultEl.innerHTML = '<div class="upload-result info"><span class="spinner"></span><span>Parsing ' + UI.escapeHtml(file.name) + '…</span></div>';
    FileParser.parseFile(file).then(function (rawRows) {
      if (!rawRows || rawRows.length === 0) throw new Error('File appears to be empty');

      let mapped, count;
      if (kind === 'ledger') {
        mapped = rawRows.filter(function (r) {
          const pn = r['Part Number'] || r['part number'] || r['Part No'] || r['Part #'];
          const dateVal = r['Date'] || r['date'];
          return pn && String(pn).trim() && dateVal && String(dateVal).trim().toLowerCase() !== 'total';
        }).map(FileParser.mapLedgerRow);
        count = mapped.length;
        if (count === 0) throw new Error('No valid ledger rows found — check the file has Date, Part Number and Order Type columns');

        if (!Api.isConfigured()) {
          resultEl.innerHTML = '<div class="upload-result error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span>Connect a Google Apps Script backend in js/config.js first — the ledger is processed there to keep the site fast.</span></div>';
          UI.toast('Backend not configured', 'error');
          return null;
        }

        UI.showLoading('Uploading ' + UI.fmtNum(count) + ' ledger rows and rebuilding the summary…');
        return Api.uploadLedger(mapped).then(function (result) {
          resultEl.innerHTML = uploadSuccessHtml('Uploaded ' + UI.fmtNum(count) + ' ledger rows — summary rebuilt for ' + UI.fmtNum(result.partCount || 0) + ' parts');
          return true;
        });
      } else {
        mapped = rawRows.filter(function (r) {
          const pn = r['Part Number'] || r['Part #'];
          return pn && String(pn).trim();
        }).map(FileParser.mapInventoryRow);
        count = mapped.length;
        if (count === 0) throw new Error('No valid inventory rows found — check the file has a Part # column');

        if (!Api.isConfigured()) {
          state.rawInventory = mapped;
          state.meta = state.meta || {};
          recomputeAnalytics();
          resultEl.innerHTML = uploadSuccessHtml('Parsed ' + UI.fmtNum(count) + ' inventory rows (backend not connected — using locally for this session only; FSN/ABC will show zero sales until a ledger is uploaded through a connected backend)');
          UI.toast('Inventory loaded locally', 'success');
          renderCurrentView();
          return null;
        }

        UI.showLoading('Uploading ' + UI.fmtNum(count) + ' inventory rows…');
        return Api.uploadInventory(mapped).then(function () {
          resultEl.innerHTML = uploadSuccessHtml('Uploaded ' + UI.fmtNum(count) + ' inventory rows successfully');
          return true;
        });
      }
    }).then(function (shouldReload) {
      if (shouldReload) {
        UI.toast((kind === 'ledger' ? 'Ledger' : 'Inventory') + ' uploaded', 'success');
        return loadFromBackend(false).then(function () { renderCurrentView(); });
      }
    }).catch(function (err) {
      resultEl.innerHTML = '<div class="upload-result error"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg><span>' + UI.escapeHtml(err.message) + '</span></div>';
      UI.toast('Upload failed: ' + err.message, 'error');
    }).finally(function () {
      UI.hideLoading();
    });
  }

  function uploadSuccessHtml(msg) {
    return '<div class="upload-result success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg><span>' + UI.escapeHtml(msg) + '</span></div>';
  }

  // ============================================================
  // INIT
  // ============================================================

  function init() {
    wireNavigation();
    wireUploadZone('ledgerUploadZone', 'ledgerFileInput', 'ledgerUploadResult', 'ledger');
    wireUploadZone('inventoryUploadZone', 'inventoryFileInput', 'inventoryUploadResult', 'inventory');

    document.getElementById('refreshBtn').addEventListener('click', function () { loadFromBackend(true); });

    const startView = currentViewFromHash();

    if (!Api.isConfigured()) {
      UI.toast('Backend not configured — paste your Google Apps Script URL in js/config.js', 'info');
      updateSyncStatus(false, 'Not connected');
      navigateTo(startView, false);
    } else {
      navigateTo(startView, false);
      loadFromBackend(true);
    }
  }

  return { init: init };
})();

document.addEventListener('DOMContentLoaded', App.init);
