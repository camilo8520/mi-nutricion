(function () {
'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
};
const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>'
};

/* ---------- estado ---------- */
let DATA = store.get('nutri.data', null) || window.DATOS_INICIALES;
let LOG = store.get('nutri.log', {});
let ARCH = store.get('nutri.archive', {});
let SET = store.get('nutri.set', { theme: 'auto', shown: '' });
let tab = 'hoy';
let date = dkey(new Date());
let openGoal = null;
let sheet = null;       // {mode:'list'|'detail', ...}
let lastUndo = null;

function dkey(d) { const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
function fromKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
const today = () => dkey(new Date());
const saveLog = () => store.set('nutri.log', LOG);
const saveSet = () => store.set('nutri.set', SET);
const rnd = (v, d = 0) => { const f = Math.pow(10, d); return Math.round(v * f) / f; };
const fnum = (v, d = 0) => rnd(v, d).toLocaleString('es-CO', { maximumFractionDigits: d });

function indexFoods() {
  DATA.foods.forEach(f => { ARCH[f.id] = { id: f.id, name: f.name, portions: f.portions, per100: f.per100, cat: f.cat }; });
  store.set('nutri.archive', ARCH);
}
indexFoods();
const food = id => DATA.foods.find(f => f.id === id) || ARCH[id] || null;
const goalMap = () => Object.fromEntries(DATA.goals.map(g => [g.key, g]));

/* ---------- cálculos ---------- */
const entriesOf = k => LOG[k] || [];
function totals(entries) {
  const t = {};
  DATA.nutrients.forEach(n => { t[n.key] = 0; });
  entries.forEach(e => {
    const f = food(e.food); if (!f) return;
    DATA.nutrients.forEach(n => { t[n.key] += (f.per100[n.key] || 0) * e.g / 100; });
  });
  return t;
}
function statusOf(g, v) {
  if (g.max != null && v > g.max) return 'over';
  if (g.min != null && v < g.min) return 'low';
  return 'ok';
}
const met = (t) => DATA.goals.filter(g => statusOf(g, t[g.key] || 0) === 'ok').length;
const PROT = () => DATA.goals.find(g => g.key.startsWith('proteina'));
const KCAL = () => DATA.goals.find(g => g.key.startsWith('calorias'));


/* ---------- emojis (columna «Emoji» del Excel si existe; si no, por palabra clave) ---------- */
const EMO_KEYS = [['toning','🥛'],['bebida de soya','🥛'],['carve','🌱'],['texturizada','🌱'],['harina de soya','🫘'],['seitan','🥩'],['tofu','🧊'],['verduras verdes','🥬'],['espinaca','🥬'],['verduras acuosas','🍅'],['tomate','🍅'],['zanahoria','🥕'],['ahuyama','🎃'],['banano','🍌'],['manzana','🍎'],['naranja','🍊'],['mango','🥭'],['papaya','🍈'],['fresa','🍓'],['avena','🥣'],['arroz','🍚'],['pasta','🍝'],['quinua','🌾'],['arepa','🫓'],['pan ','🍞'],['lenteja','🫘'],['frijol','🫘'],['garbanzo','🫘'],['arveja','🫛'],['mani','🥜'],['nuez','🌰'],['calabaza','🌱'],['chia','🌱'],['linaza','🌾'],['papa','🥔'],['aguacate','🥑'],['aceite','🫒'],['cafe','☕']];
const EMO_CAT = { 'proteina': '💪', 'verduras y frutas': '🥗', 'cereales': '🌾', 'legumbres': '🫘', 'nueces y semillas': '🥜', 'otros': '🍽️' };
function emo(f) {
  if (!f) return '🍽️';
  if (f.emoji) return f.emoji;
  const n = NutriExcel.norm(f.name || f.id) + ' ';
  for (const [k, v] of EMO_KEYS) if (n.includes(k)) return v;
  return EMO_CAT[NutriExcel.norm(f.cat || 'otros')] || '🍽️';
}
const label = f => emo(f) + ' ' + f.name.split(':')[0];

/* ---------- porciones ---------- */
function plural(unit, q) {
  if (q <= 1) return unit;
  const [w, ...rest] = unit.split(' ');
  let p = w;
  if (/[aeiouáéíóú]$/i.test(w)) p = w + 's'; else if (/z$/i.test(w)) p = w.slice(0, -1) + 'ces'; else if (/s$/i.test(w)) p = w; else p = w + 'es';
  return [p, ...rest].join(' ');
}
const fq = q => { const w = Math.floor(q + 1e-9), f = q - w; const fr = Math.abs(f - .5) < .01 ? '½' : Math.abs(f - .25) < .01 ? '¼' : Math.abs(f - .75) < .01 ? '¾' : ''; if (fr) return (w ? w : '') + fr; return String(rnd(q, 2)).replace('.', ','); };
function describe(f, g) {
  const p = f.portions && f.portions[0];
  if (p) {
    const q = g / p.perUnit;
    if (q > 0 && Math.abs(q * 4 - Math.round(q * 4)) < .02) return fq(q) + ' ' + plural(p.unit, q) + ' · ' + fnum(g) + ' g';
  }
  return fnum(g) + ' g';
}
function usualG(f) {
  const days = Object.keys(LOG).sort().reverse();
  for (const k of days) { const e = [...LOG[k]].reverse().find(x => x.food === f.id); if (e) return e.g; }
  const p = f.portions && f.portions[0];
  return p ? rnd(p.perUnit * p.qty, 1) : 100;
}
function freq(id) { let c = 0; const ks = Object.keys(LOG).sort().reverse().slice(0, 14); ks.forEach(k => LOG[k].forEach(e => { if (e.food === id) c++; })); return c; }

/* ---------- registro ---------- */
function addEntry(id, g, k = date, silent) {
  const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), t: Date.now(), food: id, g: rnd(g, 1) };
  if (k !== today()) { const d = fromKey(k); d.setHours(12, 0, 0, 0); e.t = d.getTime(); }
  (LOG[k] = LOG[k] || []).push(e); saveLog();
  if (!silent) { const f = food(id); toast('Añadido: ' + (f ? f.name.split(':')[0] : ''), () => { removeEntry(e.id, k); }); }
  return e;
}
function removeEntry(eid, k = date) { LOG[k] = (LOG[k] || []).filter(e => e.id !== eid); if (!LOG[k].length) delete LOG[k]; saveLog(); render(); }

let toastT;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = '<span>' + esc(msg) + '</span>' + (undo ? '<button>Deshacer</button>' : '');
  t.hidden = false;
  if (undo) t.querySelector('button').onclick = () => { undo(); t.hidden = true; };
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 4000);
  render();
}

/* ---------- sugerencias ---------- */
function suggest(entries) {
  const t = totals(entries);
  const goals = DATA.goals;
  const cur = Object.assign({}, t);
  const picks = [];
  const used = new Set(entries.map(e => e.food));
  const need = goals.filter(g => g.min != null);
  const isProt = g => g.key.startsWith('proteina');
  const isCal = g => g.key.startsWith('calorias');
  const deficit = () => need.filter(g => (cur[g.key] || 0) < g.min);
  for (let round = 0; round < 5; round++) {
    const defs = deficit();
    if (!defs.length) break;
    let best = null;
    for (const f of DATA.foods) {
      if (/^caf[eé]/i.test(f.name) || picks.some(p => p.f.id === f.id)) continue;
      const p0 = f.portions && f.portions[0];
      const baseG = p0 ? p0.perUnit * p0.qty : 100;
      for (const m of [0.5, 1, 1.5, 2]) {
        const g = rnd(baseG * m, 0);
        if (g < 5) continue;
        const add = {}; DATA.nutrients.forEach(n => { add[n.key] = (f.per100[n.key] || 0) * g / 100; });
        if (goals.some(gl => gl.max != null && (cur[gl.key] || 0) + add[gl.key] > gl.max)) continue;
        let s = 0;
        defs.forEach(gl => {
          const d = gl.min - (cur[gl.key] || 0);
          const w = isProt(gl) ? 3 : isCal(gl) ? 0.7 : 1;
          s += w * Math.min(add[gl.key], d) / gl.min;
        });
        defs.forEach(gl => { if (isProt(gl) || isCal(gl)) { const over = add[gl.key] - (gl.min - (cur[gl.key] || 0)); if (over > 0) s -= 0.6 * over / gl.min; } });
        const prot = PROT(); if (prot && (cur[prot.key] || 0) >= prot.min) s *= 0.6;
        s *= (used.has(f.id) ? 0.92 : 1) * (1 + Math.min(freq(f.id), 6) * 0.03);
        s -= 0.0004 * Math.max(0, g - baseG * 2);
        if (!best || s > best.s) best = { f, g, s, add };
      }
    }
    if (!best || best.s < 0.03) break;
    picks.push(best);
    DATA.nutrients.forEach(n => { cur[n.key] = (cur[n.key] || 0) + best.add[n.key]; });
  }
  const left = need.filter(g => (cur[g.key] || 0) < g.min);
  return { before: t, after: cur, picks, left };
}

function suggestCard(entries, k) {
  const r = suggest(entries);
  const now = new Date();
  const g0 = DATA.goals.filter(g => g.min != null && (r.before[g.key] || 0) < g.min);
  const hdr = (k === today() && now.getHours() >= 16) ? 'Son las ' + (now.getHours() > 12 ? now.getHours() - 12 : now.getHours()) + ':' + String(now.getMinutes()).padStart(2, '0') + ' PM. Esto te falta' : 'Lo que te falta';
  if (!g0.length) return '<section class="card sug"><h3>' + (k === today() ? '¡Hoy cumpliste todos los mínimos!' : 'Ese día cumpliste todos los mínimos') + '</h3><p class="lead" style="margin:0">Nada más que agregar.</p></section>';
  const P = PROT(), C = KCAL();
  const parts = [];
  if (P && (r.before[P.key] || 0) < P.min) parts.push(fnum(P.min - r.before[P.key]) + ' g de proteína');
  if (C && (r.before[C.key] || 0) < C.min) parts.push(fnum(C.min - r.before[C.key]) + ' kcal');
  const others = g0.filter(g => g !== P && g !== C).map(g => g.short.toLowerCase());
  let lead = parts.length ? 'Te faltan ' + parts.join(' y ') + '.' : 'Ya cubriste proteína y calorías.';
  if (others.length) lead += ' También faltan: ' + others.join(', ') + '.';
  const items = r.picks.map((p, i) => {
    const bits = g0.map(g => ({ g, v: p.add[g.key] })).filter(x => x.v / x.g.min > .06).sort((a, b) => b.v / b.g.min - a.v / a.g.min).slice(0, 3)
      .map(x => '+' + fnum(x.v, x.v < 10 ? 1 : 0) + ' ' + x.g.unit.replace(/^kcal$/, 'kcal') + ' ' + x.g.short.toLowerCase().replace('proteína', 'prot.').replace('calorías', ''));
    return '<div class="item"><div class="t"><b>' + esc(label(p.f)) + '</b><span>' + esc(describe(p.f, p.g)) + (bits.length ? ' · ' + esc(bits.join(' · ').replace(/\s+/g, ' ')) : '') + '</span></div><button class="addbtn" data-act="sug-add" data-i="' + i + '" aria-label="Añadir ' + esc(p.f.name) + '">' + ICON.plus + '</button></div>';
  }).join('');
  suggestCard.last = r;
  const after = r.left.length ? 'Con esto quedaría pendiente: ' + r.left.map(g => g.short.toLowerCase()).join(', ') + '.' : 'Con esto cumples todos los mínimos del día.';
  return '<section class="card sug"><h3>' + esc(hdr) + '</h3><p class="lead">' + esc(lead) + '</p>' + (items ? '<div>' + items + '</div><p class="after">' + esc(after) + '</p>' : '<p class="after">No encuentro una combinación sencilla con tus alimentos para cubrir lo que falta.</p>') + '</section>';
}

/* ---------- vistas ---------- */
const DAYN = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'], MON = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
function dlabel(k) { const d = fromKey(k); return DAYN[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; }

function renderTop() {
  const el = $('#top');
  if (tab === 'hoy') {
    const isT = date === today();
    el.innerHTML = '<h1>Mi Nutrición</h1><div class="datenav"><button data-act="prev" aria-label="Día anterior">' + ICON.left + '</button><div class="d">' + (isT ? 'Hoy' : esc(dlabel(date))) + '<small>' + (isT ? esc(dlabel(date)) : '') + '</small></div><button data-act="next" aria-label="Día siguiente"' + (isT ? ' disabled' : '') + '>' + ICON.right + '</button></div>';
  } else el.innerHTML = '<h1>' + (tab === 'hist' ? 'Historial' : 'Ajustes') + '</h1>';
}

function viewHoy() {
  const entries = entriesOf(date);
  const t = totals(entries);
  const P = PROT(), C = KCAL();
  let h = '';
  if (P) {
    const v = t[P.key], pct = Math.min(1, v / P.min), R = 54, L = 2 * Math.PI * R;
    const done = v >= P.min;
    h += '<section class="card"><div class="hero"><div class="ring' + (done ? ' done' : '') + '"><svg viewBox="0 0 132 132"><circle class="bg" cx="66" cy="66" r="' + R + '"/><circle class="fg" cx="66" cy="66" r="' + R + '" stroke-dasharray="' + L + '" stroke-dashoffset="' + (L * (1 - pct)) + '"/></svg><div class="c"><b class="num">' + fnum(v) + '</b><span>de ' + fnum(P.min) + ' g</span></div></div><div><h2>Proteína</h2>' +
      (done ? '<p class="big" style="color:var(--accent)">Objetivo cumplido</p><p>Llevas ' + fnum(v - P.min) + ' g de más.</p>' : '<p class="big num">Te faltan ' + fnum(P.min - v) + ' g</p><p>' + (entries.length ? Math.round(pct * 100) + '% del objetivo.' : 'Registra tu primera comida.') + '</p>') + '</div></div>';
    if (C) {
      const cv = t[C.key], st = statusOf(C, cv), top = C.max || C.min * 1.2;
      h += '<div class="kcal"><div class="row"><b>Calorías</b><span class="num"><b>' + fnum(cv) + '</b> <span class="muted">/ ' + fnum(C.min) + (C.max ? '–' + fnum(C.max) : '') + ' kcal</span></span></div><div class="bar ' + st + '"><i style="width:' + Math.min(100, cv / top * 100) + '%"></i><u style="left:' + (C.min / top * 100) + '%"></u></div></div>';
    }
    h += '</section>';
  }
  const hour = new Date().getHours();
  if (date === today() && hour >= 16) h += suggestCard(entries, date);
  else if (entries.length || date !== today()) h += '';

  // objetivos
  const n = met(t);
  h += '<div class="sec"><h2>Objetivos del día</h2><span class="num">' + n + ' de ' + DATA.goals.length + '</span></div><section class="card" style="margin-top:8px">';
  let grp = null;
  DATA.goals.forEach(g => {
    if (g.group !== grp) { grp = g.group; h += '<div class="grp">' + esc(grp) + '</div>'; }
    const v = t[g.key] || 0, st = statusOf(g, v), top = g.max || g.min;
    const pct = Math.min(100, v / top * 100);
    const lbl = st === 'ok' ? 'OK' : st === 'low' ? 'Falta' : 'Exceso';
    const range = g.min != null && g.max != null ? fnum(g.min, 1) + '–' + fnum(g.max, 1) : g.min != null ? 'mín. ' + fnum(g.min, 1) : 'máx. ' + fnum(g.max, 1);
    h += '<div class="goal"><button class="h" data-act="goal" data-k="' + esc(g.key) + '"><div class="row"><span class="nm">' + esc(g.short) + '</span><span><span class="num muted">' + fnum(v, v < 10 ? 1 : 0) + ' / ' + range + ' ' + esc(g.unit) + '</span> <span class="pill ' + st + '">' + lbl + '</span></span></div><div class="bar ' + st + '"><i style="width:' + pct + '%"></i>' + (g.min != null && g.max != null ? '<u style="left:' + (g.min / g.max * 100) + '%"></u>' : '') + '</div></button>';
    if (openGoal === g.key) h += '<p class="why">' + (g.why ? esc(g.why) + '<br>' : '') + sourcesOf(g) + '</p>';
    h += '</div>';
  });
  h += '</section>';

  // registro
  h += '<div class="sec"><h2>Lo que comiste</h2><span class="num">' + entries.length + (entries.length === 1 ? ' registro' : ' registros') + '</span></div><section class="card" style="margin-top:8px">';
  if (!entries.length) {
    const prev = prevDay();
    h += '<div class="empty"><b>Todavía no hay nada</b>Toca «Añadir» para registrar tu primera comida.' + (prev ? '<div class="btnrow"><button class="btn ghost" data-act="copy-prev">Copiar lo de ' + esc(dlabel(prev)) + '</button></div>' : '') + '</div>';
  } else {
    [...entries].sort((a, b) => a.t - b.t).forEach(e => {
      const f = food(e.food); const tm = new Date(e.t);
      const P0 = f && P ? (f.per100[P.key] || 0) * e.g / 100 : 0;
      h += '<button class="entry" data-act="edit" data-id="' + e.id + '"><span class="tm num">' + tm.getHours() + ':' + String(tm.getMinutes()).padStart(2, '0') + '</span><span class="t"><b>' + esc(f ? label(f) : e.food + ' (ya no está en el Excel)') + '</b><span>' + esc(f ? describe(f, e.g) : fnum(e.g) + ' g') + '</span></span><span class="p num">' + fnum(P0, 1) + ' g<small>proteína</small></span></button>';
    });
    const prev = prevDay();
    if (prev && date === today()) h += '<div class="btnrow"><button class="linkbtn" data-act="copy-prev">+ Copiar lo de ' + esc(dlabel(prev)) + '</button></div>';
  }
  h += '</section>';
  return h;
}
function prevDay() { const ks = Object.keys(LOG).filter(k => k < date).sort(); return ks.length ? ks[ks.length - 1] : null; }

function sourcesOf(g) {
  if (g.max != null && g.min == null) return '';
  const arr = DATA.foods.map(f => {
    const p = f.portions && f.portions[0]; const gr = p ? p.perUnit * p.qty : 100;
    return { f, v: (f.per100[g.key] || 0) * gr / 100, gr };
  }).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 3);
  if (!arr.length) return '';
  return '<b>Buenas fuentes:</b> ' + arr.map(x => esc(x.f.name.split(':')[0]) + ' (' + fnum(x.v, x.v < 10 ? 1 : 0) + ' ' + esc(g.unit) + ' en ' + esc(describe(x.f, x.gr)) + ')').join('; ') + '.';
}

function viewHist() {
  const ks = Object.keys(LOG).filter(k => LOG[k].length).sort().reverse();
  const P = PROT();
  if (!ks.length) return '<section class="card"><div class="empty"><b>Aún no hay días registrados</b>Cuando registres comidas, aquí verás cómo vas día a día.</div></section>';
  const days = [];
  for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() - i); days.push(dkey(d)); }
  let streak = 0; for (const k of days) { const t = totals(entriesOf(k)); if (P && t[P.key] >= P.min) streak++; else if (k === today()) continue; else break; }
  const last14 = days.slice(0, 14); const okP = P ? last14.filter(k => totals(entriesOf(k))[P.key] >= P.min).length : 0;
  let h = '<div class="stat"><div><b class="num">' + streak + '</b><span>días seguidos con proteína cumplida</span></div><div><b class="num">' + okP + '/14</b><span>días con proteína en 2 semanas</span></div></div><section class="card">';
  ks.slice(0, 60).forEach(k => {
    const t = totals(LOG[k]); const pv = P ? t[P.key] : 0; const pct = P ? Math.min(100, pv / P.min * 100) : 0;
    const st = P ? statusOf(P, pv) : 'ok';
    h += '<button class="day" data-act="goto" data-k="' + k + '"><div class="row"><b>' + esc(dlabel(k)) + '</b><span class="num tiny">' + fnum(P ? pv : 0) + ' g prot. · ' + fnum(t[KCAL() ? KCAL().key : ''] || 0) + ' kcal · ' + met(t) + '/' + DATA.goals.length + ' objetivos</span></div><div class="bar ' + st + '"><i style="width:' + pct + '%"></i></div></button>';
  });
  return h + '</section>';
}

function viewAjustes() {
  const d = new Date(DATA.importedAt);
  const demo = DATA === window.DATOS_INICIALES;
  return '<section class="card set"><h3>Datos del Excel</h3><p>' + DATA.foods.length + ' alimentos · ' + DATA.nutrients.length + ' nutrientes · ' + DATA.goals.length + ' objetivos.<br>' + (demo ? 'Datos incluidos con la app.' : 'Actualizado el ' + esc(dlabel(dkey(d))) + ' a las ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')) + '</p>' +
    '<button class="btn block" data-act="pick-xlsx">Actualizar desde el Excel</button>' +
    '<ol class="how" style="margin-top:12px"><li>Edita <b>Calculadora_Nutricion_Camilo.xlsx</b> y guarda.</li><li>Toca el botón y elige el archivo desde OneDrive.</li><li>Listo: alimentos, medidas, nutrientes y metas se actualizan. Tu registro no se toca.</li></ol><div id="diff"></div></section>' +
    '<section class="card set"><h3>Apariencia</h3><div class="seg" style="margin-top:8px">' + [['auto', 'Automática'], ['light', 'Clara'], ['dark', 'Oscura']].map(([v, l]) => '<button data-act="theme" data-v="' + v + '" class="' + (SET.theme === v ? 'on' : '') + '">' + l + '</button>').join('') + '</div></section>' +
    '<section class="card set"><h3>Aviso de las 4 PM</h3><p>Después de las 4:00 PM la app te muestra qué te falta para cerrar el día. Para que el iPhone te avise solo: en la app Atajos crea una automatización «Hora del día · 4:00 PM» con la acción «Abrir app» (Mi Nutrición).</p></section>' +
    '<section class="card set"><h3>Copia de seguridad</h3><p>Tu registro vive en este teléfono. ' + (SET.backup ? 'Última copia: ' + esc(dlabel(dkey(new Date(SET.backup)))) + '.' : 'Aún no has guardado ninguna copia.') + '</p><div class="btnrow" style="margin:0;justify-content:flex-start"><button class="btn ghost" data-act="export">Exportar registro</button><button class="btn ghost" data-act="pick-json">Importar copia</button></div></section>';
}

function render() {
  renderTop();
  const v = $('#view');
  v.innerHTML = tab === 'hoy' ? viewHoy() : tab === 'hist' ? viewHist() : viewAjustes();
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  $('#fab').hidden = tab !== 'hoy';
}

/* ---------- hoja: añadir / editar ---------- */
function openSheet(s) { sheet = s; $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; renderSheet(); }
function closeSheet() { sheet = null; $('#sheet').hidden = true; document.body.style.overflow = ''; render(); }
function renderSheet() {
  if (!sheet) return;
  const p = $('#panel');
  if (sheet.mode === 'list') {
    const q = NutriExcel.norm(sheet.q || ''), cats = ['Frecuentes', ...new Set(DATA.foods.map(f => f.cat))];
    const cur = sheet.cat || 'Frecuentes';
    let foods = DATA.foods.filter(f => !q || NutriExcel.norm(f.id).includes(q));
    if (!q) {
      if (cur === 'Frecuentes') { foods = foods.map(f => ({ f, c: freq(f.id) })).sort((a, b) => b.c - a.c || a.f.ord - b.f.ord).map(x => x.f); if (!foods.some(f => freq(f.id))) foods = foods.slice(0, 40); else foods = foods.filter(f => freq(f.id) > 0).concat(foods.filter(f => !freq(f.id))); }
      else foods = foods.filter(f => f.cat === cur);
    }
    const t = totals(entriesOf(date)), P = PROT();
    p.innerHTML = '<div class="grab"></div><div class="ph"><h2>Añadir alimento</h2><button class="x" data-act="close-sheet" aria-label="Cerrar">' + ICON.x + '</button></div>' +
      '<input class="search" id="q" type="search" placeholder="Busca o escribe: 2 bananos y 100 g de seitán" value="' + esc(sheet.q || '') + '" autocomplete="off">' +
      (q ? '' : '<div class="chips">' + cats.map(c => '<button class="chip' + (c === cur ? ' on' : '') + '" data-act="cat" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('') + '</div>') +
      '<div class="list">' + (foods.length ? foods.map(f => {
        const g = usualG(f);
        return '<div class="food"><button class="t" data-act="pick" data-id="' + esc(f.id) + '"><b>' + esc(emo(f) + ' ' + f.name) + '</b><span>' + esc(describe(f, g)) + ' · ' + fnum((f.per100[P ? P.key : ''] || 0) * g / 100, 1) + ' g prot.</span></button><button class="addbtn" data-act="quick" data-id="' + esc(f.id) + '" aria-label="Añadir ' + esc(describe(f, g)) + '">' + ICON.plus + '</button></div>';
      }).join('') : '<div class="empty">No encuentro «' + esc(sheet.q) + '» en tu Excel.<br>Agrégalo en la Base de datos y actualiza la app.</div>') + '</div>' +
      '<div class="sumbar"><span>Proteína del día: <b class="num">' + fnum(P ? t[P.key] : 0) + ' / ' + fnum(P ? P.min : 0) + ' g</b></span><button class="btn" data-act="close-sheet">Listo</button></div>';
    const inp = $('#q'); inp.onkeydown = e => { if (e.key === 'Enter' && /\d|medio|media|un |una |dos |tres /i.test(e.target.value)) { const t = e.target.value; sheet.q = ''; if (addByText(t)) { renderSheet(); } } }; inp.oninput = e => { sheet.q = e.target.value; const pos = e.target.selectionStart; renderSheet(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  } else {
    const f = food(sheet.food); if (!f) return closeSheet();
    const units = (f.portions || []);
    const u = sheet.unit >= 0 && units[sheet.unit] ? units[sheet.unit] : null;
    const grams = u ? sheet.qty * u.perUnit : sheet.qty;
    const step = u ? (/taza/.test(u.unit) ? .5 : 1) : 25;
    const P = PROT(), C = KCAL();
    const val = k => (f.per100[k] || 0) * grams / 100;
    const mac = DATA.nutrients.filter(n => /^(proteina|carbohidratos|grasa|calorias)/.test(n.key)).slice(0, 4);
    p.innerHTML = '<div class="grab"></div><div class="ph"><h2>' + esc(f.name.split(':')[0]) + '</h2><button class="x" data-act="' + (sheet.edit ? 'close-sheet' : 'back') + '" aria-label="Volver">' + (sheet.edit ? ICON.x : ICON.left) + '</button></div>' +
      '<div class="unitchips">' + units.map((x, i) => '<button class="chip' + (sheet.unit === i ? ' on' : '') + '" data-act="unit" data-i="' + i + '">' + esc(plural(x.unit, 2).replace(/^(.)/, c => c)) + '</button>').join('') + '<button class="chip' + (sheet.unit < 0 ? ' on' : '') + '" data-act="unit" data-i="-1">gramos</button></div>' +
      '<div class="stepper"><button data-act="step" data-d="-1" aria-label="Menos">' + ICON.minus + '</button><input id="qty" type="text" inputmode="decimal" value="' + esc(String(rnd(sheet.qty, 2)).replace('.', ',')) + '" aria-label="Cantidad"><button data-act="step" data-d="1" aria-label="Más">' + ICON.plus + '</button></div>' +
      (u ? '' : '<div class="presets">' + [50, 100, 150, 200, 300].map(x => '<button class="chip" data-act="setg" data-g="' + x + '">' + x + ' g</button>').join('') + '</div>') + '<p class="eq num">' + (u ? esc(plural(u.unit, sheet.qty)) + ' = ' : '') + fnum(grams, 1) + ' g</p>' +
      '<div class="macro">' + mac.map(n => '<div><b class="num">' + fnum(val(n.key), val(n.key) < 10 ? 1 : 0) + '</b><span>' + esc(n.short.toLowerCase().replace('carbohidratos', 'carbos')) + (n.unit === 'kcal' ? '' : ' (' + esc(n.unit) + ')') + '</span></div>').join('') + '</div>' +
      (sheet.edit ? '<div class="btnrow" style="margin:0"><button class="btn bad" data-act="del">Eliminar</button><button class="btn" style="flex:1" data-act="save">Guardar</button></div>' : '<button class="btn block" data-act="add">Añadir al día</button>');
    sheet._step = step; sheet._grams = grams;
    const qi = $('#qty'); qi.oninput = e => { const v = parseFloat(e.target.value.replace(',', '.')); sheet.qty = isNaN(v) ? 0 : v; updatePreview(); };
  }
}
function updatePreview() { const pos = document.activeElement && document.activeElement.id === 'qty'; const v = $('#qty').value; renderSheet(); if (pos) { const q = $('#qty'); q.focus(); q.value = v; q.setSelectionRange(v.length, v.length); } }

function pickFood(id, edit) {
  const f = food(id); const g = edit ? edit.g : usualG(f);
  const units = f.portions || []; let ui = units.length ? 0 : -1, qty = g;
  if (ui >= 0) { qty = rnd(g / units[0].perUnit, 2); if (!edit) qty = units[0].qty * (Math.abs(g - units[0].perUnit * units[0].qty) < .5 ? 1 : g / (units[0].perUnit * units[0].qty)); qty = rnd(g / units[0].perUnit, 2); }
  sheet = { mode: 'detail', food: id, unit: ui, qty, edit: edit ? edit.id : null, from: sheet && sheet.mode === 'list' ? sheet : null };
  renderSheet();
}

/* ---------- eventos ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-act],#tabs button[data-tab]'); if (!b) return;
  if (b.dataset.tab) { tab = b.dataset.tab; render(); window.scrollTo(0, 0); return; }
  const a = b.dataset.act, d = b.dataset;
  switch (a) {
    case 'prev': { const x = fromKey(date); x.setDate(x.getDate() - 1); date = dkey(x); render(); break; }
    case 'next': { const x = fromKey(date); x.setDate(x.getDate() + 1); if (dkey(x) <= today()) date = dkey(x); render(); break; }
    case 'goal': openGoal = openGoal === d.k ? null : d.k; render(); break;
    case 'goto': date = d.k; tab = 'hoy'; render(); window.scrollTo(0, 0); break;
    case 'copy-prev': { const pk = prevDay(); if (pk) { LOG[pk].forEach(e => addEntry(e.food, e.g, date, true)); render(); toast('Copiado: ' + dlabel(pk)); } break; }
    case 'close-sheet': closeSheet(); break;
    case 'cat': sheet.cat = d.c; renderSheet(); break;
    case 'pick': pickFood(d.id); break;
    case 'quick': { const f = food(d.id); addEntry(d.id, usualG(f)); renderSheet(); break; }
    case 'back': if (sheet.from) { sheet = sheet.from; renderSheet(); } else closeSheet(); break;
    case 'unit': { const i = +d.i, f = food(sheet.food), g = sheet._grams, u = f.portions[i]; sheet.unit = i; sheet.qty = i >= 0 ? rnd(g / u.perUnit, 2) : rnd(g, 1); renderSheet(); break; }
    case 'setg': sheet.qty = +d.g; renderSheet(); break;
    case 'step': { sheet.qty = Math.max(0, rnd(sheet.qty + (+d.d) * sheet._step, 2)); renderSheet(); break; }
    case 'add': { if (sheet._grams > 0) { addEntry(sheet.food, sheet._grams); if (sheet.from) { sheet = sheet.from; renderSheet(); } else closeSheet(); } break; }
    case 'save': { const e = entriesOf(date).find(x => x.id === sheet.edit); if (e) { e.g = rnd(sheet._grams, 1); saveLog(); } closeSheet(); break; }
    case 'del': { const id = sheet.edit; closeSheet(); removeEntry(id); break; }
    case 'edit': { const e = entriesOf(date).find(x => x.id === d.id); if (e && food(e.food)) { sheet = null; $('#sheet').hidden = false; document.body.style.overflow = 'hidden'; pickFood(e.food, e); } break; }
    case 'sug-add': { const p = suggestCard.last.picks[+d.i]; if (p) { addEntry(p.f.id, p.g); } break; }
    case 'theme': SET.theme = d.v; saveSet(); applyTheme(); render(); break;
    case 'pick-xlsx': $('#xlsxIn').click(); break;
    case 'pick-json': $('#jsonIn').click(); break;
    case 'export': exportLog(); break;
  }
});
$('#fab').onclick = () => { if (!sheet) openSheet({ mode: 'list', cat: 'Frecuentes' }); };

function applyTheme() { const r = document.documentElement; if (SET.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', SET.theme); }

/* ---------- importar Excel ---------- */
$('#xlsxIn').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const nd = NutriExcel.parseWorkbook(XLSX, wb);
    if (!nd.foods.length || !nd.goals.length) throw new Error('El archivo no tiene alimentos u objetivos.');
    const oldIds = new Set(DATA.foods.map(f => f.id)), newIds = new Set(nd.foods.map(f => f.id));
    const added = nd.foods.filter(f => !oldIds.has(f.id)).map(f => f.name.split(':')[0]);
    const removed = DATA.foods.filter(f => !newIds.has(f.id)).map(f => f.name.split(':')[0]);
    const changed = [];
    nd.goals.forEach(g => { const o = DATA.goals.find(x => x.key === g.key); if (!o) changed.push('Nuevo objetivo: ' + g.short); else if (o.min !== g.min || o.max !== g.max) changed.push(g.short + ': ' + (o.min ?? '–') + (o.max != null ? '–' + o.max : '') + ' → ' + (g.min ?? '–') + (g.max != null ? '–' + g.max : '')); });
    DATA.goals.forEach(o => { if (!nd.goals.find(g => g.key === o.key)) changed.push('Objetivo quitado: ' + o.short); });
    const newNut = nd.nutrients.filter(n => !DATA.nutrients.find(o => o.key === n.key)).map(n => n.short);
    DATA = nd; store.set('nutri.data', DATA); indexFoods(); render();
    const li = x => x.length ? '<ul class="diff">' + x.slice(0, 8).map(i => '<li>' + esc(i) + '</li>').join('') + (x.length > 8 ? '<li>y ' + (x.length - 8) + ' más…</li>' : '') + '</ul>' : '';
    const box = $('#diff');
    if (box) box.innerHTML = '<p style="margin:12px 0 0"><b>Actualizado.</b> ' + nd.foods.length + ' alimentos, ' + nd.goals.length + ' objetivos.</p>' +
      (added.length ? '<p class="tiny" style="margin:6px 0 0">Alimentos nuevos</p>' + li(added) : '') + (removed.length ? '<p class="tiny" style="margin:6px 0 0">Ya no están (tus registros viejos se conservan)</p>' + li(removed) : '') +
      (newNut.length ? '<p class="tiny" style="margin:6px 0 0">Nutrientes nuevos</p>' + li(newNut) : '') + (changed.length ? '<p class="tiny" style="margin:6px 0 0">Metas que cambiaron</p>' + li(changed) : '') +
      (!added.length && !removed.length && !changed.length && !newNut.length ? '<p class="tiny">No hubo cambios en alimentos ni metas (los valores nutricionales sí se refrescaron).</p>' : '');
  } catch (err) { toast('No pude leer el Excel: ' + err.message); }
};

/* ---------- copia de seguridad ---------- */
function exportLog() {
  const blob = new Blob([JSON.stringify({ app: 'mi-nutricion', exported: new Date().toISOString(), log: LOG }, null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mi-nutricion-' + today() + '.json'; document.body.appendChild(a); a.click(); a.remove(); SET.backup = new Date().toISOString(); saveSet(); setTimeout(render, 300);
}
$('#jsonIn').onchange = async e => {
  const file = e.target.files[0]; e.target.value = ''; if (!file) return;
  try {
    const j = JSON.parse(await file.text()); if (!j.log) throw new Error('no parece una copia de Mi Nutrición');
    let n = 0; Object.keys(j.log).forEach(k => { const have = new Set((LOG[k] || []).map(x => x.id)); j.log[k].forEach(x => { if (!have.has(x.id)) { (LOG[k] = LOG[k] || []).push(x); n++; } }); });
    saveLog(); render(); toast('Importados ' + n + ' registros');
  } catch (err) { toast('No pude importar: ' + err.message); }
};

/* ---------- arranque ---------- */
applyTheme();
render();
// mensaje de las 4 PM: una vez al día, al abrir la app
(function () {
  const now = new Date();
  if (now.getHours() >= 16 && SET.shown !== today() && tab === 'hoy') {
    SET.shown = today(); saveSet();
    const t = totals(entriesOf(today())), pend = DATA.goals.filter(g => g.min != null && (t[g.key] || 0) < g.min);
    setTimeout(() => window.scrollTo(0, 0), 0);
    if (pend.length) toast('Pasadas las 4 PM · te faltan ' + pend.length + ' objetivos. Mira las sugerencias arriba.');
  }
})();

/* ---------- comandos de texto o voz: «2 bananos y 100 g de seitán» ---------- */
const NUMW = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12 };
const STOP = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'mi', 'en', 'al', 'a', 'que', 'comi', 'agrega', 'agregar', 'anade', 'anadir', 'añade', 'añadir', 'registra', 'registrar', 'gramos', 'gramo', 'gr', 'g', 'porcion', 'porciones']);
const sim = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && Math.abs(a.length - b.length) <= 2 && (a.startsWith(b) || b.startsWith(a)));
const unitHit = (t, unit) => { const k = NutriExcel.norm(unit).split(' ')[0]; if (k === 'cda') return t.startsWith('cucharad') || t === 'cda' || t === 'cdas'; return sim(t, k); };
const ALIAS = { leche: ['bebida', 'soya'], soja: ['soya'], frijol: ['frijoles'], cafe: ['cafe'] };
function parseSegment(txt) {
  const toks = NutriExcel.norm(txt).replace(/[^a-z0-9., ]/g, ' ').split(/\s+/).filter(Boolean);
  let qty = null, grams = false; const words = [];
  toks.forEach(t => {
    if (/^\d+([.,]\d+)?$/.test(t)) qty = parseFloat(t.replace(',', '.'));
    else if (t === 'medio' || t === 'media') qty = (qty || 0) + .5;
    else if (NUMW[t] != null) qty = NUMW[t];
    else { if (/^(gramos?|gr|g)$/.test(t)) grams = true; if (!STOP.has(t)) (ALIAS[t] || [t]).forEach(x => words.push(x)); }
  });
  if (!words.length) return null;
  const scored = DATA.foods.map(f => {
    const nt = NutriExcel.norm(f.name).split(/[\s,:/]+/).filter(Boolean);
    const hit = words.filter(w => nt.some(n => sim(w, n))).length;
    return { f, hit, len: nt.length };
  }).filter(x => x.hit > 0).sort((a, b) => b.hit - a.hit || a.len - b.len);
  if (!scored.length) return { fail: txt.trim() };
  const f = scored[0].f; let g;
  const unitTok = words.find(w => (f.portions || []).some(p => unitHit(w, p.unit)));
  if (grams && qty != null) g = qty;
  else if (unitTok) { const p = f.portions.find(p => unitHit(unitTok, p.unit)); g = (qty == null ? 1 : qty) * p.perUnit; }
  else if (qty != null && f.portions && f.portions.length) g = qty * f.portions[0].perUnit;
  else if (qty != null) g = qty >= 10 ? qty : qty * 100;
  else g = usualG(f);
  return { f, g: rnd(g, 1) };
}
function addByText(text) {
  const segs = NutriExcel.norm(text).split(/,| y (?!medio|media)| mas | con /).map(s => s.trim()).filter(Boolean);
  const added = [], fails = [];
  if (date !== today()) date = today();
  segs.forEach(s => { const r = parseSegment(s); if (!r) return; if (r.fail) fails.push(r.fail); else added.push({ r, e: addEntry(r.f.id, r.g, today(), true) }); });
  const P = PROT(); const tot = totals(entriesOf(today()));
  if (added.length) {
    const msg = '✓ ' + added.map(x => emo(x.r.f) + ' ' + x.r.f.name.split(':')[0] + ' ' + fnum(x.r.g) + ' g').join(', ') + (P ? ' · proteína ' + fnum(tot[P.key]) + '/' + fnum(P.min) + ' g' : '');
    toast(msg, () => { added.forEach(x => { LOG[today()] = (LOG[today()] || []).filter(e => e.id !== x.e.id); }); saveLog(); render(); });
  }
  if (fails.length) { tab = 'hoy'; render(); openSheet({ mode: 'list', cat: 'Frecuentes', q: fails.join(' ') }); if (!added.length) toast('No encontré «' + fails.join(', ') + '» en tu Excel'); }
  return added.length;
}
(function () {
  try {
    const q = new URLSearchParams(location.search).get('add');
    if (q) { tab = 'hoy'; setTimeout(() => addByText(q), 50); history.replaceState(null, '', location.pathname); }
  } catch (e) {}
})();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__app = { addByText, get DATA() { return DATA; }, get LOG() { return LOG; }, totals, suggest, entriesOf, addEntry };
})();
