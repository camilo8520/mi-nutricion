/* Lee el Excel de Camilo y lo convierte en los datos de la app.
   Funciona en el navegador (global XLSX) y en Node. Solo lee valores fijos,
   nunca fórmulas: Base de datos (por 100 g) + tabla "TUS OBJETIVOS DIARIOS" de Mi día. */
(function (root) {
  const norm = s => String(s == null ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\bvit\.?\s/g, 'vitamina ').replace(/\s+/g, ' ').trim();

  const num = v => {
    if (typeof v === 'number') return v;
    const n = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    return isNaN(n) ? null : n;
  };

  const FRAC = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

  function parseQty(s) {
    s = s.trim();
    let m = s.match(/^(\d+)?\s*([½¼¾⅓⅔])\s*(.*)$/);
    if (m) return { n: (m[1] ? +m[1] : 0) + FRAC[m[2]], rest: m[3] };
    m = s.match(/^(\d+(?:[.,]\d+)?)\s*(.*)$/);
    if (m) return { n: parseFloat(m[1].replace(',', '.')), rest: m[2] };
    return { n: 1, rest: s };
  }

  // "(3 cdas = 33 g = 13 g proteína)", "(naranja ≈ 130 g · mandarina ≈ 85 g)" → porciones
  function parseName(full) {
    const groups = [...full.matchAll(/\(([^()]*)\)/g)].map(m => m[1]);
    const portions = [];
    for (const g of groups) {
      for (const seg of g.split('·')) {
        const m = seg.match(/^\s*(.*?)\s*[≈=]\s*(\d+(?:[.,]\d+)?)\s*g\b/);
        if (!m || !m[1]) continue;
        const grams = parseFloat(m[2].replace(',', '.'));
        const q = parseQty(m[1]);
        let unit = q.rest.replace(/^de\s+/, '').trim() || 'unidad';
        const singular = unit.replace(/^cdas$/, 'cda').replace(/^tazas$/, 'taza').replace(/^puñados$/, 'puñado');
        if (grams > 0 && q.n > 0) portions.push({ unit: singular, perUnit: grams / q.n, qty: q.n });
      }
    }
    const name = full.replace(/\s*\([^()]*(?:\([^()]*\)[^()]*)*\)\s*/g, ' ').replace(/\s+/g, ' ').trim()
      .replace(/:\s*gramos que echas a la cafetera$/i, '').trim();
    return { name: name || full, portions };
  }

  function parseWorkbook(XLSX, wb) {
    const wsB = wb.Sheets['Base de datos'];
    if (!wsB) throw new Error('No encuentro la hoja «Base de datos».');
    const rowsB = XLSX.utils.sheet_to_json(wsB, { header: 1, defval: null });
    const hi = rowsB.findIndex(r => r && norm(r[0]).startsWith('alimento'));
    if (hi < 0) throw new Error('No encuentro la fila de títulos («Alimento…») en la Base de datos.');
    const head = rowsB[hi];
    const nutrients = [];
    let srcCol = -1, emoCol = -1;
    for (let c = 1; c < head.length; c++) {
      if (head[c] == null || head[c] === '') continue;
      if (norm(head[c]) === 'fuente') { srcCol = c; continue; }
      if (norm(head[c]) === 'emoji') { emoCol = c; continue; }
      const label = String(head[c]).trim();
      const m = label.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      nutrients.push({ col: c, key: norm(label), label, short: (m ? m[1] : label).trim(), unit: m ? m[2] : '' });
    }
    const foods = [];
    for (let r = hi + 1; r < rowsB.length; r++) {
      const row = rowsB[r];
      if (!row || !row[0] || String(row[0]).trim() === '') continue;
      const full = String(row[0]).trim();
      const p = parseName(full);
      const per100 = {};
      nutrients.forEach(n => { per100[n.key] = num(row[n.col]) || 0; });
      foods.push({ id: full, name: p.name, emoji: emoCol >= 0 && row[emoCol] ? String(row[emoCol]).trim() : '', portions: p.portions, per100, source: srcCol >= 0 && row[srcCol] ? String(row[srcCol]) : '' });
    }

    // Categorías y orden: hoja «Mi día» (filas «▸ …»)
    const wsD = wb.Sheets['Mi día'];
    const cat = {};
    const order = [];
    let goalsRows = [];
    if (wsD) {
      const rowsD = XLSX.utils.sheet_to_json(wsD, { header: 1, defval: null });
      let current = 'Otros';
      rowsD.forEach(r => {
        const a = r && r[0] != null ? String(r[0]).trim() : '';
        if (a.startsWith('▸')) { current = a.replace(/^▸\s*/, '').trim(); return; }
        if (a) { cat[a] = current; order.push(a); }
      });
      const gi = rowsD.findIndex(r => r && norm(r[0]) === 'nutriente');
      if (gi >= 0) goalsRows = rowsD.slice(gi + 1);
    }
    const catCase = s => s.charAt(0) + s.slice(1).toLowerCase();
    foods.forEach(f => { f.cat = catCase(cat[f.id] || 'Otros'); f.ord = order.indexOf(f.id) < 0 ? 999 : order.indexOf(f.id); });
    foods.sort((a, b) => a.ord - b.ord);

    // Objetivos
    const byKey = Object.fromEntries(nutrients.map(n => [n.key, n]));
    const goals = [];
    let group = 'Objetivos';
    for (const r of goalsRows) {
      if (!r) continue;
      const a = r[0] != null ? String(r[0]).trim() : '';
      if (!a) { if (goals.length) break; else continue; }
      if (r[2] == null && r[3] == null) {
        if (/^no se miden/i.test(a)) break;
        group = a; continue;
      }
      const n = byKey[norm(a)];
      if (!n) continue;
      goals.push({ key: n.key, label: n.label, short: n.short, unit: n.unit, group,
        min: num(r[2]), max: num(r[3]), why: r[6] ? String(r[6]) : '' });
    }
    return { version: 1, nutrients: nutrients.map(({ col, ...n }) => n), foods, goals, importedAt: new Date().toISOString() };
  }

  const api = { parseWorkbook, parseName, norm };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.NutriExcel = api;
})(typeof self !== 'undefined' ? self : this);
