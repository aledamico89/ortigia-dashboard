import {
  CATEGORIE, NON_COSTI, monthKey, addMonths, monthDiff, monthsBetween, monthLabel, MESI,
  registro, kpi, capitaleProprio, costiTransazione, feePM, presets, simula, sintesiAnnua, stagionalita, valoreImmobile, pmt,
} from './finance.js';
import { getConfig, setConfig, makeStore } from './store.js';

// ---------- Stato ----------
let data = null;
let store = null;
const UI_KEY = 'ortigia.ui.v1';
const ui = Object.assign({
  view: 'panoramica', valore: 'nominale', stime: true, attr: 'check_in',
  refs: { 2024: false, 2025: true, 2026: true }, cmp: {}, theme: 'auto', sim: null,
}, (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })());
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ } };
const charts = {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- Formattazione ----------
const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const eur = (x, d = 0) => (x == null || Number.isNaN(x) ? '—' : `${(d ? nf2 : nf0).format(Math.abs(x) < (d ? 0.005 : 0.5) ? 0 : x)} €`);
const eurS = (x, d = 0) => (x > 0.004 ? '+' : x < -0.004 ? '−' : '') + eur(Math.abs(x), d);
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x * 100)}%`);
const cls = (x) => (x > 0.004 ? 'pos' : x < -0.004 ? 'neg' : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => monthKey(new Date());

function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = err ? 'show err' : 'show';
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, err ? 6000 : 2600);
}
function setStatus(state, label) {
  const p = $('#src-pill'); p.className = `pill ${state}`;
  $('#src-label').textContent = label;
}
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// ---------- Persistenza ----------
async function persist(message) {
  data.aggiornato = today();
  setStatus('busy', 'Salvataggio…');
  try {
    await store.save(data, message);
    setStatus('ok', store.label());
    toast('Salvato');
  } catch (e) {
    setStatus('err', 'Errore di salvataggio');
    toast(e.message, true);
    throw e;
  }
  renderAll();
}

async function boot() {
  applyTheme();
  store = makeStore();
  setStatus('busy', 'Caricamento…');
  try {
    data = await store.load();
  } catch (e) {
    setStatus('err', 'Errore');
    toast(e.message, true);
    data = null;
  }
  $('#boot').remove();
  if (!data) {
    setStatus('err', 'Nessun dato');
    showView('impostazioni');
    $('#v-impostazioni').insertAdjacentHTML('afterbegin', '<div class="note warn" style="margin-bottom:14px">Nessun dato caricato. Collega il repository GitHub privato con il file <code>ledger.json</code>, oppure importa un backup JSON.</div>');
    renderSettings();
    return;
  }
  migrate();
  setStatus('ok', store.label());
  if (!ui.sim) ui.sim = data.simulatore?.params || defaultSim();
  renderAll();
  showView(ui.view);
}

function migrate() {
  data.spese ??= []; data.incassi ??= []; data.valutazioni ??= []; data.budget ??= [];
  data.simulatore ??= {};
}

// ---------- Navigazione ----------
function showView(v) {
  ui.view = v; saveUI();
  $$('nav.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  $$('section.view').forEach((s) => s.classList.toggle('active', s.id === `v-${v}`));
  // i grafici creati in una sezione nascosta hanno dimensione zero: li ridisegno quando la sezione diventa visibile
  if (data) requestAnimationFrame(() => ({ panoramica: renderPanoramica, simulatore: updateSim, mercato: renderMercato }[v]?.()));
}
$$('nav.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

function applyTheme() {
  if (ui.theme === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = ui.theme;
  $('#theme-btn').title = `Tema: ${ui.theme}`;
}
$('#theme-btn').addEventListener('click', () => {
  ui.theme = { auto: 'light', light: 'dark', dark: 'auto' }[ui.theme]; saveUI(); applyTheme();
  if (data) renderAll();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (data && ui.theme === 'auto') renderAll(); });

function seg(el, value, onChange) {
  $$('button', el).forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.v === value));
    b.onclick = () => onChange(b.dataset.v);
  });
}

// ---------- Chart helpers ----------
function chart(id, config) {
  charts[id]?.destroy();
  const ctx = document.getElementById(id);
  if (!ctx || !window.Chart) return null;
  charts[id] = new Chart(ctx, config);
  return charts[id];
}
function baseOptions(extra = {}) {
  const grid = css('--grid'); const muted = css('--muted'); const axis = css('--axis');
  return {
    responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: css('--surface'), titleColor: css('--ink'), bodyColor: css('--ink-2'),
        borderColor: css('--axis'), borderWidth: 1, padding: 10, boxPadding: 4, usePointStyle: true,
        callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw == null ? '—' : eur(c.raw)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: axis }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 12, font: { size: 11 } } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 11 }, callback: (v) => nf0.format(v) } },
    },
    ...extra,
  };
}
const legendHTML = (items) => items.map(([c, l, dashed]) => `<span><i style="background:${dashed ? 'transparent' : c};${dashed ? `border:2px dashed ${c};height:0;width:12px;border-radius:0;vertical-align:3px` : ''}"></i>${esc(l)}</span>`).join('');

// ---------- Simulatore: parametri ----------
function costiAnnuiBudget() { return Math.round(data.budget.reduce((s, b) => s + Number(b.annuo || 0), 0)); }
function defaultSim(presetKey = '2026') {
  const pr = presets(data)[presetKey];
  return {
    preset: presetKey, notti: pr.notti, adr: pr.adr, commPct: pr.commPct,
    feePct: Math.round(data.pm.fee * 1000) / 10, cedPct: data.fiscale.cedolare * 100, cedBase: data.fiscale.base,
    costiAnnui: costiAnnuiBudget(), crescitaRicavi: 0.02, inflazione: 0.02, rivalutazione: 0, anni: 15, extraAnnuo: 0,
  };
}
function simParams(src = ui.sim) {
  return { ...src, crescitaRicavi: Number(src.crescitaRicavi), inflazione: Number(src.inflazione), rivalutazione: Number(src.rivalutazione) };
}

// ---------- Render generale ----------
function renderAll() {
  $('#t-nome').textContent = `${data.immobile.nome}`;
  $('#t-zona').textContent = `${data.immobile.zona} · rogito ${new Date(data.immobile.rogito).toLocaleDateString('it-IT')}`;
  renderPanoramica();
  renderRegistro();
  renderSimulatore();
  renderMercato();
  renderGetquin();
  renderSettings();
  $('#foot').innerHTML = `Dati aggiornati al ${esc(data.aggiornato)} · ${esc(store.label())} · I calcoli fiscali sono stime: verifica con il commercialista.`;
}

function fineAnalisi() {
  const cm = currentMonth();
  const lastInc = data.incassi.map((x) => x.mese).sort().pop();
  let fine = cm;
  if (lastInc && monthDiff(fine, lastInc) > 0) fine = lastInc;
  if (monthDiff(data.immobile.inizio_gestione, fine) < 0) fine = data.immobile.inizio_gestione;
  return fine;
}

// ---------- PANORAMICA ----------
function renderPanoramica() {
  seg($('#seg-valore'), ui.valore, (v) => { ui.valore = v; saveUI(); renderPanoramica(); renderGetquin(); });
  const chk = $('#opt-stime'); chk.checked = ui.stime;
  $('#chip-stime').classList.toggle('off', !ui.stime);
  chk.onchange = () => { ui.stime = chk.checked; saveUI(); renderPanoramica(); renderGetquin(); };

  const fine = fineAnalisi();
  const reg = registro(data, fine, { stime: ui.stime });
  const k = kpi(data, reg, ui.valore);
  const R = reg.righe;

  // Proiezione dallo scenario salvato
  const p = simParams(data.simulatore?.params || ui.sim || defaultSim());
  const start = { mese: addMonths(fine, 1), debito: k.debito, cfCum: k.cfCum, valore: k.valore, piano: reg.piano };
  const proj30 = simula(data, { ...p, anni: 30 }, start);
  const etaCassa = proj30.find((r) => r.cfCum >= k.cap)?.mese;
  const etaPatr = k.posizione >= 0 ? fine : proj30.find((r) => r.posizione >= 0)?.mese;
  const scenLabel = presets(data)[p.preset]?.label || 'personalizzato';

  // Hero
  $('#h-cf').innerHTML = `<span class="${cls(k.cfCum)}">${eurS(k.cfCum)}</span>`;
  const lastInc = data.incassi.slice().sort((a, b) => a.mese.localeCompare(b.mese)).pop();
  $('#h-meta').innerHTML = `${k.mesi} ${k.mesi === 1 ? 'mese' : 'mesi'} di gestione (${monthLabel(data.immobile.inizio_gestione, true)} → ${monthLabel(fine, true)})`
    + (lastInc ? ` · ultimo incasso: ${monthLabel(lastInc.mese, true)}${lastInc.stato === 'provvisorio' ? ' <span class="badge warn">provvisorio</span>' : ''}` : '');
  const m1 = Math.max(0, Math.min(1, k.recuperoCassa));
  $('#m1').style.width = `${m1 * 100}%`; $('#m1').classList.toggle('neg', k.cfCum < 0);
  $('#m1-txt').textContent = `${pct(k.recuperoCassa, 0)} di ${eur(k.cap)}`;
  $('#m1-sub').textContent = etaCassa ? `Previsto ${monthLabel(etaCassa, true)} · scenario ${scenLabel}` : `Non raggiunto entro 30 anni con lo scenario ${scenLabel}`;
  const m2 = Math.max(0, Math.min(1, k.recuperoPatr));
  $('#m2').style.width = `${m2 * 100}%`; $('#m2').classList.toggle('neg', k.recuperoPatr < 0);
  $('#m2-txt').textContent = `${pct(k.recuperoPatr, 0)} di ${eur(k.trans)}`;
  $('#m2-sub').textContent = k.posizione >= 0 ? 'Raggiunto' : etaPatr ? `Previsto ${monthLabel(etaPatr, true)} · rivalutazione ${pct(p.rivalutazione)} annua` : `Non raggiunto entro 30 anni con lo scenario ${scenLabel}`;

  // KPI
  const ann = k.mesi < 12 ? `annualizzato su ${k.mesi} ${k.mesi === 1 ? 'mese' : 'mesi'}` : 'annualizzato';
  const tiles = [
    ['Rendimento netto su prezzo', pct(k.rendNetto), `${ann} · reddito netto dopo tasse ÷ ${eur(data.immobile.prezzo)}`, cls(k.rendNetto), 'Reddito operativo dopo PM, portali, cedolare e costi, prima della rata del mutuo, diviso il prezzo di acquisto.'],
    ['Cash-on-cash', pct(k.cashOnCash), `${ann} · cash flow ÷ capitale proprio`, cls(k.cashOnCash), 'Cash flow netto (dopo la rata) annualizzato, diviso i soldi usciti di tasca tua.'],
    ['ROI totale', pct(k.roiTot), `annualizzato ${pct(k.roiTotAnn)} · include capitale rimborsato${ui.valore !== 'nominale' ? ' e rivalutazione' : ''}`, cls(k.roiTot), '(Cash flow cumulato + quota capitale del mutuo rimborsata + rivalutazione) ÷ capitale proprio.'],
    ['Lordo incassato', eur(k.lordo), `${nf0.format(k.notti)} notti · ADR ${k.notti ? eur(k.lordo / k.notti) : '—'}`, '', 'Somma pagata dagli ospiti, esclusa la tassa di soggiorno.'],
    ['Debito residuo', eur(k.debito), `capitale rimborsato ${eur(k.capRimb)}`, '', 'Debito residuo del mutuo dopo l\'ultima rata del periodo.'],
    ['Patrimonio netto immobiliare', eur(k.equity), `LTV ${pct(k.ltv, 0)} · valore ${eur(k.valore)}`, '', 'Valore dell\'immobile (secondo la modalità scelta) meno il debito residuo.'],
    ['Cedolare da accantonare', eur(k.tasseDaAccantonare), `maturata ${eur(k.ced)} · trattenuta ${eur(k.ritenute)}`, '', 'Cedolare secca maturata meno le ritenute già trattenute dagli intermediari e gli F24 registrati.'],
    ['Costi operativi', eur(k.costi), k.costiStimati ? `di cui stimati ${eur(k.costiStimati)}` : 'tutti da spese reali', '', 'Utenze, polizza, TARI, IMU, manutenzione: reali dove ci sono bollette, altrimenti quota di budget.'],
  ];
  $('#kpi-grid').innerHTML = tiles.map(([l, v, s, c, info]) => `<div class="card tile"><div class="t-label">${esc(l)} <span class="info" title="${esc(info)}" tabindex="0" aria-label="${esc(info)}">i</span></div><div class="t-value ${c}">${v}</div><div class="t-sub">${s}</div></div>`).join('');

  renderRicaviChart(R);
  renderSplit(k);
  renderPosizione(R, k, proj30, p, fine);
  renderTabellaMensile(R);
  renderAcquisto(k, reg);
}

function renderRicaviChart(R) {
  const inizio = data.immobile.inizio_gestione;
  const fine = R.length ? R[R.length - 1].mese : inizio;
  const from = monthDiff(inizio, fine) >= 11 ? addMonths(fine, -11) : inizio;
  const mesi = monthsBetween(from, addMonths(from, 11));
  const byM = Object.fromEntries(R.map((r) => [r.mese, r]));
  const st = data.storico;
  const refSeries = {
    2024: { color: css('--s2'), label: 'Storico 2024', val: (mi) => st['2024'].notti[mi] * st['2024'].adr },
    2025: { color: css('--s3'), label: 'Storico 2025', val: (mi) => st['2025'].notti[mi] * st['2025'].adr },
    2026: { color: css('--s7'), label: 'Storico 2026', val: (mi) => st['2026'].lordo[mi] || null },
  };
  $('#ref-chips').innerHTML = '<span class="lbl">Confronta</span>' + Object.entries(refSeries).map(([y, s]) => `<label class="chip ${ui.refs[y] ? '' : 'off'}" style="color:${s.color}"><input type="checkbox" data-y="${y}" ${ui.refs[y] ? 'checked' : ''}><span class="sw"></span><span style="color:var(--ink-2)">${y}</span></label>`).join('');
  $$('#ref-chips input').forEach((i) => i.addEventListener('change', () => { ui.refs[i.dataset.y] = i.checked; saveUI(); renderRicaviChart(R); }));
  const ds = [{
    type: 'bar', label: 'Reale', data: mesi.map((m) => (byM[m]?.inc ? byM[m].lordo : null)),
    backgroundColor: css('--s1'), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24, order: 2,
  }];
  for (const [y, s] of Object.entries(refSeries)) {
    if (!ui.refs[y]) continue;
    ds.push({ type: 'line', label: s.label, data: mesi.map((m) => { const v = s.val(Number(m.slice(5, 7)) - 1); return v ? Math.round(v) : null; }),
      borderColor: s.color, backgroundColor: s.color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, spanGaps: false, order: 1 });
  }
  chart('c-ricavi', { data: { labels: mesi.map((m) => monthLabel(m)), datasets: ds }, options: baseOptions() });
}

function renderSplit(k) {
  const L = k.lordo;
  $('#split-sub').textContent = `${k.mesi} ${k.mesi === 1 ? 'mese' : 'mesi'} · su ${eur(L)} lordi`;
  if (!L) { $('#split').innerHTML = '<div class="empty">Nessun incasso registrato nel periodo.</div>'; return; }
  const rows = [
    ['Commissioni portali', k.comm], ['Property manager', k.fee], ['Cedolare secca', k.ced], ['Costi operativi', k.costi],
    ['Interessi e spese mutuo', k.interessi + k.speseMutuo], ['Quota capitale mutuo', k.capitale],
  ];
  const max = Math.max(L, ...rows.map((r) => r[1]), Math.abs(k.cfCum));
  const bar = (v, color) => `<div class="meter-track" style="background:var(--surface-2)"><div class="meter-fill" style="width:${Math.min(100, Math.abs(v) / max * 100)}%;background:${color}"></div></div>`;
  $('#split').innerHTML = `<div class="stack" style="--gap:8px">${rows.map(([l, v]) => `
    <div><div class="meter-row"><span>${l}</span><span class="num">${eur(v)} <small>· ${pct(v / L, 0)}</small></span></div>${bar(v, css('--s1'))}</div>`).join('')}
    <div><div class="meter-row"><strong>Cash flow netto</strong><span class="num ${cls(k.cfCum)}"><strong>${eurS(k.cfCum)}</strong> <small>· ${pct(k.cfCum / L, 0)}</small></span></div>${bar(k.cfCum, k.cfCum >= 0 ? css('--good') : css('--bad'))}</div>
    <p class="muted" style="font-size:12px;margin:0">La quota capitale non è una perdita: riduce il debito e aumenta il tuo patrimonio netto.</p></div>`;
}

function renderPosizione(R, k, proj30, p, fine) {
  const cap = k.cap;
  // ricostruisce la posizione reale mese per mese
  let cfCum = 0;
  const real = R.map((r) => { cfCum += r.cf; const v = valoreImmobile(data, r.mese, ui.valore); return { mese: r.mese, cfCum, posizione: v - r.debito + cfCum - cap }; });
  const anni = Math.max(5, Math.min(30, p.anni || 15));
  const endMese = addMonths(data.immobile.inizio_gestione, anni * 12 - 1);
  const proj = proj30.filter((r) => monthDiff(r.mese, endMese) >= 0);
  const labels = [...real.map((r) => r.mese), ...proj.map((r) => r.mese)];
  const nR = real.length;
  const s1 = css('--s1'); const s2 = css('--s2');
  const dsReal = (key) => [...real.map((r) => Math.round(r[key])), ...proj.map(() => null)];
  const dsProj = (key) => [...real.map((r, i) => (i === nR - 1 ? Math.round(r[key]) : null)), ...proj.map((r) => Math.round(r[key]))];
  chart('c-posizione', {
    type: 'line',
    data: {
      labels: labels.map((m) => monthLabel(m)),
      datasets: [
        { label: 'Posizione netta (reale)', data: dsReal('posizione'), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: nR < 3 ? 4 : 0, tension: 0.2 },
        { label: 'Posizione netta (proiezione)', data: dsProj('posizione'), borderColor: s1, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: 'Cash flow cumulato (reale)', data: dsReal('cfCum'), borderColor: s2, backgroundColor: s2, borderWidth: 2, pointRadius: nR < 3 ? 4 : 0, tension: 0.2 },
        { label: 'Cash flow cumulato (proiezione)', data: dsProj('cfCum'), borderColor: s2, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2 },
      ],
    },
    options: baseOptions({
      plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, filter: (c) => c.raw != null } },
      scales: { ...baseOptions().scales, x: { ...baseOptions().scales.x, ticks: { ...baseOptions().scales.x.ticks, maxTicksLimit: 10 } },
        y: { ...baseOptions().scales.y, grid: { color: (c) => (c.tick.value === 0 ? css('--axis') : css('--grid')), lineWidth: (c) => (c.tick.value === 0 ? 1.5 : 1) } } },
    }),
  });
  $('#pos-legend').innerHTML = legendHTML([[s1, 'Posizione netta'], [s2, 'Cash flow cumulato'], [css('--muted'), 'proiezione', true]]);
  const pr = presets(data)[p.preset];
  $('#proj-badge').textContent = `Scenario: ${pr ? pr.label : 'personalizzato'} · ${nf0.format(p.notti)} notti × ${eur(p.adr)}`;
}

function renderTabellaMensile(R) {
  const cols = [['Mese'], ['Lordo', 'lordo'], ['Portali', 'comm'], ['PM', 'fee'], ['Cedolare', 'ced'], ['Costi', 'costiTot'], ['Reddito netto', 'noi'], ['Rata mutuo', 'servizio'], ['Cash flow', 'cf'], ['CF cumulato'], ['Debito']];
  let cum = 0;
  const rows = R.map((r) => {
    cum += r.cf;
    const est = r.costiStimati ? '<span class="est" title="include costi stimati">ˢ</span>' : '';
    return `<tr><td>${monthLabel(r.mese, true)}${r.inc?.stato === 'provvisorio' ? ' <span class="badge warn">prov.</span>' : ''}${!r.inc ? ' <span class="badge">no incassi</span>' : ''}</td>
      <td class="n">${eur(r.lordo)}</td><td class="n">${eur(-r.comm)}</td><td class="n">${eur(-r.fee)}</td><td class="n">${eur(-r.ced)}</td>
      <td class="n" title="${esc(Object.entries(r.costi).map(([c, v]) => `${CATEGORIE[c] || c}: ${eur(v.importo, 2)}${v.stimato ? ' (stima)' : ''}`).join('\n'))}">${eur(-r.costiTot)}${est}</td>
      <td class="n ${cls(r.noi)}">${eur(r.noi)}</td><td class="n">${eur(-r.servizio)}</td><td class="n ${cls(r.cf)}"><strong>${eurS(r.cf)}</strong></td><td class="n ${cls(cum)}">${eurS(cum)}</td><td class="n">${eur(r.debito)}</td></tr>`;
  });
  const t = (f) => R.reduce((s, r) => s + f(r), 0);
  const tot = `<tr class="total"><td>Totale</td><td class="n">${eur(t((r) => r.lordo))}</td><td class="n">${eur(-t((r) => r.comm))}</td><td class="n">${eur(-t((r) => r.fee))}</td><td class="n">${eur(-t((r) => r.ced))}</td><td class="n">${eur(-t((r) => r.costiTot))}</td><td class="n">${eur(t((r) => r.noi))}</td><td class="n">${eur(-t((r) => r.servizio))}</td><td class="n ${cls(cum)}">${eurS(cum)}</td><td></td><td></td></tr>`;
  $('#t-mensile').innerHTML = `<thead><tr>${cols.map(([c], i) => `<th class="${i ? 'n' : ''}">${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}${tot}</tbody>`;
  $('#csv-mensile').onclick = () => downloadCSV('ortigia-conto-economico.csv',
    [['mese', 'lordo', 'commissioni_portali', 'fee_pm', 'cedolare', 'costi', 'reddito_netto', 'interessi', 'quota_capitale', 'spese_mutuo', 'cash_flow', 'debito_residuo'],
      ...R.map((r) => [r.mese, r.lordo, r.comm, r.fee, r.ced, r.costiTot, r.noi, r.interessi, r.capitale, r.speseMutuo, r.cf, r.debito].map((v) => (typeof v === 'number' ? v.toFixed(2) : v)))]);
}

function renderAcquisto(k, reg) {
  $('#kv-acquisto').innerHTML = data.acquisto.map((a) => `<dt>${esc(a.voce)}</dt><dd>${eur(a.importo)}</dd>`).join('')
    + `<dt class="tot">Capitale proprio</dt><dd class="tot">${eur(k.cap)}</dd>`
    + `<dt class="muted">di cui costi di transazione (non recuperabili con la vendita)</dt><dd class="muted">${eur(k.trans)}</dd>`;
  const m = data.mutuo;
  const piano = [...reg.piano.values()];
  const interessiTot = piano.reduce((s, r) => s + r.interessi, 0);
  const pagate = piano.filter((r, i) => monthDiff([...reg.piano.keys()][i], fineAnalisi()) >= 0).length;
  $('#mutuo-sub').textContent = `${m.banca} n. ${m.numero}`;
  $('#kv-mutuo').innerHTML = [
    ['Importo', eur(m.importo)], ['TAN fisso / TAEG', `${pct(m.tan, 2)} / ${pct(m.taeg, 2)}`], ['Durata', `${m.anni} anni · ${m.anni * 12} rate`],
    ['Rata (capitale + interessi)', eur(m.rata, 2)], ['Spese incasso rata', eur(m.spese_incasso, 2)], ['Addebito mensile', eur(m.rata + m.spese_incasso, 2)],
    ['Prima rata', `${new Date(m.prima_rata).toLocaleDateString('it-IT')} · ${eur(m.rata + m.spese_incasso + m.preammortamento, 2)}`],
    ['Rate pagate', `${pagate} / ${m.anni * 12}`], ['Debito residuo', eur(k.debito)], ['Interessi totali (30 anni)', eur(interessiTot)],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('') + (m.note ? `<dt class="muted" style="grid-column:1/-1;font-size:12px">${esc(m.note)}</dt>` : '');
}

// ---------- REGISTRO ----------
function renderRegistro() {
  // Incassi
  const inc = data.incassi.slice().sort((a, b) => b.mese.localeCompare(a.mese));
  $('#t-incassi').innerHTML = inc.length ? `<thead><tr><th>Mese</th><th>Stato</th><th class="n">Lordo</th><th class="n">Portali</th><th class="n">Fee PM</th><th class="n">Netto PM</th><th class="n">Notti</th><th class="n">Ritenuta</th><th class="n">Bonifico</th><th>Fonte</th><th>Allegati</th><th></th></tr></thead><tbody>${inc.map((x) => {
    const fee = x.fee_pm != null && x.fee_pm !== '' ? Number(x.fee_pm) : feePM(data, x.lordo, x.commissioni);
    const netto = x.lordo - x.commissioni - fee;
    const diff = x.bonifico != null && x.bonifico !== '' ? Number(x.bonifico) - netto : null;
    return `<tr><td>${monthLabel(x.mese, true)}</td><td><span class="badge ${x.stato === 'definitivo' ? 'ok' : 'warn'}">${esc(x.stato || 'definitivo')}</span></td>
      <td class="n">${eur(x.lordo, 2)}</td><td class="n">${eur(x.commissioni, 2)}</td><td class="n">${eur(fee, 2)}${x.fee_pm == null || x.fee_pm === '' ? '<span class="est" title="calcolata">ᶜ</span>' : ''}</td>
      <td class="n">${eur(netto, 2)}</td><td class="n">${x.notti ?? '—'}</td><td class="n">${eur(x.ritenuta || 0, 2)}</td>
      <td class="n">${x.bonifico != null && x.bonifico !== '' ? eur(x.bonifico, 2) + (Math.abs(diff) > 1 ? ` <span class="badge warn" title="differenza vs netto atteso">${eurS(diff, 2)}</span>` : ' <span class="badge ok">✓</span>') : '—'}</td>
      <td>${esc(x.fonte || 'manuale')}${x.dettaglio?.length ? ` · ${x.dettaglio.length} pren.` : ''}</td>
      <td>${allegatiLinks(x.allegati)}</td>
      <td style="white-space:nowrap"><button class="btn small ghost" data-edit-inc="${x.mese}">Modifica</button><button class="btn small ghost danger" data-del-inc="${x.mese}">Elimina</button></td></tr>`
      + (x.nota ? `<tr><td></td><td colspan="11" class="muted" style="font-size:12px;border-top:0">${esc(x.nota)}</td></tr>` : '');
  }).join('')}</tbody>` : '<tbody><tr><td class="empty">Nessun incasso registrato.</td></tr></tbody>';
  $$('[data-edit-inc]').forEach((b) => b.onclick = () => fillIncasso(data.incassi.find((x) => x.mese === b.dataset.editInc)));
  $$('[data-del-inc]').forEach((b) => b.onclick = async () => {
    if (!confirm(`Eliminare l'incasso di ${monthLabel(b.dataset.delInc, true)}?`)) return;
    data.incassi = data.incassi.filter((x) => x.mese !== b.dataset.delInc);
    await persist(`Elimina incasso ${b.dataset.delInc}`);
  });
  $('#f-incasso input[name=fee_pm]').placeholder = `auto ${nf0.format(data.pm.fee * 100)}%`;

  // Spese
  $('#sel-cat').innerHTML = Object.entries(CATEGORIE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const sp = data.spese.slice().sort((a, b) => b.data.localeCompare(a.data));
  $('#t-spese').innerHTML = sp.length ? `<thead><tr><th>Data</th><th>Categoria</th><th>Descrizione</th><th>Competenza</th><th class="n">Importo</th><th>Allegati</th><th></th></tr></thead><tbody>${sp.map((s) => `
    <tr><td>${new Date(s.data).toLocaleDateString('it-IT')}</td><td>${esc(CATEGORIE[s.categoria] || s.categoria)}</td><td>${esc(s.descrizione || '')}</td>
    <td>${s.competenza_dal ? `${monthLabel(s.competenza_dal)}${s.competenza_al && s.competenza_al !== s.competenza_dal ? ` → ${monthLabel(s.competenza_al)}` : ''}` : monthLabel(s.data.slice(0, 7))}</td>
    <td class="n">${eur(s.importo, 2)}</td><td>${allegatiLinks(s.allegati)}</td>
    <td style="white-space:nowrap"><button class="btn small ghost" data-edit-sp="${s.id}">Modifica</button><button class="btn small ghost danger" data-del-sp="${s.id}">Elimina</button></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">Nessuna spesa registrata. Polizza e internet sono già conteggiati automaticamente dal budget.</td></tr></tbody>';
  $$('[data-edit-sp]').forEach((b) => b.onclick = () => fillSpesa(data.spese.find((x) => x.id === b.dataset.editSp)));
  $$('[data-del-sp]').forEach((b) => b.onclick = async () => {
    if (!confirm('Eliminare questa spesa?')) return;
    data.spese = data.spese.filter((x) => x.id !== b.dataset.delSp);
    await persist('Elimina spesa');
  });

  // Valutazioni
  const vv = (data.valutazioni || []).slice().sort((a, b) => b.data.localeCompare(a.data));
  $('#t-valutazioni').innerHTML = vv.length ? `<thead><tr><th>Data</th><th class="n">Valore</th><th>Fonte</th><th></th></tr></thead><tbody>${vv.map((v, i) => `<tr><td>${new Date(v.data).toLocaleDateString('it-IT')}</td><td class="n">${eur(v.valore)}</td><td>${esc(v.fonte || '')}</td><td><button class="btn small ghost danger" data-del-val="${i}">Elimina</button></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">Nessuna stima. Con "Ultima stima" in Panoramica verrà usata la più recente.</td></tr></tbody>';
  $$('[data-del-val]').forEach((b) => b.onclick = async () => { const v = vv[Number(b.dataset.delVal)]; data.valutazioni = data.valutazioni.filter((x) => x !== v); await persist('Elimina stima di valore'); });

  seg($('#seg-attr'), ui.attr, (v) => { ui.attr = v; saveUI(); renderRegistro(); if (lastXlsx) previewXlsx(lastXlsx.rows, lastXlsx.file); });
}

function allegatiLinks(list) {
  if (!list?.length) return '<span class="muted">—</span>';
  return list.map((p) => `<a href="#" data-open="${esc(p)}" title="${esc(p)}">${esc(p.split('/').pop().replace(/^\d+-/, '').slice(0, 22))}</a>`).join('<br>');
}
document.addEventListener('click', async (e) => {
  const a = e.target.closest('[data-open]'); if (!a) return;
  e.preventDefault();
  try { const url = await store.open(a.dataset.open); window.open(url, '_blank', 'noopener'); } catch (err) { toast(err.message, true); }
});

async function uploadFile(file, folder) {
  if (!file || !file.size) return null;
  const safe = file.name.replace(/[^\w.\- ]+/g, '_');
  return store.upload(`allegati/${folder}/${Date.now()}-${safe}`, file);
}

function fillIncasso(x) {
  const f = $('#f-incasso');
  f.mese.value = x.mese; f.lordo.value = x.lordo; f.commissioni.value = x.commissioni ?? 0; f.fee_pm.value = x.fee_pm ?? '';
  f.notti.value = x.notti ?? ''; f.prenotazioni.value = x.prenotazioni ?? ''; f.ritenuta.value = x.ritenuta ?? 0;
  f.bonifico.value = x.bonifico ?? ''; f.stato.value = x.stato || 'definitivo'; f.nota.value = x.nota || '';
  $('#inc-form-title').textContent = `Modifica ${monthLabel(x.mese, true)}`;
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#f-incasso').addEventListener('reset', () => { $('#inc-form-title').textContent = 'Inserimento manuale'; });
$('#f-incasso').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f);
  const mese = fd.get('mese');
  const num = (k) => (fd.get(k) === '' || fd.get(k) == null ? null : Number(fd.get(k)));
  const prev = data.incassi.find((x) => x.mese === mese);
  try {
    const path = await uploadFile(fd.get('file'), mese);
    const rec = {
      ...(prev || {}), mese, lordo: num('lordo') || 0, commissioni: num('commissioni') || 0, fee_pm: num('fee_pm'),
      notti: num('notti'), prenotazioni: num('prenotazioni'), ritenuta: num('ritenuta') || 0, bonifico: num('bonifico'),
      stato: fd.get('stato'), nota: fd.get('nota'), fonte: prev?.fonte === 'excel' ? 'excel + manuale' : (prev?.fonte || 'manuale'),
      allegati: [...(prev?.allegati || []), ...(path ? [path] : [])],
    };
    data.incassi = data.incassi.filter((x) => x.mese !== mese).concat(rec);
    await persist(`Incasso ${mese}`);
    f.reset();
  } catch (err) { if (err?.message) toast(err.message, true); }
});

function fillSpesa(s) {
  const f = $('#f-spesa');
  f.data.value = s.data; f.categoria.value = s.categoria; f.importo.value = s.importo;
  f.competenza_dal.value = s.competenza_dal || ''; f.competenza_al.value = s.competenza_al || ''; f.descrizione.value = s.descrizione || '';
  f.dataset.id = s.id;
  $('#sp-form-title').textContent = 'Modifica spesa';
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#f-spesa').addEventListener('reset', (e) => { delete e.target.dataset.id; $('#sp-form-title').textContent = 'Nuova spesa'; });
$('#f-spesa').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f);
  const id = f.dataset.id || `s${Date.now().toString(36)}`;
  const prev = data.spese.find((x) => x.id === id);
  let dal = fd.get('competenza_dal') || fd.get('data').slice(0, 7);
  let al = fd.get('competenza_al') || dal;
  if (monthDiff(dal, al) < 0) [dal, al] = [al, dal];
  try {
    const path = await uploadFile(fd.get('file'), `spese/${dal}`);
    const rec = { ...(prev || {}), id, data: fd.get('data'), categoria: fd.get('categoria'), importo: Number(fd.get('importo')),
      competenza_dal: dal, competenza_al: al, descrizione: fd.get('descrizione'), allegati: [...(prev?.allegati || []), ...(path ? [path] : [])] };
    data.spese = data.spese.filter((x) => x.id !== id).concat(rec);
    await persist(`Spesa ${CATEGORIE[rec.categoria]} ${eur(rec.importo, 2)}`);
    f.reset();
  } catch (err) { if (err?.message) toast(err.message, true); }
});

$('#f-valutazione').addEventListener('submit', async (e) => {
  e.preventDefault(); const fd = new FormData(e.target);
  data.valutazioni.push({ data: fd.get('data'), valore: Number(fd.get('valore')), fonte: fd.get('fonte') });
  await persist('Nuova stima di valore'); e.target.reset();
});

// ---------- Import Excel PM ----------
let lastXlsx = null;
const drop = $('#drop-xlsx');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) readXlsx(f); });
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-xlsx').click(); } });
$('#file-xlsx').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) readXlsx(f); e.target.value = ''; });

function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000));
  const m = String(v).match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d;
}
const toNum = (v) => (v == null || v === '' ? 0 : typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.')) || 0);
const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function readXlsx(file) {
  if (!window.XLSX) { toast('Libreria Excel non ancora caricata, riprova tra un attimo.', true); return; }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    lastXlsx = { rows, file };
    previewXlsx(rows, file);
  } catch (e) { toast(`File non leggibile: ${e.message}`, true); }
}

function parseBookings(rows) {
  const hi = rows.findIndex((r) => r.some((c) => /check.?in/i.test(String(c ?? ''))));
  if (hi < 0) throw new Error('Non trovo la colonna "Check in": è l\'export prenotazioni del PM?');
  const H = rows[hi].map((c) => String(c ?? '').trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = H.findIndex((h) => h === n); if (i >= 0) return i; } for (const n of names) { const i = H.findIndex((h) => h.includes(n)); if (i >= 0) return i; } return -1; };
  const c = {
    numero: col('numero', 'id'), ci: col('check in', 'check-in', 'arrivo'), co: col('check-out', 'check out', 'partenza'), notti: col('notti'),
    canale: col('canale'), stato: col('stato'), addebiti: col('addebiti'), soggiorno: col('addebito soggiorno'),
    tassa: col('addebito tassa di soggiorno', 'tassa di soggiorno'), comm: col('commissioni'), commTr: col('commissioni trattenute'),
  };
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    const ci = parseDate(r[c.ci]); if (!ci) continue;
    const stato = String(r[c.stato] ?? '');
    if (/cancell|annull|no.?show/i.test(stato)) continue;
    const co = parseDate(r[c.co]) || ci;
    const tassa = c.tassa >= 0 ? toNum(r[c.tassa]) : 0;
    const lordo = c.addebiti >= 0 && r[c.addebiti] != null ? toNum(r[c.addebiti]) - tassa : toNum(r[c.soggiorno]);
    const comm = (c.comm >= 0 && c.comm !== c.commTr ? toNum(r[c.comm]) : 0) + (c.commTr >= 0 ? toNum(r[c.commTr]) : 0);
    out.push({ numero: String(r[c.numero] ?? ''), check_in: isoDate(ci), check_out: isoDate(co), notti: toNum(r[c.notti]) || Math.round((co - ci) / 864e5),
      canale: String(r[c.canale] ?? ''), lordo: Math.round(lordo * 100) / 100, commissioni: Math.round(comm * 100) / 100, tassa_soggiorno: tassa });
  }
  return out;
}

function previewXlsx(rows, file) {
  let book;
  try { book = parseBookings(rows); } catch (e) { $('#xlsx-preview').innerHTML = `<div class="note bad" style="margin-top:10px">${esc(e.message)}</div>`; return; }
  const groups = {};
  for (const b of book) { const m = (ui.attr === 'check_out' ? b.check_out : b.check_in).slice(0, 7); (groups[m] ??= []).push(b); }
  const mesi = Object.keys(groups).sort().reverse();
  const inizio = data.immobile.inizio_gestione;
  $('#xlsx-preview').innerHTML = `<p class="ink2" style="font-size:13px;margin:12px 0 6px">${book.length} prenotazioni lette da <strong>${esc(file.name)}</strong>. Seleziona i mesi da importare (quelli precedenti alla gestione sono esclusi).</p>
  <div class="table-wrap"><table><thead><tr><th></th><th>Mese</th><th class="n">Pren.</th><th class="n">Notti</th><th class="n">Lordo</th><th class="n">Portali</th><th class="n">Fee PM</th><th class="n">Netto</th><th></th></tr></thead><tbody>
  ${mesi.map((m) => {
    const g = groups[m]; const L = g.reduce((s, b) => s + b.lordo, 0); const C = g.reduce((s, b) => s + b.commissioni, 0); const F = feePM(data, L, C);
    const ok = monthDiff(inizio, m) >= 0; const ex = data.incassi.find((x) => x.mese === m);
    return `<tr><td><input type="checkbox" data-m="${m}" ${ok ? 'checked' : 'disabled'}></td><td>${monthLabel(m, true)}</td><td class="n">${g.length}</td><td class="n">${g.reduce((s, b) => s + b.notti, 0)}</td>
      <td class="n">${eur(L, 2)}</td><td class="n">${eur(C, 2)}</td><td class="n">${eur(F, 2)}</td><td class="n">${eur(L - C - F, 2)}</td>
      <td>${!ok ? '<span class="badge">prima del rogito</span>' : ex ? `<span class="badge warn">sostituisce ${esc(ex.stato || '')}</span>` : '<span class="badge ok">nuovo</span>'}</td></tr>`;
  }).join('')}</tbody></table></div>
  <div class="actions"><button class="btn primary" id="xlsx-go">Importa mesi selezionati</button><button class="btn ghost" id="xlsx-cancel">Annulla</button></div>`;
  $('#xlsx-cancel').onclick = () => { $('#xlsx-preview').innerHTML = ''; lastXlsx = null; };
  $('#xlsx-go').onclick = async () => {
    const sel = $$('#xlsx-preview input[data-m]:checked').map((i) => i.dataset.m);
    if (!sel.length) return toast('Nessun mese selezionato', true);
    const defs = sel.filter((m) => data.incassi.find((x) => x.mese === m && x.stato === 'definitivo'));
    if (defs.length && !confirm(`Questi mesi sono già "definitivi" e verranno aggiornati con i dati dell'Excel: ${defs.join(', ')}. Continuare?`)) return;
    try {
      const path = await uploadFile(file, `import/${today()}`);
      for (const m of sel) {
        const g = groups[m]; const prev = data.incassi.find((x) => x.mese === m);
        const rec = { ...(prev || { ritenuta: 0, bonifico: null, fee_pm: null, nota: '' }), mese: m, fonte: 'excel', stato: prev?.stato === 'definitivo' ? 'definitivo' : 'provvisorio',
          lordo: Math.round(g.reduce((s, b) => s + b.lordo, 0) * 100) / 100, commissioni: Math.round(g.reduce((s, b) => s + b.commissioni, 0) * 100) / 100,
          notti: g.reduce((s, b) => s + b.notti, 0), prenotazioni: g.length, dettaglio: g,
          allegati: [...new Set([...(prev?.allegati || []), ...(path ? [path] : [])])] };
        data.incassi = data.incassi.filter((x) => x.mese !== m).concat(rec);
      }
      await persist(`Import Excel PM: ${sel.join(', ')}`);
      $('#xlsx-preview').innerHTML = `<div class="note" style="margin-top:10px">Importat${sel.length === 1 ? 'o 1 mese' : `i ${sel.length} mesi`}. Quando arriva l'estratto conto ufficiale, apri il mese con "Modifica" per inserire fee, ritenuta e bonifico e segnarlo come definitivo.</div>`;
      lastXlsx = null;
    } catch (err) { if (err?.message) toast(err.message, true); }
  };
}

// ---------- SIMULATORE ----------
const SIM_FIELDS = [
  ['notti', 'Notti vendute / anno', 0, 365, 1, (v) => `${pct(v / 365, 0)} occupazione`],
  ['adr', 'Prezzo medio a notte (ADR, €)', 40, 350, 1, null],
  ['commPct', 'Commissioni portali (% del lordo)', 0, 25, 0.1, null],
  ['feePct', 'Fee property manager (%)', 0, 45, 0.5, null],
  ['cedPct', 'Cedolare secca (%)', 0, 30, 1, null],
  ['costiAnnui', 'Costi fissi annui (€)', 0, 10000, 10, null],
  ['crescitaRicavi', 'Crescita ricavi annua (%)', -5, 8, 0.5, null, true],
  ['inflazione', 'Inflazione costi annua (%)', 0, 6, 0.5, null, true],
  ['rivalutazione', 'Rivalutazione immobile annua (%)', -3, 6, 0.1, null, true],
  ['extraAnnuo', 'Rimborso anticipato mutuo (€/anno)', 0, 20000, 500, null],
  ['anni', 'Orizzonte (anni)', 1, 30, 1, null],
];

function renderSimulatore() {
  const P = presets(data);
  $('#seg-preset').innerHTML = Object.entries(P).map(([k, v]) => `<button data-v="${k}" aria-pressed="${ui.sim.preset === k}">${v.label}</button>`).join('');
  seg($('#seg-preset'), ui.sim.preset, (k) => {
    const pr = P[k]; Object.assign(ui.sim, { preset: k, notti: pr.notti, adr: pr.adr, commPct: pr.commPct }); saveUI(); renderSimulatore();
  });
  $('#preset-reale').onclick = () => {
    const reg = registro(data, fineAnalisi(), { stime: true });
    const R = reg.righe.filter((r) => r.inc).slice(-12);
    if (!R.length) return toast('Nessun incasso reale registrato', true);
    const w = stagionalita(data.storico);
    const quota = R.reduce((s, r) => s + w[Number(r.mese.slice(5, 7)) - 1], 0);
    const notti = R.reduce((s, r) => s + r.notti, 0); const L = R.reduce((s, r) => s + r.lordo, 0); const C = R.reduce((s, r) => s + r.comm, 0);
    Object.assign(ui.sim, { preset: 'reale', notti: Math.round(notti / quota), adr: Math.round(L / (notti || 1)), commPct: Math.round(C / L * 1000) / 10 });
    saveUI(); renderSimulatore();
    if (R.length < 12) toast(`Annualizzato da ${R.length} ${R.length === 1 ? 'mese' : 'mesi'} con la stagionalità storica: prendilo come indicazione`);
  };

  const s = ui.sim;
  $('#sim-inputs').innerHTML = `<h2>Parametri</h2>` + SIM_FIELDS.map(([key, label, min, max, step, hint, isPct]) => {
    const v = isPct ? Math.round(s[key] * 1000) / 10 : s[key];
    return `<div class="sl"><span class="l"><span>${label}</span><small id="h-${key}">${hint ? hint(s[key]) : ''}</small></span>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${key}" ${isPct ? 'data-pct' : ''} aria-label="${label}">
      <input type="number" min="${min}" max="${max}" step="${step}" value="${v}" data-k="${key}" ${isPct ? 'data-pct' : ''} aria-label="${label}"></div>`;
  }).join('') + `
    <label class="f">Base cedolare<select id="sim-cedbase"><option value="lordo">lordo pagato dall'ospite</option><option value="netto_portali">netto commissioni portali</option></select></label>
    <details class="box"><summary>Dettaglio costi fissi dal budget</summary><dl class="kv" style="font-size:13px">${data.budget.map((b) => `<dt>${esc(b.voce)}${b.certo ? '' : ' <span class="badge">stima</span>'}</dt><dd>${eur(b.annuo)}</dd>`).join('')}<dt class="tot">Totale</dt><dd class="tot">${eur(costiAnnuiBudget())}</dd></dl>
      <button class="btn small" type="button" id="sim-costi-reset" style="margin-top:8px">Usa il totale del budget</button></details>
    <div class="actions"><button class="btn primary" id="sim-save" type="button">Usa questo scenario in Panoramica</button><button class="btn ghost" id="sim-reset" type="button">Ripristina</button></div>`;
  $('#sim-cedbase').value = s.cedBase;
  $('#sim-cedbase').onchange = (e) => { s.cedBase = e.target.value; s.preset = s.preset; saveUI(); updateSim(); };
  $$('#sim-inputs input[data-k]').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.k; let v = Number(inp.value); if (Number.isNaN(v)) return;
    $$(`#sim-inputs input[data-k="${k}"]`).forEach((o) => { if (o !== inp) o.value = inp.value; });
    if (inp.hasAttribute('data-pct')) v /= 100;
    s[k] = v; if (['notti', 'adr', 'commPct'].includes(k)) { s.preset = 'custom'; $$('#seg-preset button').forEach((b) => b.setAttribute('aria-pressed', 'false')); }
    const f = SIM_FIELDS.find((x) => x[0] === k); if (f[5]) $(`#h-${k}`).textContent = f[5](v);
    saveUI(); updateSim();
  }));
  $('#sim-costi-reset').onclick = () => { s.costiAnnui = costiAnnuiBudget(); saveUI(); renderSimulatore(); };
  $('#sim-reset').onclick = () => { ui.sim = defaultSim(); saveUI(); renderSimulatore(); };
  $('#sim-save').onclick = async () => { data.simulatore.params = { ...ui.sim }; await persist('Scenario di riferimento aggiornato'); };
  updateSim();
}

function runScenario(p) {
  return simula(data, p, { mese: data.immobile.inizio_gestione, debito: data.mutuo.importo, cfCum: 0, valore: data.immobile.prezzo });
}

function updateSim() {
  const p = simParams();
  const sim = runScenario({ ...p, anni: 30 });
  const view = sim.slice(0, p.anni * 12);
  const y1 = sim.slice(0, 12);
  const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
  const cap = capitaleProprio(data);
  const lordoY1 = sum(y1, (r) => r.lordo); const noiY1 = sum(y1, (r) => r.noi); const cfY1 = sum(y1, (r) => r.cf);
  const bc = sim.find((r) => r.cfCum >= cap)?.mese; const bp = sim.find((r) => r.posizione >= 0)?.mese;
  // fatturato lordo di pareggio (anno 1): CF = L*k - fissi
  const kf = (1 - p.commPct / 100) * (1 - p.feePct / 100) - (p.cedBase === 'netto_portali' ? (1 - p.commPct / 100) : 1) * p.cedPct / 100;
  const servizio = (data.mutuo.rata + data.mutuo.spese_incasso) * 12;
  const Lbe = (p.costiAnnui + servizio) / kf;
  const when = (m) => (m ? `${monthLabel(m, true)} · ${Math.ceil((monthDiff(data.immobile.inizio_gestione, m) + 1) / 12)}° anno` : 'oltre 30 anni');
  const tiles = [
    ['Cash flow medio mensile (anno 1)', eurS(cfY1 / 12), `annuo ${eurS(cfY1)}`, cls(cfY1)],
    ['Rendimento netto su prezzo', pct(noiY1 / data.immobile.prezzo), `cash-on-cash ${pct(cfY1 / cap)}`, cls(noiY1)],
    ['Breakeven di cassa', bc ? monthLabel(bc, true) : 'oltre 30 anni', bc ? when(bc) : 'il CF cumulato non recupera il capitale', ''],
    ['Breakeven patrimoniale', bp ? monthLabel(bp, true) : 'oltre 30 anni', bp ? when(bp) : 'con questi parametri', ''],
  ];
  $('#sim-kpi').innerHTML = tiles.map(([l, v, s2, c]) => `<div class="card tile"><div class="t-label">${l}</div><div class="t-value ${c}">${v}</div><div class="t-sub">${s2}</div></div>`).join('')
    + `<div class="card tile" style="grid-column:1/-1"><div class="t-label">Lordo annuo per avere cash flow zero</div><div class="t-value">${eur(Lbe)}</div>
       <div class="t-sub">≈ ${nf0.format(Lbe / p.adr)} notti a ${eur(p.adr)} · scenario attuale: ${eur(lordoY1)} lordi (${lordoY1 >= Lbe ? '<span class="pos">sopra</span>' : '<span class="neg">sotto</span>'} la soglia di ${eur(Math.abs(lordoY1 - Lbe))})</div></div>`;

  // Confronti con storico
  const P = presets(data);
  const cmpColors = { 2024: css('--s3'), 2025: css('--s4'), 2026: css('--s5'), media: css('--s7') };
  $('#cmp-chips').innerHTML = '<span class="lbl">Confronta con</span>' + Object.entries(P).map(([k, v]) => `<label class="chip ${ui.cmp[k] ? '' : 'off'}" style="color:${cmpColors[k]}"><input type="checkbox" data-c="${k}" ${ui.cmp[k] ? 'checked' : ''}><span class="sw"></span><span style="color:var(--ink-2)">${v.label}</span></label>`).join('');
  $$('#cmp-chips input').forEach((i) => i.addEventListener('change', () => { ui.cmp[i.dataset.c] = i.checked; saveUI(); updateSim(); }));
  const s1 = css('--s1'); const s2c = css('--s2');
  const ds = [
    { label: 'Posizione netta', data: view.map((r) => Math.round(r.posizione)), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 0, tension: 0.2 },
    { label: 'Cash flow cumulato', data: view.map((r) => Math.round(r.cfCum)), borderColor: s2c, backgroundColor: s2c, borderWidth: 2, pointRadius: 0, tension: 0.2 },
  ];
  const leg = [[s1, 'Posizione netta'], [s2c, 'Cash flow cumulato']];
  for (const [k, on] of Object.entries(ui.cmp)) {
    if (!on || !P[k]) continue;
    const alt = runScenario({ ...p, notti: P[k].notti, adr: P[k].adr, commPct: P[k].commPct, anni: p.anni });
    ds.push({ label: `Posizione netta · ${P[k].label}`, data: alt.map((r) => Math.round(r.posizione)), borderColor: cmpColors[k], backgroundColor: cmpColors[k], borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.2 });
    leg.push([cmpColors[k], `Posizione netta · ${P[k].label}`, true]);
  }
  chart('c-sim', {
    type: 'line', data: { labels: view.map((r) => monthLabel(r.mese)), datasets: ds },
    options: baseOptions({ scales: { ...baseOptions().scales, x: { ...baseOptions().scales.x, ticks: { ...baseOptions().scales.x.ticks, maxTicksLimit: 10 } },
      y: { ...baseOptions().scales.y, grid: { color: (c) => (c.tick.value === 0 ? css('--axis') : css('--grid')), lineWidth: (c) => (c.tick.value === 0 ? 1.5 : 1) } } } }),
  });
  $('#sim-legend').innerHTML = legendHTML(leg);

  const anni = sintesiAnnua(view);
  $('#t-sim').innerHTML = `<thead><tr><th>Anno</th><th class="n">Lordo</th><th class="n">Reddito netto</th><th class="n">Cash flow</th><th class="n">CF cumulato</th><th class="n">Debito</th><th class="n">Valore</th><th class="n">Posizione netta</th></tr></thead><tbody>${anni.map((a) => `
    <tr><td style="white-space:nowrap">${a.anno} <small>(${monthLabel(a.mese)})</small></td><td class="n">${eur(a.lordo)}</td><td class="n">${eur(a.noi)}</td><td class="n ${cls(a.cf)}">${eurS(a.cf)}</td><td class="n ${cls(a.cfCum)}">${eurS(a.cfCum)}</td><td class="n">${eur(a.debito)}</td><td class="n">${eur(a.valore)}</td><td class="n ${cls(a.posizione)}"><strong>${eurS(a.posizione)}</strong></td></tr>`).join('')}</tbody>`;
}

// ---------- MERCATO ----------
function renderMercato() {
  const mk = data.mercato;
  $('#mk-link').href = mk.url;
  const mens = mk.mensile.slice().sort((a, b) => a[0].localeCompare(b[0]));
  const last = mens[mens.length - 1];
  const yearAgo = mens.find((x) => x[0] === addMonths(last[0], -12));
  const ref = mens.find((x) => x[0] === mk.riferimento_rogito);
  const an = mk.annuale; const cagr = Math.pow(an[an.length - 1][1] / an[0][1], 1 / (an[an.length - 1][0] - an[0][0])) - 1;
  const eurmq = Math.round(data.immobile.prezzo / data.immobile.superficie_mq);
  const tiles = [
    ['Ortigia oggi', `${nf0.format(last[1])} €/m²`, `${monthLabel(last[0], true)}${yearAgo ? ` · ${pct(last[1] / yearAgo[1] - 1)} su 12 mesi` : ''}`],
    ['Dal rogito', ref ? pct(last[1] / ref[1] - 1) : '—', ref ? `indice ${monthLabel(ref[0], true)}: ${nf0.format(ref[1])} €/m²` : ''],
    ['Valore indicizzato', eur(valoreImmobile(data, last[0], 'mercato')), `prezzo pagato ${eur(data.immobile.prezzo)}`],
    ['Crescita storica', pct(cagr), `annua composta ${an[0][0]}–${an[an.length - 1][0]} · tu: ${nf0.format(eurmq)} €/m²`],
  ];
  $('#mk-kpi').innerHTML = tiles.map(([l, v, s]) => `<div class="card tile"><div class="t-label">${l}</div><div class="t-value">${v}</div><div class="t-sub">${s}</div></div>`).join('');
  const s1 = css('--s1');
  const opt = baseOptions({ plugins: { ...baseOptions().plugins, tooltip: { ...baseOptions().plugins.tooltip, callbacks: { label: (c) => ` ${nf0.format(c.raw)} €/m²` } } } });
  chart('c-mk-anni', { type: 'line', data: { labels: an.map((x) => x[0]), datasets: [{ label: '€/m²', data: an.map((x) => x[1]), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 3, tension: 0.2 }] }, options: opt });
  chart('c-mk-mesi', { type: 'line', data: { labels: mens.map((x) => monthLabel(x[0])), datasets: [{ label: '€/m²', data: mens.map((x) => x[1]), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 3, tension: 0.2 }] },
    options: { ...opt, scales: { ...opt.scales, y: { ...opt.scales.y, beginAtZero: false } } } });
}
$('#f-mercato').addEventListener('submit', async (e) => {
  e.preventDefault(); const fd = new FormData(e.target);
  const m = fd.get('mese'); const v = Number(fd.get('eur'));
  data.mercato.mensile = data.mercato.mensile.filter((x) => x[0] !== m).concat([[m, v]]).sort((a, b) => a[0].localeCompare(b[0]));
  if (m.endsWith('-07')) { const y = Number(m.slice(0, 4)); data.mercato.annuale = data.mercato.annuale.filter((x) => x[0] !== y).concat([[y, v]]).sort((a, b) => a[0] - b[0]); }
  await persist(`Indice Idealista ${m}`); e.target.reset();
});

// ---------- GETQUIN ----------
function gqSerie() {
  const reg = registro(data, fineAnalisi(), { stime: ui.stime });
  let cum = 0;
  return reg.righe.map((r) => { cum += r.cf; const v = valoreImmobile(data, r.mese, ui.valore); return { mese: r.mese, valore: v, debito: r.debito, equity: v - r.debito, cf: r.cf, cfCum: cum }; });
}
function renderGetquin() {
  const S = gqSerie(); const last = S[S.length - 1];
  const cap = capitaleProprio(data);
  const tiles = [
    ['Valore da inserire (patrimonio netto)', eur(last.equity), `${eur(last.valore)} − debito ${eur(last.debito)}`],
    ['Costo di carico (capitale proprio)', eur(cap), 'da inserire una sola volta come prezzo d\'acquisto'],
    [`Cash flow di ${monthLabel(last.mese, true)}`, eurS(last.cf, 2), `cumulato ${eurS(last.cfCum, 2)}`],
  ];
  $('#gq-kpi').innerHTML = tiles.map(([l, v, s]) => `<div class="card tile"><div class="t-label">${l}</div><div class="t-value">${v}</div><div class="t-sub">${s}</div></div>`).join('');
  $('#t-gq').innerHTML = `<thead><tr><th>Mese</th><th class="n">Valore</th><th class="n">Debito</th><th class="n">Patrimonio netto</th><th class="n">CF mese</th></tr></thead><tbody>${S.slice().reverse().map((r) => `<tr><td>${monthLabel(r.mese, true)}</td><td class="n">${eur(r.valore)}</td><td class="n">${eur(r.debito)}</td><td class="n"><strong>${eur(r.equity)}</strong></td><td class="n ${cls(r.cf)}">${eurS(r.cf, 2)}</td></tr>`).join('')}</tbody>`;
  $('#gq-copy').onclick = async () => {
    const txt = `Ortigia ${monthLabel(last.mese, true)}\nValore netto: ${nf2.format(last.equity)}\nValore immobile: ${nf2.format(last.valore)}\nDebito residuo: ${nf2.format(last.debito)}\nCash flow mese: ${nf2.format(last.cf)}\nCosto di carico: ${nf2.format(cap)}`;
    try { await navigator.clipboard.writeText(txt); toast('Valori copiati'); } catch { prompt('Copia i valori:', txt); }
  };
  $('#gq-csv').onclick = () => downloadCSV('ortigia-getquin.csv', [['data', 'valore_immobile', 'debito_residuo', 'patrimonio_netto', 'cash_flow_mese', 'cash_flow_cumulato'],
    ...S.map((r) => [`${r.mese}-28`, r.valore, r.debito, r.equity, r.cf, r.cfCum].map((v) => (typeof v === 'number' ? v.toFixed(2) : v)))]);
}

function downloadCSV(name, rows) {
  const csv = rows.map((r) => r.map((c) => (/[;"\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(';')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- IMPOSTAZIONI ----------
let settingsMode = null;
function renderSettings() {
  const cfg = getConfig();
  settingsMode ??= cfg.mode || 'local';
  const f = $('#f-src');
  ['owner', 'repo', 'branch', 'path'].forEach((k) => { if (cfg[k]) f[k].value = cfg[k]; });
  f.token.value = cfg.token ? '••••••••' : '';
  const upd = () => { seg($('#seg-mode'), settingsMode, (v) => { settingsMode = v; upd(); }); $('#gh-fields').style.display = settingsMode === 'github' ? '' : 'none'; };
  upd();
  if (!data) { $('#f-param').style.display = 'none'; return; }
  $('#f-param').style.display = '';
  const b = data.budget;
  $('#param-fields').innerHTML = `
    <div class="row">
      <label class="f">Fee PM (%)<input type="number" step="0.5" name="pm_fee" value="${data.pm.fee * 100}"></label>
      <label class="f">Fee PM calcolata su<select name="pm_base"><option value="netto_portali">netto commissioni portali</option><option value="lordo">lordo</option></select></label>
      <label class="f">Cedolare (%)<input type="number" step="1" name="ced" value="${data.fiscale.cedolare * 100}"></label>
      <label class="f">Base cedolare<select name="ced_base"><option value="lordo">lordo pagato dall'ospite</option><option value="netto_portali">netto commissioni portali</option></select></label>
      <label class="f">Rata mutuo (€)<input type="number" step="0.01" name="rata" value="${data.mutuo.rata}"></label>
      <label class="f">Spese incasso rata (€)<input type="number" step="0.01" name="spese_incasso" value="${data.mutuo.spese_incasso}"></label>
      <label class="f">Inizio gestione<input type="month" name="inizio" value="${data.immobile.inizio_gestione}"></label>
    </div>
    <h3 style="margin:18px 0 8px">Budget costi annui</h3>
    <div class="table-wrap"><table><thead><tr><th>Voce</th><th>Categoria</th><th class="n">€ / anno</th><th>Certo</th><th>Dal</th></tr></thead><tbody>
    ${b.map((x, i) => `<tr><td><input name="b_voce_${i}" value="${esc(x.voce)}"></td><td>${esc(CATEGORIE[x.categoria] || x.categoria)}</td><td><input type="number" step="0.01" name="b_annuo_${i}" value="${x.annuo}" style="width:110px;text-align:right"></td>
      <td><input type="checkbox" name="b_certo_${i}" ${x.certo ? 'checked' : ''} aria-label="certo"></td><td><input type="month" name="b_dal_${i}" value="${x.dal || ''}" style="width:150px"></td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted" style="font-size:12px;margin-top:8px">"Certo" = costo fisso conosciuto (polizza, internet): conteggiato sempre. Non certo = stima: si può escludere con "Includi costi stimati". In entrambi i casi, quando registri una bolletta reale per quella categoria, nei mesi coperti vale la bolletta.</p>
    <div class="note" style="margin-top:10px">${esc(data.pm.note)}<br>${esc(data.fiscale.note)}</div>`;
  const fp = $('#f-param'); fp.pm_base.value = data.pm.base; fp.ced_base.value = data.fiscale.base;
}
$('#f-src').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const old = getConfig();
  const cfg = { mode: settingsMode, owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', path: f.path.value.trim() || 'ledger.json',
    token: f.token.value.startsWith('••') ? old.token : f.token.value.trim() };
  if (cfg.mode === 'github' && (!cfg.owner || !cfg.repo || !cfg.token)) return toast('Compila utente, repository e token', true);
  setConfig(cfg); location.reload();
});
$('#f-param').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  data.pm.fee = Number(f.pm_fee.value) / 100; data.pm.base = f.pm_base.value;
  data.fiscale.cedolare = Number(f.ced.value) / 100; data.fiscale.base = f.ced_base.value;
  data.mutuo.rata = Number(f.rata.value); data.mutuo.spese_incasso = Number(f.spese_incasso.value);
  data.immobile.inizio_gestione = f.inizio.value || data.immobile.inizio_gestione;
  data.budget.forEach((x, i) => { x.voce = f[`b_voce_${i}`].value; x.annuo = Number(f[`b_annuo_${i}`].value); x.certo = f[`b_certo_${i}`].checked; x.dal = f[`b_dal_${i}`].value || x.dal; });
  ui.sim.feePct = data.pm.fee * 100; ui.sim.cedPct = data.fiscale.cedolare * 100; ui.sim.cedBase = data.fiscale.base; ui.sim.costiAnnui = costiAnnuiBudget(); saveUI();
  await persist('Parametri aggiornati');
});
$('#exp-json').addEventListener('click', () => {
  if (!data) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `ortigia-ledger-${today()}.json`; a.click();
});
$('#imp-json').addEventListener('change', async (e) => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (!j.immobile || !j.mutuo) throw new Error('Il file non sembra un registro Ortigia.');
    if (data && !confirm('Sostituire i dati attuali con quelli del file?')) return;
    data = j; migrate(); if (!ui.sim) ui.sim = data.simulatore?.params || defaultSim();
    $('#boot')?.remove();
    await persist('Import backup JSON');
    location.reload();
  } catch (err) { toast(err.message, true); }
});

// Avvio quando Chart.js è pronto (script defer)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
