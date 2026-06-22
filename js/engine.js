/**
 * PARTS ANALYSER BY NAVEEN — ANALYTICS ENGINE
 * ------------------------------------------------------------
 * Pure functions, no DOM, no network. Takes ledger + inventory data
 * (already parsed into arrays of objects) and produces every derived
 * dataset the dashboard needs: FSN classification, ABC classification,
 * consumption stats, and the weekly order plan.
 *
 * Order Types in the ledger:
 *   Sales / outflow  -> "Service Order", "Parts Sale Order"
 *   Receipts / inflow -> "Purchase Order", "b2b", "Parts Inventory Addition"
 *   Mixed             -> "Stock Adjustment" (uses both qty in/out as given)
 * Rows with Invoice Status "Cancelled" are excluded from sales — they
 * never actually left the shelf.
 * ------------------------------------------------------------
 */

const SALE_ORDER_TYPES = ['Service Order', 'Parts Sale Order'];
const RECEIPT_ORDER_TYPES = ['Purchase Order', 'b2b', 'Parts Inventory Addition'];

const Engine = (() => {

  function parseDate(d) {
    if (d instanceof Date) return d;
    if (typeof d === 'number') {
      // Excel serial date fallback
      return new Date(Math.round((d - 25569) * 86400 * 1000));
    }
    const s = String(d).trim();
    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function daysBetween(a, b) {
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  /**
   * Normalise raw ledger rows (as fetched from the sheet / parsed from
   * upload) into a consistent shape with real Date objects and numeric
   * quantities, and a `direction` field: 'sale' | 'receipt' | 'adjustment'.
   */
  function normaliseLedger(rawRows) {
    const out = [];
    for (const r of rawRows) {
      const dateStr = r['Date'] ?? r['date'];
      if (!dateStr || String(dateStr).trim() === '' || String(dateStr).trim().toLowerCase() === 'total') continue;
      const date = parseDate(dateStr);
      if (!date) continue;
      const partNumber = String(r['Part Number'] ?? r['part number'] ?? '').trim();
      if (!partNumber) continue;
      const orderType = String(r['Order Type'] ?? r['order type'] ?? '').trim();
      const invoiceStatus = String(r['Invoice Status'] ?? r['invoice status'] ?? '').trim();
      const qtyIn = Number(r['Quantity In'] ?? r['Quantity  In - Invoice'] ?? r['quantity in'] ?? 0) || 0;
      const qtyOut = Number(r['Quantity Out'] ?? r['Quantity Out - Invoice'] ?? r['quantity out'] ?? 0) || 0;

      let direction = 'adjustment';
      if (SALE_ORDER_TYPES.includes(orderType)) direction = 'sale';
      else if (RECEIPT_ORDER_TYPES.includes(orderType)) direction = 'receipt';

      const isCancelled = invoiceStatus.toLowerCase() === 'cancelled';

      out.push({
        date,
        partNumber,
        orderType,
        orderNumber: r['Order Number'] ?? '',
        invoiceNumber: r['Invoice Number'] ?? '',
        invoiceStatus,
        qtyIn,
        qtyOut,
        direction,
        isCancelled,
        // Effective sale qty: only counts toward demand if it's a sale
        // order type and not cancelled.
        saleQty: (direction === 'sale' && !isCancelled) ? qtyOut : 0,
        receiptQty: (direction === 'receipt' && !isCancelled) ? qtyIn : 0,
      });
    }
    return out;
  }

  /**
   * Normalise raw inventory rows into a consistent shape with numeric fields.
   * IMPORTANT: DLC and MRP are kept as `null` when the source value is blank
   * or unparseable, distinct from a genuine price of 0. Treating "no price
   * recorded" the same as "price is zero" was silently erasing real stock
   * value from totals — this is now surfaced explicitly so the dashboard can
   * show "X parts have no price on file" rather than hiding the gap.
   */
  function toNumOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  function normaliseInventory(rawRows) {
    const out = [];
    for (const r of rawRows) {
      const partNumber = String(r['Part Number'] ?? r['Part #'] ?? '').trim();
      if (!partNumber) continue;
      const mrp = toNumOrNull(r['MRP']);
      const dlc = toNumOrNull(r['DLC']);
      out.push({
        partNumber,
        description: String(r['Part Description'] ?? '').trim(),
        stockOnHand: Number(r['Stock on Hand']) || 0,
        onHandReserved: Number(r['On Hand Reserved']) || 0,
        onHandDamaged: Number(r['On Hand Damaged']) || 0,
        mrp,
        dlc,
        hasPrice: dlc !== null && dlc > 0,
        moq: Number(r['MOQ']) || 0,
        actualStockOnHand: Number(r['Actual Stock on Hand']) || 0,
        category: String(r['Category'] ?? '').trim(),
        productType: String(r['Product Type'] ?? '').trim(),
        onHandGood: Number(r['On Hand Good']) || 0,
      });
    }
    return out;
  }

  /**
   * Build a per-part summary across the full ledger history: total sold,
   * total received, distinct days sold, last sale date, first/last activity.
   */
  function buildPartHistory(normalisedLedger) {
    const map = new Map();
    for (const row of normalisedLedger) {
      if (!map.has(row.partNumber)) {
        map.set(row.partNumber, {
          partNumber: row.partNumber,
          totalSold: 0,
          totalReceived: 0,
          saleDates: new Set(),
          saleEvents: [],
          firstActivity: row.date,
          lastActivity: row.date,
          lastSaleDate: null,
        });
      }
      const p = map.get(row.partNumber);
      p.totalSold += row.saleQty;
      p.totalReceived += row.receiptQty;
      if (row.saleQty > 0) {
        p.saleDates.add(startOfDay(row.date).getTime());
        p.saleEvents.push({ date: row.date, qty: row.saleQty });
        if (!p.lastSaleDate || row.date > p.lastSaleDate) p.lastSaleDate = row.date;
      }
      if (row.date < p.firstActivity) p.firstActivity = row.date;
      if (row.date > p.lastActivity) p.lastActivity = row.date;
    }
    return map;
  }

  /**
   * FSN Analysis (Fast / Slow / Non-moving) based on a recent window.
   * referenceDate: the "as of" date (e.g. today). Looks back FSN_WINDOW_DAYS days.
   */
  function fsnAnalysis(normalisedLedger, referenceDate, windowDays, fastMinDaysSold) {
    const windowStart = new Date(referenceDate.getTime() - windowDays * 86400000);
    const windowed = normalisedLedger.filter(r => r.date >= windowStart && r.date <= referenceDate);
    const map = new Map();

    for (const row of windowed) {
      if (!map.has(row.partNumber)) {
        map.set(row.partNumber, { partNumber: row.partNumber, qtySoldWindow: 0, daysSoldSet: new Set() });
      }
      const p = map.get(row.partNumber);
      if (row.saleQty > 0) {
        p.qtySoldWindow += row.saleQty;
        p.daysSoldSet.add(startOfDay(row.date).getTime());
      }
    }

    const result = new Map();
    for (const [partNumber, p] of map.entries()) {
      const daysSold = p.daysSoldSet.size;
      let cls = 'Non-moving';
      if (daysSold === 0) cls = 'Non-moving';
      else if (daysSold >= fastMinDaysSold) cls = 'Fast';
      else cls = 'Slow';
      result.set(partNumber, {
        partNumber,
        qtySoldWindow: p.qtySoldWindow,
        daysSoldInWindow: daysSold,
        fsnClass: cls,
      });
    }
    return result;
  }

  /**
   * ABC Analysis based on consumption value over the FULL ledger history
   * (qty sold x DLC unit cost), since that reflects true long-run importance
   * rather than a short recent window.
   */
  function abcAnalysis(partHistoryMap, inventoryMap, aCutoff, bCutoff) {
    const rows = [];
    for (const [partNumber, hist] of partHistoryMap.entries()) {
      const inv = inventoryMap.get(partNumber);
      const dlc = (inv && inv.dlc !== null) ? inv.dlc : 0;
      const consumptionValue = hist.totalSold * dlc;
      rows.push({ partNumber, consumptionValue });
    }
    rows.sort((a, b) => b.consumptionValue - a.consumptionValue);
    const totalValue = rows.reduce((s, r) => s + r.consumptionValue, 0);

    const result = new Map();
    let cumulative = 0;
    for (const r of rows) {
      cumulative += r.consumptionValue;
      const cumulativePct = totalValue > 0 ? cumulative / totalValue : 0;
      let cls = 'C';
      if (totalValue === 0 || r.consumptionValue === 0) {
        cls = 'C';
      } else if (cumulativePct <= aCutoff) {
        cls = 'A';
      } else if (cumulativePct <= bCutoff) {
        cls = 'B';
      } else {
        cls = 'C';
      }
      result.set(r.partNumber, {
        partNumber: r.partNumber,
        consumptionValue: r.consumptionValue,
        cumulativePct,
        abcClass: cls,
      });
    }
    return result;
  }

  /**
   * Average daily demand over a window, computed from total qty sold / window days.
   * Using the window total (not just days-with-sales) so intermittent demand is
   * smoothed correctly — a part that sells 10 units twice a quarter still has a
   * real average daily rate, it's just lumpy.
   */
  function averageDailyDemand(normalisedLedger, partNumber, referenceDate, windowDays) {
    const windowStart = new Date(referenceDate.getTime() - windowDays * 86400000);
    let total = 0;
    for (const row of normalisedLedger) {
      if (row.partNumber === partNumber && row.date >= windowStart && row.date <= referenceDate) {
        total += row.saleQty;
      }
    }
    return total / windowDays;
  }

  /**
   * Builds full per-part analytics: merges inventory + history + FSN + ABC
   * into one row per part that exists in the inventory (source of truth for
   * "is this a real, current part").
   */
  function buildPartAnalytics(normalisedLedger, normalisedInventory, referenceDate, config) {
    const partHistory = buildPartHistory(normalisedLedger);
    const inventoryMap = new Map(normalisedInventory.map(i => [i.partNumber, i]));
    const fsnMap = fsnAnalysis(normalisedLedger, referenceDate, config.FSN_WINDOW_DAYS, config.FSN_FAST_MIN_DAYS_SOLD);
    const abcMap = abcAnalysis(partHistory, inventoryMap, config.ABC_A_CUTOFF, config.ABC_B_CUTOFF);

    // Precompute average daily demand per part over the FSN window, in one pass.
    const windowStart = new Date(referenceDate.getTime() - config.FSN_WINDOW_DAYS * 86400000);
    const windowSoldByPart = new Map();
    for (const row of normalisedLedger) {
      if (row.date >= windowStart && row.date <= referenceDate && row.saleQty > 0) {
        windowSoldByPart.set(row.partNumber, (windowSoldByPart.get(row.partNumber) || 0) + row.saleQty);
      }
    }

    const rows = [];
    for (const inv of normalisedInventory) {
      const hist = partHistory.get(inv.partNumber);
      const fsn = fsnMap.get(inv.partNumber);
      const abc = abcMap.get(inv.partNumber);
      const windowSold = windowSoldByPart.get(inv.partNumber) || 0;
      const avgDailyDemand = windowSold / config.FSN_WINDOW_DAYS;

      const dlcForMath = inv.dlc !== null ? inv.dlc : 0;
      rows.push({
        partNumber: inv.partNumber,
        description: inv.description,
        category: inv.category,
        productType: inv.productType,
        stockOnHand: inv.stockOnHand,
        actualStockOnHand: inv.actualStockOnHand,
        onHandReserved: inv.onHandReserved,
        onHandDamaged: inv.onHandDamaged,
        onHandGood: inv.onHandGood,
        mrp: inv.mrp,
        dlc: inv.dlc,
        hasPrice: inv.hasPrice,
        moq: inv.moq,
        totalSoldAllTime: hist ? hist.totalSold : 0,
        totalReceivedAllTime: hist ? hist.totalReceived : 0,
        lastSaleDate: hist ? hist.lastSaleDate : null,
        qtySoldWindow: windowSold,
        daysSoldInWindow: fsn ? fsn.daysSoldInWindow : 0,
        avgDailyDemand,
        fsnClass: fsn ? fsn.fsnClass : 'Non-moving',
        abcClass: abc ? abc.abcClass : 'C',
        consumptionValue: abc ? abc.consumptionValue : 0,
        stockValue: inv.actualStockOnHand * dlcForMath,
      });
    }
    return rows;
  }

  /**
   * FAST PATH: builds the same per-part analytics shape as buildPartAnalytics,
   * but from the backend's pre-computed PartSummary rows instead of scanning
   * the full raw ledger. This is what makes page loads fast — the summary
   * table has one row per part (a few thousand) instead of one row per
   * transaction (tens of thousands), so there is nothing slow left to compute.
   *
   * summaryRows: array of objects with the SUMMARY_HEADERS shape from Code.gs
   *   (Part Number, Total Sold All Time, Total Received All Time, Last Sale
   *   Date, Qty Sold Last 90d, Days Sold Last 90d, Qty Sold Last 30d,
   *   Qty Sold Prior 30d, Monthly Sales JSON)
   */
  function buildPartAnalyticsFromSummary(summaryRows, normalisedInventory, config) {
    const summaryMap = new Map(summaryRows.map(s => [String(s['Part Number']).trim(), s]));

    // ABC needs total consumption value across all parts first, so build a
    // lightweight totalSold-per-part pass before classifying.
    const abcInputRows = [];
    for (const inv of normalisedInventory) {
      const s = summaryMap.get(inv.partNumber);
      const totalSold = s ? Number(s['Total Sold All Time']) || 0 : 0;
      const dlcForMath = inv.dlc !== null ? inv.dlc : 0;
      abcInputRows.push({ partNumber: inv.partNumber, consumptionValue: totalSold * dlcForMath });
    }
    abcInputRows.sort((a, b) => b.consumptionValue - a.consumptionValue);
    const totalValue = abcInputRows.reduce((s, r) => s + r.consumptionValue, 0);
    const abcMap = new Map();
    let cumulative = 0;
    for (const r of abcInputRows) {
      cumulative += r.consumptionValue;
      const cumulativePct = totalValue > 0 ? cumulative / totalValue : 0;
      let cls = 'C';
      if (totalValue > 0 && r.consumptionValue > 0) {
        if (cumulativePct <= config.ABC_A_CUTOFF) cls = 'A';
        else if (cumulativePct <= config.ABC_B_CUTOFF) cls = 'B';
      }
      abcMap.set(r.partNumber, { consumptionValue: r.consumptionValue, abcClass: cls });
    }

    const rows = [];
    for (const inv of normalisedInventory) {
      const s = summaryMap.get(inv.partNumber);
      const totalSoldAllTime = s ? Number(s['Total Sold All Time']) || 0 : 0;
      const totalReceivedAllTime = s ? Number(s['Total Received All Time']) || 0 : 0;
      const lastSaleDate = s && s['Last Sale Date'] ? new Date(s['Last Sale Date']) : null;
      const qtySoldWindow = s ? Number(s['Qty Sold Last 90d']) || 0 : 0;
      const daysSoldInWindow = s ? Number(s['Days Sold Last 90d']) || 0 : 0;
      const avgDailyDemand = qtySoldWindow / config.FSN_WINDOW_DAYS;

      let fsnClass = 'Non-moving';
      if (daysSoldInWindow >= config.FSN_FAST_MIN_DAYS_SOLD) fsnClass = 'Fast';
      else if (daysSoldInWindow > 0) fsnClass = 'Slow';

      const abc = abcMap.get(inv.partNumber) || { consumptionValue: 0, abcClass: 'C' };
      const dlcForMath = inv.dlc !== null ? inv.dlc : 0;

      rows.push({
        partNumber: inv.partNumber,
        description: inv.description,
        category: inv.category,
        productType: inv.productType,
        stockOnHand: inv.stockOnHand,
        actualStockOnHand: inv.actualStockOnHand,
        onHandReserved: inv.onHandReserved,
        onHandDamaged: inv.onHandDamaged,
        onHandGood: inv.onHandGood,
        mrp: inv.mrp,
        dlc: inv.dlc,
        hasPrice: inv.hasPrice,
        moq: inv.moq,
        totalSoldAllTime,
        totalReceivedAllTime,
        lastSaleDate,
        qtySoldWindow,
        daysSoldInWindow,
        avgDailyDemand,
        fsnClass,
        abcClass: abc.abcClass,
        consumptionValue: abc.consumptionValue,
        stockValue: inv.actualStockOnHand * dlcForMath,
        qtySoldLast30: s ? Number(s['Qty Sold Last 30d']) || 0 : 0,
        qtySoldPrior30: s ? Number(s['Qty Sold Prior 30d']) || 0 : 0,
        monthlySalesJson: s ? s['Monthly Sales JSON'] : null,
      });
    }
    return rows;
  }

  /**
   * WEEKLY ORDER PLAN
   * Rule set (per user's explicit instructions):
   *  - If stock on hand is 0 AND no sale of the part exists at all
   *    (totalSoldAllTime === 0) -> exclude entirely from ordering.
   *  - Target stock = avgDailyDemand * 7 * ORDER_COVER_WEEKS (2 weeks cover).
   *  - Suggested raw qty = max(0, target - actualStockOnHand).
   *  - Round up to nearest MOQ multiple if MOQ > 0.
   *  - Rank by priority: FSN (Fast > Slow > Non-moving), then ABC (A > B > C),
   *    then by consumption value descending — Fast/A parts get funded first.
   *  - Apply the monthly cap, split into 4 equal weekly budgets. If a week's
   *    budget is insufficient to fund every suggested line at full quantity,
   *    fund in priority order; a line that doesn't fully fit can be partially
   *    funded down to a whole MOQ-respecting quantity, or pushed to next week.
   */
  function buildOrderPlan(partAnalytics, config) {
    const weeklyBudget = config.MONTHLY_ORDER_CAP / 4;
    const candidates = [];
    const allowedCategories = config.ORDER_PLANNING_CATEGORIES && config.ORDER_PLANNING_CATEGORIES.length > 0
      ? new Set(config.ORDER_PLANNING_CATEGORIES) : null;
    const skippedNoPrice = [];

    for (const p of partAnalytics) {
      if (allowedCategories && !allowedCategories.has(p.category)) continue;
      if (p.actualStockOnHand <= 0 && p.totalSoldAllTime === 0) continue; // hard exclusion rule

      const targetStock = p.avgDailyDemand * 7 * config.ORDER_COVER_WEEKS;
      let rawQty = Math.max(0, targetStock - p.actualStockOnHand);

      if (rawQty <= 0) continue; // already sufficiently stocked, no order needed

      let suggestedQty = rawQty;
      if (p.moq && p.moq > 0) {
        suggestedQty = Math.ceil(rawQty / p.moq) * p.moq;
      } else {
        suggestedQty = Math.ceil(rawQty);
      }

      if (!p.hasPrice) {
        skippedNoPrice.push({ partNumber: p.partNumber, description: p.description, suggestedQty });
        continue;
      }

      const lineValue = suggestedQty * p.dlc;
      if (lineValue <= 0) continue;

      candidates.push({
        partNumber: p.partNumber,
        description: p.description,
        category: p.category,
        fsnClass: p.fsnClass,
        abcClass: p.abcClass,
        avgDailyDemand: p.avgDailyDemand,
        actualStockOnHand: p.actualStockOnHand,
        moq: p.moq,
        dlc: p.dlc,
        suggestedQty,
        lineValue,
      });
    }

    const fsnRank = { 'Fast': 0, 'Slow': 1, 'Non-moving': 2 };
    const abcRank = { 'A': 0, 'B': 1, 'C': 2 };
    candidates.sort((a, b) => {
      if (fsnRank[a.fsnClass] !== fsnRank[b.fsnClass]) return fsnRank[a.fsnClass] - fsnRank[b.fsnClass];
      if (abcRank[a.abcClass] !== abcRank[b.abcClass]) return abcRank[a.abcClass] - abcRank[b.abcClass];
      return b.lineValue - a.lineValue;
    });

    // Distribute across 4 weeks respecting weekly budget, in priority order.
    const weeks = [[], [], [], []];
    const weekSpend = [0, 0, 0, 0];

    for (const c of candidates) {
      let placed = false;
      for (let w = 0; w < 4; w++) {
        const remaining = weeklyBudget - weekSpend[w];
        if (remaining <= 0) continue;

        if (c.lineValue <= remaining) {
          weeks[w].push({ ...c, approvedQty: c.suggestedQty, fundedFully: true });
          weekSpend[w] += c.lineValue;
          placed = true;
          break;
        } else {
          // Try partial funding respecting MOQ multiples.
          const unitCost = c.dlc;
          if (unitCost <= 0) continue;
          let affordableQty = Math.floor(remaining / unitCost);
          if (c.moq && c.moq > 0) {
            affordableQty = Math.floor(affordableQty / c.moq) * c.moq;
          }
          if (affordableQty > 0) {
            const partialValue = affordableQty * unitCost;
            weeks[w].push({ ...c, approvedQty: affordableQty, fundedFully: false,
              remainderQty: c.suggestedQty - affordableQty, lineValue: partialValue });
            weekSpend[w] += partialValue;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        // Could not fit in any week this month — flag as deferred.
        weeks[3].push({ ...c, approvedQty: 0, fundedFully: false, deferred: true, lineValue: 0 });
      }
    }

    return {
      weeks: weeks.map((lines, idx) => ({
        weekNumber: idx + 1,
        budget: weeklyBudget,
        spend: weekSpend[idx],
        utilisationPct: weeklyBudget > 0 ? weekSpend[idx] / weeklyBudget : 0,
        lines,
      })),
      skippedNoPrice,
    };
  }

  /**
   * Category-wise rollup: for each category, total stock value, total
   * consumption value, part counts by FSN class, and unpriced part count.
   * Powers the Category Analytics view and several dashboard charts.
   */
  function buildCategoryRollup(partAnalytics) {
    const map = new Map();
    for (const p of partAnalytics) {
      const cat = p.category || 'Uncategorised';
      if (!map.has(cat)) {
        map.set(cat, {
          category: cat,
          partCount: 0,
          stockValue: 0,
          consumptionValue: 0,
          totalSoldAllTime: 0,
          fastCount: 0, slowCount: 0, nonMovingCount: 0,
          aCount: 0, bCount: 0, cCount: 0,
          zeroStockCount: 0,
          unpricedCount: 0,
        });
      }
      const c = map.get(cat);
      c.partCount++;
      c.stockValue += p.stockValue;
      c.consumptionValue += p.consumptionValue;
      c.totalSoldAllTime += p.totalSoldAllTime;
      if (p.fsnClass === 'Fast') c.fastCount++;
      else if (p.fsnClass === 'Slow') c.slowCount++;
      else c.nonMovingCount++;
      if (p.abcClass === 'A') c.aCount++;
      else if (p.abcClass === 'B') c.bCount++;
      else c.cCount++;
      if (p.actualStockOnHand <= 0) c.zeroStockCount++;
      if (!p.hasPrice) c.unpricedCount++;
    }
    return Array.from(map.values()).sort((a, b) => b.consumptionValue - a.consumptionValue);
  }

  /**
   * Monthly sales trend (qty + value) for the full ledger history, used by
   * the analytics view to show longer-term trend beyond the 90-day window.
   */
  function buildMonthlySalesTrend(normalisedLedger, inventoryMap) {
    const map = new Map(); // 'YYYY-MM' -> { qty, value }
    for (const row of normalisedLedger) {
      if (row.saleQty <= 0) continue;
      const key = row.date.getFullYear() + '-' + String(row.date.getMonth() + 1).padStart(2, '0');
      if (!map.has(key)) map.set(key, { month: key, qty: 0, value: 0 });
      const m = map.get(key);
      m.qty += row.saleQty;
      const inv = inventoryMap.get(row.partNumber);
      const dlc = (inv && inv.dlc !== null) ? inv.dlc : 0;
      m.value += row.saleQty * dlc;
    }
    return Array.from(map.values()).sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Top/bottom movers comparing two equal-length recent windows (e.g. last
   * 30 days vs the 30 days before that) to show what's trending up or down.
   */
  function buildTrendComparison(normalisedLedger, referenceDate, windowDays) {
    const recentStart = new Date(referenceDate.getTime() - windowDays * 86400000);
    const priorStart = new Date(referenceDate.getTime() - 2 * windowDays * 86400000);
    const recent = new Map();
    const prior = new Map();
    for (const row of normalisedLedger) {
      if (row.saleQty <= 0) continue;
      if (row.date > recentStart && row.date <= referenceDate) {
        recent.set(row.partNumber, (recent.get(row.partNumber) || 0) + row.saleQty);
      } else if (row.date > priorStart && row.date <= recentStart) {
        prior.set(row.partNumber, (prior.get(row.partNumber) || 0) + row.saleQty);
      }
    }
    const allParts = new Set([...recent.keys(), ...prior.keys()]);
    const result = [];
    for (const partNumber of allParts) {
      const recentQty = recent.get(partNumber) || 0;
      const priorQty = prior.get(partNumber) || 0;
      const delta = recentQty - priorQty;
      const pctChange = priorQty > 0 ? (delta / priorQty) : (recentQty > 0 ? Infinity : 0);
      result.push({ partNumber, recentQty, priorQty, delta, pctChange });
    }
    return result.sort((a, b) => b.delta - a.delta);
  }


  function nextFourMondays(referenceDate) {
    const result = [];
    const d = new Date(referenceDate);
    const dow = d.getDay(); // 0 = Sunday
    const daysUntilMonday = (8 - dow) % 7;
    let firstMonday = new Date(d.getTime() + (dow === 1 ? 0 : daysUntilMonday) * 86400000);
    for (let i = 0; i < 4; i++) {
      result.push(new Date(firstMonday.getTime() + i * 7 * 86400000));
    }
    return result;
  }

  return {
    parseDate,
    daysBetween,
    startOfDay,
    normaliseLedger,
    normaliseInventory,
    buildPartHistory,
    fsnAnalysis,
    abcAnalysis,
    averageDailyDemand,
    buildPartAnalytics,
    buildPartAnalyticsFromSummary,
    buildOrderPlan,
    buildCategoryRollup,
    buildMonthlySalesTrend,
    buildTrendComparison,
    nextFourMondays,
  };
})();
