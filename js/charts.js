/**
 * PARTS ANALYSER BY NAVEEN — CHARTS
 * ------------------------------------------------------------
 * Thin wrapper around Chart.js. Each function destroys any previous
 * chart instance on the same canvas before drawing, so re-renders on
 * data refresh never leak or stack.
 * ------------------------------------------------------------
 */

const Charts = (() => {
  const instances = {};

  Chart.defaults.font.family = "'Poppins', sans-serif";
  Chart.defaults.color = '#5B6478';
  Chart.defaults.font.size = 12;

  function destroy(id) {
    if (instances[id]) {
      instances[id].destroy();
      delete instances[id];
    }
  }

  function fsnValueChart(canvasId, fsnTotals) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Fast', 'Slow', 'Non-moving'],
        datasets: [{
          data: [fsnTotals.Fast, fsnTotals.Slow, fsnTotals['Non-moving']],
          backgroundColor: ['#1DA567', '#E2A53D', '#9AA2B5'],
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.label}: ${formatINR(c.raw)}`,
            },
          },
        },
      },
    });
  }

  function abcValueChart(canvasId, abcTotals) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    instances[canvasId] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['A (top 70%)', 'B (next 20%)', 'C (remaining 10%)'],
        datasets: [{
          data: [abcTotals.A, abcTotals.B, abcTotals.C],
          backgroundColor: ['#E2483D', '#E2A53D', '#3D7BE2'],
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: {
            callbacks: {
              label: (c) => `${c.label}: ${formatINR(c.raw)}`,
            },
          },
        },
      },
    });
  }

  function salesTrendChart(canvasId, labels, values) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 280);
    gradient.addColorStop(0, 'rgba(242, 153, 74, 0.28)');
    gradient.addColorStop(1, 'rgba(242, 153, 74, 0.02)');

    instances[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Units sold',
          data: values,
          borderColor: '#F2994A',
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { maxTicksLimit: 8, font: { size: 11 } } },
          y: { grid: { color: '#EEF0F4' }, ticks: { font: { size: 11 } }, beginAtZero: true },
        },
      },
    });
  }

  function topPartsChart(canvasId, labels, values) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Consumption value',
          data: values,
          backgroundColor: '#3D7BE2',
          borderRadius: 6,
          maxBarThickness: 26,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => formatINR(c.raw) } },
        },
        scales: {
          x: { grid: { color: '#EEF0F4' }, ticks: { callback: (v) => formatINRShort(v), font: { size: 11 } } },
          y: { grid: { display: false }, ticks: { font: { size: 11 } } },
        },
      },
    });
  }

  function categoryValueChart(canvasId, categories, consumptionValues, stockValues) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: categories,
        datasets: [
          { label: 'Consumption value', data: consumptionValues, backgroundColor: '#F2994A', borderRadius: 6, maxBarThickness: 28 },
          { label: 'Stock value', data: stockValues, backgroundColor: '#3D7BE2', borderRadius: 6, maxBarThickness: 28 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16 } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${formatINR(c.raw)}` } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 0 } },
          y: { grid: { color: '#EEF0F4' }, ticks: { callback: (v) => formatINRShort(v), font: { size: 11 } } },
        },
      },
    });
  }

  function monthlyTrendChart(canvasId, labels, qtyValues, revenueValues) {
    destroy(canvasId);
    const ctx = document.getElementById(canvasId).getContext('2d');
    instances[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Units sold', data: qtyValues, backgroundColor: '#3D7BE2', borderRadius: 6, yAxisID: 'y', maxBarThickness: 32 },
          { type: 'line', label: 'Consumption value', data: revenueValues, borderColor: '#F2994A', backgroundColor: '#F2994A', yAxisID: 'y1', tension: 0.3, pointRadius: 3, borderWidth: 2 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, pointStyle: 'circle', padding: 16 } },
          tooltip: {
            callbacks: {
              label: (c) => c.dataset.yAxisID === 'y1' ? `Value: ${formatINR(c.raw)}` : `Units: ${UI_fmtNum(c.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 } } },
          y: { type: 'linear', position: 'left', grid: { color: '#EEF0F4' }, ticks: { font: { size: 11 } }, title: { display: true, text: 'Units sold', font: { size: 11 } } },
          y1: { type: 'linear', position: 'right', grid: { display: false }, ticks: { callback: (v) => formatINRShort(v), font: { size: 11 } }, title: { display: true, text: 'Value', font: { size: 11 } } },
        },
      },
    });
  }

  function UI_fmtNum(n) {
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }

  function formatINR(n) {
    return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
  }
  function formatINRShort(n) {
    n = Number(n);
    if (n >= 100000) return '₹' + (n / 100000).toFixed(1) + 'L';
    if (n >= 1000) return '₹' + (n / 1000).toFixed(0) + 'K';
    return '₹' + n;
  }

  return { fsnValueChart, abcValueChart, salesTrendChart, topPartsChart, categoryValueChart, monthlyTrendChart, formatINR, formatINRShort };
})();
