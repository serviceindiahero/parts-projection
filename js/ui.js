/**
 * PARTS ANALYSER BY NAVEEN — UI HELPERS
 * ------------------------------------------------------------
 * DOM rendering helpers: tables (with sort/filter/paginate), KPI cards,
 * toasts, modals, the loading overlay, and small formatting utilities.
 * No business logic lives here — that's all in engine.js. This file
 * only turns data into DOM.
 * ------------------------------------------------------------
 */

const UI = (() => {

  function fmtNum(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function fmtNum1(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 1 });
  }
  function fmtINR(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  /**
   * For prices specifically (MRP/DLC) — null/undefined means "no price on
   * file" (genuinely missing from the source data), which is different
   * from a price of zero. Showing both the same way as plain ₹0 hides a
   * real data gap, so this renders missing prices as a visible badge
   * instead of a number.
   */
  function fmtPrice(n) {
    if (n === null || n === undefined || isNaN(n)) {
      return '<span class="text-sm" style="color:var(--text-3);font-style:italic;">no price</span>';
    }
    return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function fmtDate(d) {
    if (!d) return '—';
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return '—';
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fsnPill(cls) {
    const map = { 'Fast': 'pill-fast', 'Slow': 'pill-slow', 'Non-moving': 'pill-non' };
    return `<span class="pill ${map[cls] || 'pill-non'}">${escapeHtml(cls)}</span>`;
  }
  function abcPill(cls) {
    const map = { 'A': 'pill-a', 'B': 'pill-b', 'C': 'pill-c' };
    return `<span class="pill ${map[cls] || 'pill-c'}">${escapeHtml(cls)}</span>`;
  }
  function statusPill(status) {
    const map = { 'Pending': 'pill-status-pending', 'Approved': 'pill-status-approved', 'Ordered': 'pill-status-ordered' };
    return `<span class="pill ${map[status] || 'pill-status-pending'}">${escapeHtml(status || 'Pending')}</span>`;
  }

  /**
   * Generic sortable/paginated table renderer.
   * columns: [{ key, label, align: 'left'|'num', render?: (row)=>html, sortValue?: (row)=>number|string }]
   */
  function renderTable(tableEl, columns, rows, opts = {}) {
    const state = tableEl._tableState || { sortKey: opts.defaultSortKey || null, sortDir: opts.defaultSortDir || 'desc', page: 0 };
    tableEl._tableState = state;
    const pageSize = opts.pageSize || 25;

    let sortedRows = rows.slice();
    if (state.sortKey) {
      const col = columns.find(c => c.key === state.sortKey);
      if (col) {
        sortedRows.sort((a, b) => {
          const av = col.sortValue ? col.sortValue(a) : a[col.key];
          const bv = col.sortValue ? col.sortValue(b) : b[col.key];
          let cmp;
          if (typeof av === 'string') cmp = av.localeCompare(bv);
          else cmp = (av ?? -Infinity) - (bv ?? -Infinity);
          return state.sortDir === 'asc' ? cmp : -cmp;
        });
      }
    }

    const totalRows = sortedRows.length;
    const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
    if (state.page >= totalPages) state.page = totalPages - 1;
    if (state.page < 0) state.page = 0;
    const pageRows = opts.paginate === false ? sortedRows : sortedRows.slice(state.page * pageSize, (state.page + 1) * pageSize);

    const thead = `<thead><tr>${columns.map(c => {
      const sortClass = state.sortKey === c.key ? (state.sortDir === 'asc' ? 'sorted-asc' : 'sorted') : '';
      const alignClass = c.align === 'num' ? 'num' : '';
      return `<th class="${alignClass} ${sortClass}" data-key="${c.key}">${escapeHtml(c.label)}</th>`;
    }).join('')}</tr></thead>`;

    const tbody = pageRows.length === 0
      ? `<tbody><tr><td colspan="${columns.length}" style="text-align:center;color:var(--text-3);padding:32px;">No matching rows</td></tr></tbody>`
      : `<tbody>${pageRows.map(row => `<tr>${columns.map(c => {
          const alignClass = c.align === 'num' ? 'num' : '';
          const wrapClass = c.wrap ? 'wrap' : '';
          const html = c.render ? c.render(row) : escapeHtml(row[c.key]);
          return `<td class="${alignClass} ${wrapClass}">${html}</td>`;
        }).join('')}</tr>`).join('')}</tbody>`;

    tableEl.innerHTML = thead + tbody;

    tableEl.querySelectorAll('th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.key;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sortKey = key;
          state.sortDir = 'desc';
        }
        renderTable(tableEl, columns, rows, opts);
      });
    });

    if (opts.onPageInfo) {
      opts.onPageInfo({ page: state.page, totalPages, totalRows, pageSize });
    }

    return { state, totalPages, totalRows };
  }

  function setTablePage(tableEl, delta, columns, rows, opts) {
    const state = tableEl._tableState || { page: 0 };
    state.page = (state.page || 0) + delta;
    tableEl._tableState = state;
    return renderTable(tableEl, columns, rows, opts);
  }

  function kpiCard({ icon, iconClass, label, value, deltaText, deltaClass }) {
    return `
      <div class="stat-card">
        <div class="stat-card-top">
          <div class="stat-label">${escapeHtml(label)}</div>
          <div class="stat-icon ${iconClass}">${icon}</div>
        </div>
        <div class="stat-value">${value}</div>
        ${deltaText ? `<div class="stat-delta ${deltaClass || 'flat'}">${escapeHtml(deltaText)}</div>` : ''}
      </div>`;
  }

  function emptyState(container, { icon, title, sub, actionLabel, actionView }) {
    container.innerHTML = `
      <div class="empty-state">
        ${icon}
        <div class="empty-state-title">${escapeHtml(title)}</div>
        <div class="empty-state-sub">${escapeHtml(sub)}</div>
        ${actionLabel ? `<button class="btn btn-primary mt-16" data-view="${actionView}">${escapeHtml(actionLabel)}</button>` : ''}
      </div>`;
  }

  function toast(message, type = 'info') {
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    const icons = {
      success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>',
      error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>',
      info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
    };
    el.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
    stack.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity 0.3s'; setTimeout(() => el.remove(), 300); }, 4200);
  }

  function showLoading(text) {
    const overlay = document.getElementById('loadingOverlay');
    document.getElementById('loadingOverlayText').textContent = text || 'Loading…';
    overlay.classList.remove('hidden');
  }
  function hideLoading() {
    document.getElementById('loadingOverlay').classList.add('hidden');
  }

  function showModal({ title, body, confirmLabel, cancelLabel, onConfirm, danger }) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">${escapeHtml(title)}</div>
        <div class="modal-body">${escapeHtml(body)}</div>
        <div class="modal-actions">
          <button class="btn btn-secondary" id="modalCancelBtn">${escapeHtml(cancelLabel || 'Cancel')}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" id="modalConfirmBtn">${escapeHtml(confirmLabel || 'Confirm')}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#modalCancelBtn').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modalConfirmBtn').addEventListener('click', () => { overlay.remove(); onConfirm && onConfirm(); });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  function populateSelect(selectEl, values, placeholder) {
    const current = selectEl.value;
    selectEl.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
      values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (values.includes(current)) selectEl.value = current;
  }

  /**
   * Exports an array of plain objects to a downloadable .xlsx file using
   * the vendored SheetJS library. `columns` (optional) controls column
   * order and headers: [{ key, label }]. If omitted, uses the keys of the
   * first row in insertion order.
   */
  function exportToExcel(rows, filename, sheetName, columns) {
    if (!rows || rows.length === 0) {
      toast('Nothing to export', 'info');
      return;
    }
    let data;
    if (columns && columns.length > 0) {
      data = rows.map(row => {
        const obj = {};
        for (const c of columns) obj[c.label] = row[c.key];
        return obj;
      });
    } else {
      data = rows;
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (sheetName || 'Sheet1').slice(0, 31));
    XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
  }

  return {
    fmtNum, fmtNum1, fmtINR, fmtPrice, fmtDate, escapeHtml,
    fsnPill, abcPill, statusPill,
    renderTable, setTablePage,
    kpiCard, emptyState, toast, showLoading, hideLoading, showModal, populateSelect,
    exportToExcel,
  };
})();
