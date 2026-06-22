/**
 * PARTS ANALYSER BY NAVEEN — FILE PARSER
 * ------------------------------------------------------------
 * Parses uploaded files (xlsx, csv, tsv, tab-delimited txt) into
 * arrays of plain objects keyed by header name. Auto-detects the
 * delimiter for text files (tab vs comma) and strips quote wrapping.
 * Uses SheetJS (xlsx) for spreadsheet files, loaded from CDN in
 * index.html.
 * ------------------------------------------------------------
 */

const FileParser = (() => {

  function detectDelimiter(sampleLine) {
    const tabCount = (sampleLine.match(/\t/g) || []).length;
    const commaCount = (sampleLine.match(/,/g) || []).length;
    return tabCount >= commaCount ? '\t' : ',';
  }

  function parseDelimitedText(text) {
    // Normalise line endings, drop BOM.
    text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) return [];
    const delimiter = detectDelimiter(lines[0]);

    function splitLine(line) {
      // Simple CSV/TSV splitter that respects double-quoted fields.
      const fields = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = false;
          } else {
            cur += ch;
          }
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === delimiter) { fields.push(cur); cur = ''; }
          else cur += ch;
        }
      }
      fields.push(cur);
      return fields.map(f => f.trim());
    }

    const headers = splitLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = splitLine(lines[i]);
      if (fields.every(f => f === '')) continue;
      const obj = {};
      for (let j = 0; j < headers.length; j++) {
        obj[headers[j]] = fields[j] !== undefined ? fields[j] : '';
      }
      rows.push(obj);
    }
    return rows;
  }

  function parseXlsx(arrayBuffer) {
    const wb = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    return json;
  }

  /**
   * Reads a File object and returns a Promise<Array<Object>>.
   * Auto-detects xlsx vs delimited text by file extension and/or content sniff.
   */
  function parseFile(file) {
    return new Promise((resolve, reject) => {
      const name = file.name.toLowerCase();
      const isXlsx = name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.xlsm');
      const reader = new FileReader();

      reader.onerror = () => reject(new Error('Could not read file: ' + file.name));

      if (isXlsx) {
        reader.onload = (e) => {
          try {
            const rows = parseXlsx(e.target.result);
            resolve(rows);
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsArrayBuffer(file);
      } else {
        reader.onload = (e) => {
          try {
            let text = e.target.result;
            // If the file is UTF-16 encoded (common DMS export), FileReader with
            // default UTF-8 decoding will mangle it. Detect by checking for the
            // presence of null bytes / replacement chars and re-read as UTF-16.
            if (text.indexOf('\u0000') !== -1 || /\uFFFD{3,}/.test(text)) {
              const reader2 = new FileReader();
              reader2.onload = (e2) => {
                try {
                  resolve(parseDelimitedText(e2.target.result));
                } catch (err) {
                  reject(err);
                }
              };
              reader2.onerror = () => reject(new Error('Could not re-read file as UTF-16'));
              reader2.readAsText(file, 'UTF-16LE');
              return;
            }
            resolve(parseDelimitedText(text));
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsText(file, 'UTF-8');
      }
    });
  }

  /**
   * Maps raw uploaded ledger rows (arbitrary header names from the DMS
   * export) onto the canonical shape the Engine expects.
   */
  function mapLedgerRow(raw) {
    const get = (...keys) => {
      for (const k of keys) {
        if (raw[k] !== undefined && raw[k] !== '') return raw[k];
      }
      return '';
    };
    return {
      'Date': get('Date', 'date'),
      'Part Number': get('Part Number', 'part number', 'Part No', 'Part #'),
      'Order Type': get('Order Type', 'order type'),
      'Order Number': get('Order Number', 'order number'),
      'Invoice Number': get('Invoice Number', 'invoice number'),
      'Invoice Status': get('Invoice Status', 'invoice status'),
      'Quantity In': Number(get('Quantity In', 'Quantity  In - Invoice', 'Quantity In - Invoice', 'quantity in')) || 0,
      'Quantity Out': Number(get('Quantity Out', 'Quantity Out - Invoice', 'quantity out')) || 0,
    };
  }

  /**
   * Maps raw uploaded inventory rows onto the canonical shape.
   */
  function mapInventoryRow(raw) {
    const get = (...keys) => {
      for (const k of keys) {
        if (raw[k] !== undefined && raw[k] !== '') return raw[k];
      }
      return '';
    };
    const clean = (v) => String(v).replace(/^"|"$/g, '').trim();
    return {
      'Part Number': clean(get('Part Number', 'Part #', 'part number')),
      'Part Description': clean(get('Part Description', 'part description')),
      'Stock on Hand': Number(clean(get('Stock on Hand'))) || 0,
      'On Hand Reserved': Number(clean(get('On Hand Reserved'))) || 0,
      'On Hand Damaged': Number(clean(get('On Hand Damaged'))) || 0,
      'MRP': Number(clean(get('MRP'))) || 0,
      'DLC': Number(clean(get('DLC'))) || 0,
      'MOQ': Number(clean(get('MOQ'))) || 0,
      'Actual Stock on Hand': Number(clean(get('Actual Stock on Hand'))) || 0,
      'Category': clean(get('Category')),
      'Product Type': clean(get('Product Type')),
      'On Hand Good': Number(clean(get('On Hand Good'))) || 0,
    };
  }

  function isLikelyLedgerFile(rows) {
    if (!rows || rows.length === 0) return false;
    const keys = Object.keys(rows[0]).map(k => k.toLowerCase());
    return keys.some(k => k.includes('order type')) && keys.some(k => k.includes('part number'));
  }

  function isLikelyInventoryFile(rows) {
    if (!rows || rows.length === 0) return false;
    const keys = Object.keys(rows[0]).map(k => k.toLowerCase());
    return keys.some(k => k.includes('stock on hand')) || keys.some(k => k.includes('part #'));
  }

  return {
    parseFile,
    parseDelimitedText,
    mapLedgerRow,
    mapInventoryRow,
    isLikelyLedgerFile,
    isLikelyInventoryFile,
  };
})();
