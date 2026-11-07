import {
  confrontoBenchmark, CATEGORIE, NON_COSTI, monthKey, addMonths, monthDiff, monthsBetween, monthLabel, MESI,
  registro, kpi, capitaleProprio, costiTransazione, feePM, presets, simula, sintesiAnnua, stagionalita, valoreImmobile, pmt, commDaQuote, coperturaRata, nettoPrenotazione, nottiTra,
} from './finance.js?v=20261107a';
import { getConfig, setConfig, makeStore } from './store.js?v=20261107a';
import { createInfo } from './info.js?v=20261107a';
import { parseDate, toNum, isoDate, strip, CAMPI, riconosci, leggiResoconto, meseSuggerito, controlla, costruisciRecord } from './importers.js?v=20261107a';

// ---------- Stato ----------
let data = null;
let store = null;
const UI_KEY = 'ortigia.ui.v1';
const ui = Object.assign({
  view: 'panoramica', valore: 'nominale', stime: true, attr: 'check_in',
  refs: { 2024: false, 2025: true, 2026: true }, cmp: {}, theme: 'auto', sim: null, privacy: false,
  cop: { sfas: 1, ced: false, costi: false, iva: false, bacino: true }, range: { pos: '5', sim: '5' },
}, (() => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } })());
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch { /* ignore */ } };
const charts = {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- Formattazione ----------
const nf0 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0, useGrouping: 'always' });
const nf2 = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });
const MASK = '•••• €';
const eurRaw = (x, d = 0) => (x == null || Number.isNaN(x) ? '—' : `${(d ? nf2 : nf0).format(Math.abs(x) < (d ? 0.005 : 0.5) ? 0 : x)} €`);
// In modalità privacy gli importi assoluti diventano "•••• €": restano visibili solo segni e percentuali.
const eur = (x, d = 0) => (ui.privacy && x != null && !Number.isNaN(x) ? MASK : eurRaw(x, d));
// Oscura anche gli importi scritti dentro testi descrittivi (es. "caparra 4.300 €", "782,48 €")
const maskText = (t) => (ui.privacy ? String(t ?? '').replace(/(?<![/\d])\d{1,3}(?:\.\d{3})+(?:,\d+)?|(?<![/\d.,])\d{3,}(?:,\d{2})?(?![/\d])|\d+,\d{2}/g, '••••') : String(t ?? ''));
const eurS = (x, d = 0) => (x > 0.004 ? '+' : x < -0.004 ? '−' : '') + eur(Math.abs(x), d);
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '—' : `${new Intl.NumberFormat('it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }).format(x * 100)}%`);
let info = null; // spiegazioni "?" (inizializzate dopo la definizione dei formattatori)
const cls = (x) => (x > 0.004 ? 'pos' : x < -0.004 ? 'neg' : '');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const STATI_SPESA = { pagata: 'Pagata', da_pagare: 'Da pagare', programmata: 'Programmata' };
const ETICHETTA_DATA = { pagata: 'Data pagamento', da_pagare: 'Da pagare entro', programmata: 'Addebito previsto il' };
/** Le spese inserite prima dell'introduzione dello stato sono tutte pagate. */
const statoSpesa = (s) => (STATI_SPESA[s.stato] ? s.stato : 'pagata');
const currentMonth = () => monthKey(new Date());

info = createInfo({ eur, eurS, pct, nf0, esc, monthLabel });

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
  applyPrivacy();
  if (window.Chart) { Chart.defaults.font.family = getComputedStyle(document.body).fontFamily; Chart.defaults.font.size = 13; }
  store = makeStore();
  setStatus('busy', 'Caricamento…');
  let loadError = null;
  try {
    data = await store.load();
  } catch (e) {
    setStatus('err', 'Errore');
    loadError = e.message;
    data = null;
  }
  $('#boot').remove();
  if (!data) {
    setStatus('err', 'Nessun dato');
    showView('impostazioni');
    $('#v-impostazioni').insertAdjacentHTML('afterbegin', `<div class="note ${loadError ? 'bad' : 'warn'}" style="margin-bottom:14px">${loadError ? `<strong>Collegamento non riuscito.</strong> ${esc(loadError)}` : 'Nessun dato caricato. Collega il repository GitHub privato con il file <code>ledger.json</code>, oppure importa un backup JSON.'}</div>`);
    renderSettings();
    return;
  }
  migrate();
  setStatus(store.offline ? 'busy' : 'ok', store.label());
  if (!ui.sim) ui.sim = data.simulatore?.params || defaultSim();
  renderAll();
  showView(ui.view);
}

function migrate() {
  data.spese ??= []; data.prenotazioni ??= []; data.incassi ??= []; data.valutazioni ??= []; data.budget ??= [];
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
  $('#theme-btn').title = `Tema: ${{ auto: 'automatico', light: 'chiaro', dark: 'scuro' }[ui.theme]}`;
}
function applyPrivacy() {
  document.body.classList.toggle('privacy', ui.privacy);
  const b = $('#privacy-btn');
  b.setAttribute('aria-pressed', String(ui.privacy));
  const lbl = ui.privacy ? 'Mostra importi' : 'Nascondi importi';
  b.setAttribute('aria-label', lbl); b.title = lbl;
  $('.eye-on', b).style.display = ui.privacy ? 'none' : '';
  $('.eye-off', b).style.display = ui.privacy ? '' : 'none';
}
$('#privacy-btn').addEventListener('click', () => {
  ui.privacy = !ui.privacy; saveUI(); applyPrivacy();
  if (data) { renderAll(); if (ridisegnaAnteprima && $('#rep-go')) ridisegnaAnteprima(); requestAnimationFrame(() => ({ panoramica: renderPanoramica, simulatore: updateSim, mercato: renderMercato }[ui.view]?.())); }
});
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
        borderColor: css('--axis'), borderWidth: 1, padding: 12, boxPadding: 6, usePointStyle: true,
        titleFont: { size: 14, weight: '600' }, bodyFont: { size: 14 },
        callbacks: { label: (c) => ` ${c.dataset.label}: ${c.raw == null ? '—' : eur(c.raw)}` },
      },
    },
    scales: {
      x: { grid: { display: false }, border: { color: axis }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 14, font: { size: 13 } } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { size: 13 }, display: !ui.privacy, callback: (v) => nf0.format(v) } },
    },
    ...extra,
  };
}
// ---------- Finestra temporale dei grafici di lungo periodo ----------
const FINESTRE_ANNI = [1, 3, 5, 10];
/** Disegna il selettore (1 anno · 3 anni · … · Tutto) e restituisce quanti mesi mostrare dall'inizio della gestione (Infinity = tutto). */
function renderFinestra(sel, key, anni, fineAnno, rerender) {
  const opts = FINESTRE_ANNI.filter((y) => y < anni);
  let v = String(ui.range?.[key] ?? '5');
  if (v !== 'max' && !opts.includes(Number(v))) v = opts.includes(5) ? '5' : 'max';
  $(sel).innerHTML = [...opts.map((y) => `<button type="button" data-v="${y}">${y} ${y === 1 ? 'anno' : 'anni'}</button>`), `<button type="button" data-v="max">Tutto${fineAnno ? ` · ${fineAnno}` : ''}</button>`].join('');
  seg($(sel), v, (x) => { ui.range = { ...ui.range, [key]: x }; saveUI(); rerender(); });
  return v === 'max' ? Infinity : Number(v) * 12;
}
/** Opzioni del grafico nel tempo: etichette dell'asse adatte alla durata (mesi, trimestri, anni) e tooltip con mese e anno completi. */
function opzioniTempo(mesi) {
  const o = baseOptions();
  const n = mesi.length; const y0 = Number(mesi[0].slice(0, 4));
  const spanAnni = Number(mesi[n - 1].slice(0, 4)) - y0 + 1; const passo = Math.max(1, Math.ceil(spanAnni / 8));
  const mi = (v) => Number(mesi[v]?.slice(5, 7)) - 1;
  if (n <= 24) o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: true, maxTicksLimit: 12 };
  else if (n <= 36) o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: false, callback: (v) => ([0, 3, 6, 9].includes(mi(v)) ? monthLabel(mesi[v]) : '') };
  else if (n <= 72) o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: false, callback: (v) => ([0, 6].includes(mi(v)) ? monthLabel(mesi[v]) : '') };
  else o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: false, callback: (v) => (mi(v) === 0 && (Number(mesi[v].slice(0, 4)) - y0) % passo === 0 ? mesi[v].slice(0, 4) : '') };
  o.plugins.tooltip.filter = (c) => c.raw != null;
  o.plugins.tooltip.callbacks.title = (it) => (mesi[it[0].dataIndex] ? monthLabel(mesi[it[0].dataIndex], true) : '');
  o.scales.y.grid = { color: (c) => (c.tick.value === 0 ? css('--axis') : css('--grid')), lineWidth: (c) => (c.tick.value === 0 ? 1.5 : 1) };
  return o;
}
/** Serie con un solo punto (rombo) in corrispondenza del breakeven. */
const puntoBreakeven = (label, idx, valori, colore) => ({
  type: 'line', label, data: valori.map((v, i) => (i === idx ? Math.round(v) : null)), showLine: false,
  pointStyle: 'rectRot', pointRadius: 7, pointHoverRadius: 9, backgroundColor: colore, borderColor: css('--surface'), borderWidth: 2,
});

/** Colore con trasparenza: i colori dei grafici arrivano come #rrggbb o rgb(). */
function alpha(c, a) {
  const h = /^#([0-9a-f]{6})$/i.exec(c);
  if (h) { const n = parseInt(h[1], 16); return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`; }
  const r = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
  return r ? `rgba(${r[1]}, ${r[2]}, ${r[3]}, ${a})` : c;
}
const legendHTML = (items) => items.map(([c, l, dashed]) => `<span><i style="background:${dashed ? 'transparent' : c};${dashed ? `border:2px dashed ${c};height:0;width:12px;border-radius:0;vertical-align:3px` : ''}"></i>${esc(l)}</span>`).join('');

// ---------- Simulatore: parametri ----------
function costiAnnuiBudget() { return Math.round(data.budget.reduce((s, b) => s + Number(b.annuo || 0), 0)); }
function defaultSim(presetKey = '2026') {
  const pr = presets(data)[presetKey];
  return {
    preset: presetKey, notti: pr.notti, adr: pr.adr, commPct: pr.commPct, quotaBooking: pr.quotaBooking, quotaAirbnb: pr.quotaAirbnb,
    feePct: Math.round(data.pm.fee * 1000) / 10, cedPct: data.fiscale.cedolare * 100, cedBase: data.fiscale.base,
    costiAnnui: costiAnnuiBudget(), crescitaRicavi: 0.02, inflazione: 0.02, rivalutazione: 0, anni: 15, extraAnnuo: 0,
  };
}
function simParams(src = ui.sim) {
  const p = { ...src, crescitaRicavi: Number(src.crescitaRicavi), inflazione: Number(src.inflazione), rivalutazione: Number(src.rivalutazione) };
  // la commissione media dei portali deriva dal mix dei canali e dalle tariffe di ciascun portale
  if (p.quotaBooking != null && p.quotaAirbnb != null) p.commPct = commDaQuote(data, Number(p.quotaBooking), Number(p.quotaAirbnb));
  return p;
}
function assicuraQuote() {
  if (!ui.sim || ui.sim.quotaBooking != null) return;
  const pr = presets(data)['2026'];
  if (pr?.quotaBooking != null) { ui.sim.quotaBooking = pr.quotaBooking; ui.sim.quotaAirbnb = pr.quotaAirbnb; saveUI(); }
}

// ---------- Render generale ----------
function renderAll() {
  assicuraQuote();
  $('#t-nome').textContent = `${data.immobile.nome}`;
  $('#t-zona').textContent = `${data.immobile.zona} · rogito ${new Date(data.immobile.rogito).toLocaleDateString('it-IT')}`;
  renderPanoramica();
  renderCopertura();
  renderRegistro();
  renderPrenotazioni();
  renderSimulatore();
  renderMercato();
  renderGetquin();
  renderSettings();
  $('#foot').innerHTML = `Dati aggiornati al ${esc(data.aggiornato)} · ${esc(store.label())} · I calcoli fiscali sono stime: verifica con il commercialista.`;
}

function fineAnalisi() {
  // Ultimo mese "chiuso" = quello dell'ultimo incasso registrato. Un mese in corso senza resoconto non conta:
  // le rate ci sarebbero già, ma gli incassi non sono ancora noti e il cash flow risulterebbe falsato.
  const ultimo = data.incassi.map((x) => x.mese).sort().pop();
  return ultimo && monthDiff(data.immobile.inizio_gestione, ultimo) >= 0 ? ultimo : data.immobile.inizio_gestione;
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
  $('#h-cf').innerHTML = ui.privacy
    ? `<span class="${cls(k.cfCum)}">${k.cfCum >= 0 ? '+' : '−'}${pct(Math.abs(k.cfCum / k.cap))}</span> <span class="muted" style="font-size:var(--fs-lg);font-weight:500">del capitale investito</span>`
    : `<span class="${cls(k.cfCum)}">${eurS(k.cfCum)}</span>`;
  const lastInc = data.incassi.slice().sort((a, b) => a.mese.localeCompare(b.mese)).pop();
  $('#h-meta').innerHTML = `${k.mesi} ${k.mesi === 1 ? 'mese' : 'mesi'} di gestione (${monthLabel(data.immobile.inizio_gestione, true)} → ${monthLabel(fine, true)})`
    + (lastInc ? ` · ultimo incasso: ${monthLabel(lastInc.mese, true)}${lastInc.stato === 'provvisorio' ? ' <span class="badge warn">provvisorio</span>' : ''}` : '');
  const m1 = Math.max(0, Math.min(1, k.recuperoCassa));
  $('#m1').style.width = `${m1 * 100}%`; $('#m1').classList.toggle('neg', k.cfCum < 0);
  $('#m1-txt').textContent = ui.privacy ? `${pct(k.recuperoCassa, 0)} recuperato` : `${pct(k.recuperoCassa, 0)} di ${eur(k.cap)}`;
  $('#m1-sub').textContent = etaCassa ? `Previsto ${monthLabel(etaCassa, true)} · scenario ${scenLabel}` : `Non raggiunto entro 30 anni con lo scenario ${scenLabel}`;
  const m2 = Math.max(0, Math.min(1, k.recuperoPatr));
  $('#m2').style.width = `${m2 * 100}%`; $('#m2').classList.toggle('neg', k.recuperoPatr < 0);
  $('#m2-txt').textContent = ui.privacy ? `${pct(k.recuperoPatr, 0)} recuperato` : `${pct(k.recuperoPatr, 0)} di ${eur(k.trans)}`;
  $('#m2-sub').textContent = k.posizione >= 0 ? 'Raggiunto' : etaPatr ? `Previsto ${monthLabel(etaPatr, true)} · rivalutazione ${pct(p.rivalutazione)} annua` : `Non raggiunto entro 30 anni con lo scenario ${scenLabel}`;

  // KPI
  const ann = k.mesi < 12 ? `annualizzato su ${k.mesi} ${k.mesi === 1 ? 'mese' : 'mesi'}` : 'annualizzato';
  const tiles = [
    ['Rendimento netto su prezzo', pct(k.rendNetto), `${ann} · reddito netto dopo tasse ÷ ${eur(data.immobile.prezzo)}`, cls(k.rendNetto), 'rendNetto'],
    ['Cash-on-cash', pct(k.cashOnCash), `${ann} · cash flow ÷ capitale proprio`, cls(k.cashOnCash), 'coc'],
    ['ROI totale', pct(k.roiTot), `annualizzato ${pct(k.roiTotAnn)} · include capitale rimborsato${ui.valore !== 'nominale' ? ' e rivalutazione' : ''}`, cls(k.roiTot), 'roi'],
  ];
  const giorni = R.reduce((s, r) => { const [y, m] = r.mese.split('-').map(Number); return s + new Date(y, m, 0).getDate(); }, 0) || 1;
  const L = k.lordo || 1;
  // In modalità privacy le card con importi assoluti diventano indicatori percentuali
  tiles.push(...(ui.privacy ? [
    ['Occupazione', pct(k.notti / giorni, 0), `${nf0.format(k.notti)} notti su ${giorni} giorni`, '', 'occupazione'],
    ['Mutuo rimborsato', pct(k.capRimb / data.mutuo.importo), 'quota capitale restituita', '', 'mutuoPct'],
    ['Loan to value', pct(k.ltv, 0), 'debito ÷ valore immobile', '', 'ltv'],
    ['Tasse sul lordo', pct(k.ced / L), 'cedolare maturata ÷ lordo', '', 'tassePct'],
    ['Costi sul lordo', pct(k.costi / L), k.costiStimati ? `di cui stime ${pct(k.costiStimati / L)}` : 'tutti da spese reali', '', 'costiPct'],
  ] : [
    ['Lordo incassato', eur(k.lordo), `${nf0.format(k.notti)} notti · ADR ${k.notti ? eur(k.lordo / k.notti) : '—'}`, '', 'lordo'],
    ['Debito residuo', eur(k.debito), `capitale rimborsato ${eur(k.capRimb)}`, '', 'debito'],
    ['Patrimonio netto immobiliare', eur(k.equity), `LTV ${pct(k.ltv, 0)} · valore ${eur(k.valore)}`, '', 'equity'],
    ['Cedolare da accantonare', eur(k.tasseDaAccantonare), `maturata ${eur(k.ced)} · trattenuta ${eur(k.ritenute)}`, '', 'cedolare'],
    ['Costi operativi', eur(k.costi), k.costiStimati ? `di cui stimati ${eur(k.costiStimati)}` : 'tutti da spese reali', '', 'costi'],
  ]));
  const bench = confrontoBenchmark(data, R);
  info.setCtx('panoramica', { k, R, data, p, scenLabel, etaCassa, etaPatr, giorni, bench });
  $('#kpi-grid').innerHTML = tiles.map(([l, v, s, c, key]) => `<div class="card tile"><div class="t-label"><span>${esc(l)}</span>${info.btn(key, l)}</div><div class="t-value ${c}">${v}</div><div class="t-sub">${s}</div></div>`).join('');

  renderRicaviChart(R);
  renderBenchmark(bench);
  renderSplit(k, R);
  renderPosizione(R, k, proj30, p, fine);
  renderTabellaMensile(R);
  renderAcquisto(k, reg);
}

// Confronto dei tuoi mesi con gli stessi mesi della gestione precedente. Le percentuali restano visibili in modalità privacy.
function renderBenchmark(c) {
  const el = $('#bench-body');
  if (!c.nMesi) { el.innerHTML = '<div class="empty">Appena registri il primo resoconto mensile confronto i tuoi risultati con gli stessi mesi del 2024 e del 2025.</div>'; return; }
  const t = c.totale;
  const pc = (d) => (d == null ? '—' : `${d > 0.0005 ? '+' : d < -0.0005 ? '−' : ''}${pct(Math.abs(d), 0)}`);
  const cl = (d) => (d == null ? '' : d > 0.05 ? 'pos' : d < -0.05 ? 'neg' : '');
  const badge = (v) => ({ sopra: '<span class="badge ok">sopra</span>', 'in linea': '<span class="badge">in linea</span>', sotto: '<span class="badge bad">sotto</span>' }[v] || '');
  const nf1 = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1 });
  const cella = (a, b, d, f, l) => `<td class="n" data-l="${l}"><strong>${f(a)}</strong><small>benchmark ${f(b)} · <span class="${cl(d)}">${pc(d)}</span></small></td>`;
  const mesi = c.nMesi === 1 ? '1 mese' : `${c.nMesi} mesi`;
  const frase = `Su ${mesi} di gestione il tuo lordo è <span class="${cl(t.d.lordo)}">${pc(t.d.lordo)}</span> rispetto al benchmark (${t.verdetto}): `
    + `notti <span class="${cl(t.d.notti)}">${pc(t.d.notti)}</span>, prezzo medio <span class="${cl(t.d.adr)}">${pc(t.d.adr)}</span>.`
    + (c.nMesi < 3 ? ' Con così pochi mesi è solo un\'indicazione.' : '');
  const righe = [...c.righe, { ...t, mese: null }];
  el.innerHTML = `<p class="bench-sum">${frase}</p>
    <div class="table-wrap"><table><thead><tr><th>Mese</th><th class="n">Notti</th><th class="n">Prezzo medio a notte</th><th class="n">Lordo</th><th>Esito</th></tr></thead><tbody>
    ${righe.map((x) => `<tr class="${x.mese ? '' : 'total'}"><td>${x.mese ? monthLabel(x.mese, true) : (c.nMesi > 1 ? 'Totale' : '')}</td>
      ${cella(x.own.notti, x.bench.notti, x.d.notti, (v) => nf1.format(v), 'Notti')}
      ${cella(x.own.adr, x.bench.adr, x.d.adr, (v) => eur(v), 'Prezzo medio a notte')}
      ${cella(x.own.lordo, x.bench.lordo, x.d.lordo, (v) => eur(v), 'Lordo')}<td data-l="Esito">${badge(x.verdetto)}</td></tr>`).filter((_, i, a) => c.nMesi > 1 || i < a.length - 1).join('')}
    </tbody></table></div>
    <p class="fine">Benchmark = media degli stessi mesi del ${[...new Set(c.righe.flatMap((x) => x.anni))].join(' e ')} (gestione precedente; per gennaio–giugno anche il 2026 reale). Il lordo 2024–2025 è stimato come notti × prezzo medio annuo; "in linea" = entro ±5%.</p>`;
}

function renderRicaviChart(R) {
  const inizio = data.immobile.inizio_gestione;
  const fine = R.length ? R[R.length - 1].mese : inizio;
  // anno solare: da gennaio a dicembre, a prescindere dal mese in cui è iniziata la gestione
  // lordo previsto dalle prenotazioni inserite a mano, per mese di check-out
  const prev = {};
  for (const b of data.prenotazioni || []) if (b.stato !== 'cancellata' && b.check_out) prev[b.check_out.slice(0, 7)] = (prev[b.check_out.slice(0, 7)] || 0) + Number(b.lordo || 0);
  const ultimoPrev = Object.keys(prev).sort().pop();
  const annoMax = Math.max(Number(fine.slice(0, 4)), ultimoPrev ? Number(ultimoPrev.slice(0, 4)) : 0);
  const anni = []; for (let y = Number(inizio.slice(0, 4)); y <= annoMax; y++) anni.push(String(y));
  const anno = anni.includes(String(ui.annoRicavi)) ? String(ui.annoRicavi) : anni.includes(fine.slice(0, 4)) ? fine.slice(0, 4) : anni[anni.length - 1];
  const mesi = monthsBetween(`${anno}-01`, `${anno}-12`);
  $('#ric-sub').textContent = `${anno} · i tuoi incassi reali vs benchmark della gestione precedente`;
  $('#ric-anno').style.display = anni.length > 1 ? 'inline-flex' : 'none';
  $('#ric-anno').innerHTML = anni.map((y) => `<button type="button" data-v="${y}">${y}</button>`).join('');
  seg($('#ric-anno'), anno, (y) => { ui.annoRicavi = y; saveUI(); renderRicaviChart(R); });
  const byM = Object.fromEntries(R.map((r) => [r.mese, r]));
  const st = data.storico;
  const refSeries = {
    2024: { color: css('--s2'), label: 'Benchmark 2024', val: (mi) => st['2024'].notti[mi] * st['2024'].adr },
    2025: { color: css('--s3'), label: 'Benchmark 2025', val: (mi) => st['2025'].notti[mi] * st['2025'].adr },
    2026: { color: css('--s7'), label: 'Benchmark 2026 (gen–giu)', val: (mi) => (mi < (st['2026'].completi_fino_a ?? 6) ? st['2026'].lordo[mi] || null : null) },
  };
  $('#ref-chips').innerHTML = '<span class="lbl">Benchmark gestione precedente</span>' + Object.entries(refSeries).map(([y, s]) => `<label class="chip ${ui.refs[y] ? '' : 'off'}" style="color:${s.color}"><input type="checkbox" data-y="${y}" ${ui.refs[y] ? 'checked' : ''}><span class="sw"></span><span style="color:var(--ink-2)">${y}</span></label>`).join('');
  $$('#ref-chips input').forEach((i) => i.addEventListener('change', () => { ui.refs[i.dataset.y] = i.checked; saveUI(); renderRicaviChart(R); }));
  // una sola serie di barre: piena se il mese è rendicontato dal PM, trasparente con bordo tratteggiato se è solo una previsione
  const rend = mesi.map((m) => !!byM[m]?.inc);
  const s1 = css('--s1');
  const ds = [{
    type: 'bar', label: 'Reale', data: mesi.map((m, i) => (rend[i] ? byM[m].lordo : prev[m] ? Math.round(prev[m] * 100) / 100 : null)),
    backgroundColor: rend.map((r) => (r ? s1 : alpha(s1, 0.28))), borderColor: s1, borderWidth: rend.map((r) => (r ? 0 : 2)), borderDash: [5, 4],
    borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24, order: 2,
  }];
  for (const [y, s] of Object.entries(refSeries)) {
    if (!ui.refs[y]) continue;
    ds.push({ type: 'line', label: s.label, data: mesi.map((m) => { const v = s.val(Number(m.slice(5, 7)) - 1); return v ? Math.round(v) : null; }),
      borderColor: s.color, backgroundColor: s.color, borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, spanGaps: false, order: 1 });
  }
  const opt = baseOptions();
  opt.plugins.tooltip.callbacks.label = (c) => {
    if (c.datasetIndex !== 0) return ` ${c.dataset.label}: ${c.raw == null ? '—' : eur(c.raw)}`;
    const m = mesi[c.dataIndex];
    if (!rend[c.dataIndex]) return ` Previsto dalle prenotazioni (non ancora rendicontato): ${eur(c.raw)}`;
    return ` Reale (resoconto PM): ${eur(c.raw)}${prev[m] ? ` · prenotazioni inserite ${eur(prev[m])} (${eurS(c.raw - prev[m])})` : ''}`;
  };
  chart('c-ricavi', { data: { labels: mesi.map((m) => monthLabel(m)), datasets: ds }, options: opt });
  $('#ric-legend').innerHTML = legendHTML([[s1, 'Rendicontato (resoconto PM)'], [alpha(s1, 0.28), 'Previsto dalle prenotazioni inserite']]);
}

// Lordo e commissioni per canale, dal dettaglio delle prenotazioni dei resoconti (solo mesi del registro)
function datiCanali(R) {
  const mesi = new Set(R.map((r) => r.mese)); const per = {};
  for (const x of data.incassi) {
    if (!mesi.has(x.mese)) continue;
    for (const b of x.dettaglio || []) { const c = (per[b.canale] ||= { lordo: 0, comm: 0 }); c.lordo += Number(b.lordo || 0); c.comm += Number(b.commissioni || 0); }
  }
  return per;
}

function renderSplit(k, R) {
  const L = k.lordo;
  $('#split-sub').textContent = `${k.mesi} ${k.mesi === 1 ? 'mese' : 'mesi'} · su ${eur(L)} lordi · le altre % sono sul lordo`;
  if (!L) { $('#split').innerHTML = '<div class="empty">Nessun incasso registrato nel periodo.</div>'; return; }
  // tariffe vere: ogni portale trattiene la sua percentuale; il PM prende il suo sul netto di ciascun soggiorno
  const per = datiCanali(R); const Lc = Object.values(per).reduce((x, c) => x + c.lordo, 0);
  const tariffe = Lc > L - 1 && Lc > 0 ? Object.entries(per).filter(([, c]) => c.lordo > 0).map(([n, c]) => `${esc(n)} ${pct(c.comm / c.lordo)}`).join(' · ') : '';
  const netto = L - k.comm;
  const subComm = tariffe ? `${tariffe} del lordo di ciascun canale` : 'tariffe diverse per canale: importa il resoconto del PM per vederle';
  const subFee = data.pm.base === 'lordo' ? `${pct(k.fee / L)} del lordo` : `${pct(netto ? k.fee / netto : 0)} del netto di ogni soggiorno, dopo i portali`;
  const rows = [
    ['Commissioni portali', k.comm, subComm], ['Property manager', k.fee, subFee], ['Cedolare secca', k.ced], ['Costi operativi', k.costi],
    ['Interessi e spese mutuo', k.interessi + k.speseMutuo], ['Quota capitale mutuo', k.capitale],
  ];
  const max = Math.max(L, ...rows.map((r) => r[1]), Math.abs(k.cfCum));
  const bar = (v, color) => `<div class="meter-track" style="background:var(--surface-2)"><div class="meter-fill" style="width:${Math.min(100, Math.abs(v) / max * 100)}%;background:${color}"></div></div>`;
  $('#split').innerHTML = `<div class="stack" style="--gap:8px">${rows.map(([l, v, sub]) => `
    <div><div class="meter-row"><span>${l}</span><span class="num">${eur(v)}${sub ? '' : ` <small>· ${pct(v / L, 1)}</small>`}</span></div>${sub ? `<div class="muted" style="font-size:var(--fs-xs);margin:-2px 0 4px">${sub}</div>` : ''}${bar(v, css('--s1'))}</div>`).join('')}
    <div><div class="meter-row"><strong>Cash flow netto</strong><span class="num ${cls(k.cfCum)}"><strong>${eurS(k.cfCum)}</strong> <small>· ${pct(k.cfCum / L, 1)}</small></span></div>${bar(k.cfCum, k.cfCum >= 0 ? css('--good') : css('--bad'))}</div>
    <p class="muted" style="font-size:var(--fs-xs);margin:0">La quota capitale non è una perdita: riduce il debito e aumenta il tuo patrimonio netto.</p></div>`;
}

function renderPosizione(R, k, proj30, p, fine) {
  const cap = k.cap;
  // ricostruisce la posizione reale mese per mese
  let cfCum = 0;
  const real = R.map((r) => { cfCum += r.cf; const v = valoreImmobile(data, r.mese, ui.valore); return { mese: r.mese, cfCum, posizione: v - r.debito + cfCum - cap }; });
  const anni = Math.max(5, Math.min(30, p.anni || 15));
  const endMese = addMonths(data.immobile.inizio_gestione, anni * 12 - 1);
  const proj = proj30.filter((r) => monthDiff(r.mese, endMese) >= 0);
  const labelsAll = [...real.map((r) => r.mese), ...proj.map((r) => r.mese)];
  const nR = real.length;
  const s1 = css('--s1'); const s2 = css('--s2');
  const nVis = renderFinestra('#pos-range', 'pos', anni, endMese.slice(0, 4), () => renderPosizione(R, k, proj30, p, fine));
  const nP = Math.min(labelsAll.length, nVis);
  const labels = labelsAll.slice(0, nP);
  // breakeven: sull'intero orizzonte di 30 anni, anche se fuori dalla finestra mostrata
  const tuttiMesi = [...real.map((r) => r.mese), ...proj30.map((r) => r.mese)];
  const tuttiPos = [...real.map((r) => r.posizione), ...proj30.map((r) => r.posizione)];
  const tuttiCf = [...real.map((r) => r.cfCum), ...proj30.map((r) => r.cfCum)];
  const iBp = tuttiPos.findIndex((v) => v >= 0); const iBc = tuttiCf.findIndex((v) => v >= cap);
  const posAll = tuttiPos.slice(0, labelsAll.length); const cfAll = tuttiCf.slice(0, labelsAll.length);
  const dsReal = (key) => [...real.map((r) => Math.round(r[key])), ...proj.map(() => null)].slice(0, nP);
  const dsProj = (key) => [...real.map((r, i) => (i === nR - 1 ? Math.round(r[key]) : null)), ...proj.map((r) => Math.round(r[key]))].slice(0, nP);
  chart('c-posizione', {
    type: 'line',
    data: {
      labels: labels.map((m) => monthLabel(m)),
      datasets: [
        { label: 'Posizione netta (reale)', data: dsReal('posizione'), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: nR < 3 ? 4 : 0, tension: 0.2 },
        { label: 'Posizione netta (proiezione)', data: dsProj('posizione'), borderColor: s1, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2 },
        { label: 'Cash flow cumulato (reale)', data: dsReal('cfCum'), borderColor: s2, backgroundColor: s2, borderWidth: 2, pointRadius: nR < 3 ? 4 : 0, tension: 0.2 },
        { label: 'Cash flow cumulato (proiezione)', data: dsProj('cfCum'), borderColor: s2, borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: 0.2 },
        puntoBreakeven('Breakeven patrimoniale', iBp, posAll, s1).data.some((x) => x != null) ? puntoBreakeven('Breakeven patrimoniale', iBp, posAll, s1) : null,
        puntoBreakeven('Breakeven di cassa', iBc, cfAll, s2).data.some((x) => x != null) ? puntoBreakeven('Breakeven di cassa', iBc, cfAll, s2) : null,
      ].filter(Boolean).map((d) => (d.data.length > nP ? { ...d, data: d.data.slice(0, nP) } : d)),
    },
    options: opzioniTempo(labels),
  });
  $('#pos-legend').innerHTML = legendHTML([[s1, 'Posizione netta'], [s2, 'Cash flow cumulato'], [css('--muted'), 'proiezione', true]]) + `<span><i style="background:${css('--muted')};transform:rotate(45deg);border-radius:2px;width:9px;height:9px"></i>breakeven</span>`;
  const dQuando = (i) => (i >= 0 ? monthLabel(tuttiMesi[i], true) : 'oltre 30 anni');
  $('#pos-note').textContent = `Breakeven patrimoniale: ${dQuando(iBp)} · breakeven di cassa: ${dQuando(iBc)} (con lo scenario del simulatore).`;
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
      <td class="n" title="${esc(Object.entries(r.costi).map(([c, v]) => `${CATEGORIE[c] || (c === 'pm_extra' ? 'Spese addebitate dal PM' : c)}: ${eur(v.importo, 2)}${v.stimato ? ' (stima)' : ''}`).join('\n'))}">${eur(-r.costiTot)}${est}</td>
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
  $('#kv-acquisto').innerHTML = data.acquisto.map((a) => `<dt>${esc(maskText(a.voce))}</dt><dd>${eur(a.importo)}</dd>`).join('')
    + `<dt class="tot">Capitale proprio</dt><dd class="tot">${eur(k.cap)}</dd>`
    + `<dt class="muted">di cui costi di transazione (non recuperabili con la vendita)</dt><dd class="muted">${eur(k.trans)}</dd>`;
  const m = data.mutuo;
  const piano = [...reg.piano.values()];
  const interessiTot = piano.reduce((s, r) => s + r.interessi, 0);
  const pagate = piano.filter((r, i) => monthDiff([...reg.piano.keys()][i], fineAnalisi()) >= 0).length;
  $('#mutuo-sub').textContent = maskText(`${m.banca} n. ${m.numero}`);
  $('#kv-mutuo').innerHTML = [
    ['Importo', eur(m.importo)], ['TAN fisso / TAEG', `${pct(m.tan, 2)} / ${pct(m.taeg, 2)}`], ['Durata', `${m.anni} anni · ${m.anni * 12} rate`],
    ['Rata (capitale + interessi)', eur(m.rata, 2)], ['Spese incasso rata', eur(m.spese_incasso, 2)], ['Addebito mensile', eur(m.rata + m.spese_incasso, 2)],
    ['Prima rata', `${new Date(m.prima_rata).toLocaleDateString('it-IT')} · ${eur(m.rata + m.spese_incasso + m.preammortamento, 2)}`],
    ['Rate pagate', `${pagate} / ${m.anni * 12}`], ['Debito residuo', eur(k.debito)], ['Interessi totali (30 anni)', eur(interessiTot)],
  ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('') + (m.note ? `<dt class="fine-row">${esc(maskText(m.note))}</dt>` : '');
}

// ---------- COPERTURA DELLA RATA (previsione dalle prenotazioni; non tocca registro() né kpi()) ----------
function renderCopertura() {
  const c = ui.cop = { sfas: 1, ced: false, costi: false, iva: false, bacino: true, ...ui.cop };
  // si mostra dal mese prima di quello corrente (di cui il PM sta per pagare il resoconto); il bacino parte però dall'inizio gestione
  const R = coperturaRata(data, { visibileDa: addMonths(currentMonth(), -1), sfasamento: c.sfas, ced: c.ced, costi: c.costi, iva: c.iva, bacino: c.bacino });
  const prenotate = (data.prenotazioni || []).some((b) => b.stato !== 'cancellata');
  const opt = (k, l) => `<label class="chip ${c[k] ? '' : 'off'}"><input type="checkbox" data-cop="${k}" ${c[k] ? 'checked' : ''}><span style="color:var(--ink-2)">${l}</span></label>`;
  const toolbar = `<div class="toolbar" style="margin:0 0 12px"><span class="lbl">Il bonifico del PM arriva</span>
    <div class="seg" id="seg-sfas"><button data-v="1" aria-pressed="${c.sfas === 1}">il mese dopo</button><button data-v="0" aria-pressed="${c.sfas === 0}">lo stesso mese</button></div>
    ${opt('bacino', 'usa il netto avanzato nei mesi prima')}${opt('costi', 'includi costi fissi')}${opt('ced', 'accantona la cedolare')}${opt('iva', 'IVA 22% sulla fee PM')}</div>`;
  const con = R.righe.filter((r) => r.fabbisogno > 0);
  let sommario;
  if (!prenotate && !con.some((r) => r.fonte !== 'vuoto')) {
    sommario = `<p class="muted" style="margin:0 0 12px">Nessuna prenotazione inserita. Aggiungile in <em>Registro → Prenotazioni in arrivo</em> per vedere se coprono la rata.</p>`;
  } else if (!con.length) {
    sommario = `<p style="margin:0 0 12px">Nessuna rata da coprire nel periodo.</p>`;
  } else {
    const p = con[0]; const ok = p.manca === 0;
    const altri = con.slice(1);
    const coperti = altri.filter((r) => r.manca === 0).length;
    const parziali = altri.filter((r) => r.manca > 0 && r.fonte !== 'vuoto');
    const vuoti = altri.filter((r) => r.manca > 0 && r.fonte === 'vuoto').length;
    const parti = [coperti ? `${coperti} ${coperti === 1 ? 'coperto' : 'coperti'}` : '', parziali.length ? `${parziali.length} con prenotazioni ma ancora corti (mancherebbero in tutto ${eur(parziali.reduce((x, r) => x + r.manca, 0))})` : '', vuoti ? `${vuoti} ancora senza prenotazioni` : ''].filter(Boolean);
    const resto = parti.length ? ` Mesi successivi: ${parti.join(', ')}.` : '';
    sommario = `<p style="margin:0 0 12px;font-size:var(--fs-lg)">${ok ? `<strong>La rata di ${monthLabel(p.pagamento, true)} (${eur(p.fabbisogno)}) è coperta</strong>, con ${eur(p.avanza)} di margine.` : `<strong>Mancano ${eur(p.manca)}</strong> per la rata di ${monthLabel(p.pagamento, true)} (${eur(p.fabbisogno)}).`}${resto}</p>`;
  }
  const righe = R.righe.map((r) => {
    const titolo = `Soggiorni di ${monthLabel(r.mese, true)}${r.fabbisogno > 0 ? ` → rata di ${monthLabel(r.pagamento, true)}` : ''}`;
    const det = r.fonte === 'resoconto' ? 'resoconto del PM già importato'
      : r.fonte === 'prenotazioni' ? `${r.n} ${r.n === 1 ? 'prenotazione' : 'prenotazioni'} · ${nf0.format(r.notti)} notti · ${eur(r.lordo)} lordi → ${eur(r.netto)} netti per te`
        : 'nessuna prenotazione inserita';
    const bac = r.riporto > 0 ? ` Più ${eur(r.riporto)} avanzati dai mesi precedenti.` : '';
    if (!(r.fabbisogno > 0)) return `<div><div class="meter-row"><span>${titolo}</span><span class="num muted">nessuna rata</span></div><div class="muted" style="font-size:var(--fs-xs)">${det}. Nel mese del bonifico non c'è nessuna rata da pagare: ${eur(r.netto + r.riporto)} restano a disposizione per i mesi dopo.</div></div>`;
    const cov = r.copertura ?? 0; const ok = r.manca === 0;
    const colore = ok ? css('--good') : cov >= 0.5 ? css('--warn') : css('--bad');
    const esito = ok ? `Rata coperta, avanzano ${eur(r.avanza)}.`
      : `Mancano <strong>${eur(r.manca)}</strong> netti${r.lordoMancante ? `, cioè circa ${eur(r.lordoMancante)} lordi${r.nottiEq && r.adr ? ` (≈ ${nf0.format(r.nottiEq)} notti a ${eur(r.adr)})` : ''}` : ''}.`;
    return `<div><div class="meter-row"><span>${titolo}</span><span class="num">${eur(r.disponibile)} / ${eur(r.fabbisogno)} <small>· ${pct(cov, 0)}</small></span></div>
      <div class="meter-track" style="background:var(--surface-2)"><div class="meter-fill" style="width:${Math.min(100, cov * 100)}%;background:${colore}"></div></div>
      <div class="muted" style="font-size:var(--fs-xs);margin-top:4px">${det}.${bac} ${esito}</div></div>`;
  }).join('');
  $('#cop-body').innerHTML = `${toolbar}${sommario}<div class="stack" style="--gap:14px">${righe}</div>
    <p class="muted" style="font-size:var(--fs-xs);margin:12px 0 0">Il confronto è in euro, non in notti: con prezzi più alti bastano meno notti. Ogni prenotazione conta per il mese di check-out; il netto che avanza in un mese resta disponibile per le rate dei mesi dopo (ottobre incluso).</p>`;
  seg($('#seg-sfas'), String(c.sfas), (v) => { ui.cop.sfas = Number(v); saveUI(); renderCopertura(); });
  $$('#cop-body input[data-cop]').forEach((i) => i.addEventListener('change', () => { ui.cop[i.dataset.cop] = i.checked; saveUI(); renderCopertura(); }));
}

// ---------- REGISTRO ----------
function renderRegistro() {
  // Incassi
  const inc = data.incassi.slice().sort((a, b) => b.mese.localeCompare(a.mese));
  $('#t-incassi').innerHTML = inc.length ? `<thead><tr><th>Mese</th><th>Stato</th><th class="n">Lordo</th><th class="n">Portali</th><th class="n">Fee PM</th><th class="n">Netto PM</th><th class="n">Notti</th><th class="n">Ritenuta</th><th class="n">Bonifico</th><th>Fonte</th><th>Allegati</th><th></th></tr></thead><tbody>${inc.map((x) => {
    const fee = x.fee_pm != null && x.fee_pm !== '' ? Number(x.fee_pm) : feePM(data, x.lordo, x.commissioni);
    const netto = x.lordo - x.commissioni - fee - Number(x.spese_pm || 0);
    const atteso = x.dovuto_pm != null && x.dovuto_pm !== '' ? Number(x.dovuto_pm) : netto;
    const hasBon = x.bonifico != null && x.bonifico !== '';
    const diff = hasBon ? Number(x.bonifico) - atteso : null;
    return `<tr><td>${monthLabel(x.mese, true)}</td><td><span class="badge ${x.stato === 'definitivo' ? 'ok' : 'warn'}">${esc(x.stato || 'definitivo')}</span></td>
      <td class="n">${eur(x.lordo, 2)}</td><td class="n">${eur(x.commissioni, 2)}</td><td class="n">${eur(fee, 2)}${x.fee_pm == null || x.fee_pm === '' ? '<span class="est" title="calcolata">ᶜ</span>' : ''}</td>
      <td class="n">${eur(netto, 2)}</td><td class="n">${x.notti ?? '—'}</td><td class="n">${eur(x.ritenuta || 0, 2)}</td>
      <td class="n">${hasBon ? eur(x.bonifico, 2) + (Math.abs(diff) > 1 ? ` <span class="badge warn" title="differenza rispetto all'importo atteso dal PM">${eurS(diff, 2)}</span>` : ' <span class="badge ok">✓</span>') : (x.dovuto_pm != null ? `<span class="muted" title="importo indicato nel resoconto del PM">atteso ${eur(atteso, 2)}</span>` : '—')}</td>
      <td>${esc(x.fonte || 'manuale')}${x.dettaglio?.length ? ` · ${x.dettaglio.length} pren.` : ''}</td>
      <td>${allegatiLinks(x.allegati)}</td>
      <td style="white-space:nowrap"><button class="btn small ghost" data-edit-inc="${x.mese}">Modifica</button><button class="btn small ghost danger" data-del-inc="${x.mese}">Elimina</button></td></tr>`
      + (x.nota ? `<tr><td></td><td colspan="11" class="muted" style="font-size:var(--fs-xs);border-top:0">${esc(x.nota)}</td></tr>` : '');
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
  // prima le spese ancora da pagare (la più vicina in alto), poi quelle pagate dalla più recente
  const aperta = (s) => statoSpesa(s) !== 'pagata';
  const sp = data.spese.slice().sort((a, b) => (aperta(b) - aperta(a)) || (aperta(a) ? a.data.localeCompare(b.data) : b.data.localeCompare(a.data)));
  const oggi = today(); const tra7 = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
  const badgeStato = (s) => {
    const st = statoSpesa(s);
    if (st === 'pagata') return '<span class="badge ok">Pagata</span>';
    if (st === 'da_pagare') return s.data < oggi ? '<span class="badge bad">Scaduta</span>' : `<span class="badge${s.data <= tra7 ? ' warn' : ''}">Da pagare</span>`;
    return s.data < oggi ? '<span class="badge warn" title="La data di addebito è passata: se è andato a buon fine, segnala come pagata">Addebito passato</span>' : '<span class="badge">Programmata</span>';
  };
  const dataIt = (v) => new Date(v).toLocaleDateString('it-IT');
  const aperte = sp.filter(aperta);
  const gruppo = (st) => { const x = aperte.filter((s) => statoSpesa(s) === st); return { n: x.length, tot: x.reduce((t, s) => t + Number(s.importo), 0) }; };
  const dp = gruppo('da_pagare'); const pr = gruppo('programmata');
  const inRitardo = aperte.filter((s) => s.data < oggi && statoSpesa(s) === 'da_pagare');
  const prossima = aperte.find((s) => s.data >= oggi);
  $('#sp-riepilogo').innerHTML = aperte.length ? `<div class="card mt" style="padding-block:12px"><p style="margin:0">
    ${dp.n ? `<strong>${dp.n} da pagare</strong> (${eur(dp.tot, 2)})` : ''}${dp.n && pr.n ? ' · ' : ''}${pr.n ? `<strong>${pr.n} ${pr.n === 1 ? 'programmata' : 'programmate'}</strong> (${eur(pr.tot, 2)})` : ''}
    ${inRitardo.length ? ` · <strong style="color:var(--bad-ink)">${inRitardo.length} ${inRitardo.length === 1 ? 'scaduta' : 'scadute'}</strong>` : ''}
    ${prossima ? `<span class="muted"> · prossima: ${dataIt(prossima.data)}, ${esc(CATEGORIE[prossima.categoria] || prossima.categoria)} ${eur(prossima.importo, 2)}</span>` : ''}</p></div>` : '';
  $('#t-spese').innerHTML = sp.length ? `<thead><tr><th>Data</th><th>Stato</th><th>Categoria</th><th>Descrizione</th><th>Competenza</th><th class="n">Importo</th><th>Allegati</th><th></th></tr></thead><tbody>${sp.map((s) => `
    <tr><td>${dataIt(s.data)}</td><td>${badgeStato(s)}</td><td>${esc(CATEGORIE[s.categoria] || s.categoria)}</td><td>${esc(s.descrizione || '')}</td>
    <td>${s.competenza_dal ? `${monthLabel(s.competenza_dal)}${s.competenza_al && s.competenza_al !== s.competenza_dal ? ` → ${monthLabel(s.competenza_al)}` : ''}` : monthLabel(s.data.slice(0, 7))}</td>
    <td class="n">${eur(s.importo, 2)}</td><td>${allegatiLinks(s.allegati)}</td>
    <td style="white-space:nowrap">${aperta(s) ? `<button class="btn small" data-pay-sp="${s.id}">Segna pagata</button>` : ''}<button class="btn small ghost" data-edit-sp="${s.id}">Modifica</button><button class="btn small ghost danger" data-del-sp="${s.id}">Elimina</button></td></tr>`).join('')}</tbody>`
    : '<tbody><tr><td class="empty">Nessuna spesa registrata. Polizza e internet sono già conteggiati automaticamente dal budget.</td></tr></tbody>';
  $$('[data-pay-sp]').forEach((b) => b.onclick = async () => {
    const s = data.spese.find((x) => x.id === b.dataset.paySp);
    s.scadenza = s.scadenza || s.data; s.stato = 'pagata'; s.data = today();
    await persist(`Spesa pagata: ${CATEGORIE[s.categoria] || s.categoria} ${eur(s.importo, 2)}`);
  });
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

  seg($('#seg-attr'), ui.attr, (v) => { ui.attr = v; saveUI(); renderRegistro(); if (lastXlsx?.r?.tipo === 'export') previewXlsx(lastXlsx.rows, lastXlsx.file); });
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

function renderPrenotazioni() {
  const lista = (data.prenotazioni || []).slice().sort((x, y) => x.check_in.localeCompare(y.check_in));
  const conResoconto = new Set(data.incassi.map((x) => x.mese));
  $('#t-pren').innerHTML = lista.length ? `<thead><tr><th>Check-in</th><th>Check-out</th><th class="n">Notti</th><th>Canale</th><th class="n">Lordo</th><th class="n">Netto per te</th><th>Stato</th><th></th></tr></thead><tbody>${lista.map((b) => {
    const x = nettoPrenotazione(data, b, { iva: ui.cop?.iva }); const annullata = b.stato === 'cancellata'; const nelResoconto = conResoconto.has(b.check_out.slice(0, 7));
    const d = (v) => v.split('-').reverse().join('/');
    return `<tr${annullata ? ' style="opacity:.55"' : ''}><td>${d(b.check_in)}</td><td>${d(b.check_out)}</td><td class="n">${nottiTra(b.check_in, b.check_out)}</td><td>${esc(b.canale)}</td>
      <td class="n">${eur(b.lordo, 2)}</td><td class="n">${annullata ? '—' : `${eur(x.netto, 2)}<span class="est" title="stima: lordo − commissione canale − fee PM">ᶜ</span>`}</td>
      <td><span class="badge ${annullata ? 'bad' : 'ok'}">${esc(b.stato || 'confermata')}</span>${nelResoconto && !annullata ? ' <span class="badge" title="Il mese ha già il resoconto del PM: conta quello, non questa prenotazione">nel resoconto</span>' : ''}</td>
      <td style="white-space:nowrap"><button class="btn small ghost" data-edit-pren="${esc(b.id)}">Modifica</button><button class="btn small ghost danger" data-del-pren="${esc(b.id)}">Elimina</button></td></tr>`
      + (b.nota ? `<tr><td></td><td colspan="7" class="muted" style="font-size:var(--fs-xs);border-top:0">${esc(b.nota)}</td></tr>` : '');
  }).join('')}</tbody>` : '<tbody><tr><td class="empty">Nessuna prenotazione inserita.</td></tr></tbody>';
  $$('[data-edit-pren]').forEach((b) => b.onclick = () => fillPren(data.prenotazioni.find((x) => x.id === b.dataset.editPren)));
  $$('[data-del-pren]').forEach((b) => b.onclick = async () => {
    if (!confirm('Eliminare questa prenotazione?')) return;
    data.prenotazioni = data.prenotazioni.filter((x) => x.id !== b.dataset.delPren);
    await persist('Elimina prenotazione');
  });
}
function fillPren(b) {
  const f = $('#f-pren');
  f.canale.value = b.canale; f.check_in.value = b.check_in; f.check_out.value = b.check_out; f.lordo.value = b.lordo;
  f.stato.value = b.stato || 'confermata'; f.nota.value = b.nota || ''; f.dataset.id = b.id;
  $('#pren-form-title').textContent = 'Modifica prenotazione';
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#f-pren').addEventListener('reset', (e) => { delete e.target.dataset.id; $('#pren-form-title').textContent = 'Nuova prenotazione'; });
$('#f-pren').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const fd = new FormData(f);
  const ci = fd.get('check_in'); const co = fd.get('check_out');
  if (!(co > ci)) return toast('Il check-out deve essere dopo il check-in', true);
  const id = f.dataset.id || `p${Date.now().toString(36)}`;
  const rec = { id, canale: fd.get('canale'), check_in: ci, check_out: co, lordo: Math.round(Number(fd.get('lordo')) * 100) / 100, stato: fd.get('stato'), nota: String(fd.get('nota') || '') };
  data.prenotazioni = data.prenotazioni.filter((x) => x.id !== id).concat(rec);
  try { await persist(`Prenotazione ${ci} → ${co}`); f.reset(); } catch (err) { if (err?.message) toast(err.message, true); }
});

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
  f.stato.value = statoSpesa(s); aggiornaEtichettaData();
  f.data.value = s.data; f.categoria.value = s.categoria; f.importo.value = s.importo;
  f.competenza_dal.value = s.competenza_dal || ''; f.competenza_al.value = s.competenza_al || ''; f.descrizione.value = s.descrizione || '';
  f.dataset.id = s.id;
  $('#sp-form-title').textContent = 'Modifica spesa';
  f.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function aggiornaEtichettaData() { $('#lbl-data').textContent = ETICHETTA_DATA[$('#sel-stato').value] || ETICHETTA_DATA.pagata; }
$('#sel-stato').addEventListener('change', aggiornaEtichettaData);
$('#f-spesa').addEventListener('reset', (e) => { delete e.target.dataset.id; $('#sp-form-title').textContent = 'Nuova spesa'; setTimeout(aggiornaEtichettaData, 0); });
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
    const stato = fd.get('stato');
    const rec = { ...(prev || {}), id, stato, scadenza: stato === 'pagata' ? prev?.scadenza : fd.get('data'), data: fd.get('data'), categoria: fd.get('categoria'), importo: Number(fd.get('importo')),
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

// ---------- Import file del PM ----------
let lastXlsx = null;
let ridisegnaAnteprima = null; // rigenera l'anteprima aperta (es. quando cambia la modalità privacy)
const drop = $('#drop-xlsx');
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) leggiFile(f); });
drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#file-xlsx').click(); } });
$('#file-xlsx').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) leggiFile(f); e.target.value = ''; });

const MAPS_KEY = 'ortigia.maps.v1'; // abbinamenti colonne già confermati, per intestazione
const loadMaps = () => { try { return JSON.parse(localStorage.getItem(MAPS_KEY)) || {}; } catch { return {}; } };
const saveMap = (sig, map) => { try { localStorage.setItem(MAPS_KEY, JSON.stringify({ ...loadMaps(), [sig]: map })); } catch { /* ignore */ } };
const noteBox = (cls, html) => `<div class="note ${cls}" style="margin-top:12px">${html}</div>`;

async function leggiFile(file) {
  lastXlsx = null; $('#xlsx-preview').innerHTML = ''; $('#attr-toolbar').hidden = true;
  if (/\.(pdf|png|jpe?g)$/i.test(file.name)) return previewAllegato(file);
  await readXlsx(file);
}

async function readXlsx(file) {
  if (!window.XLSX) { toast('Libreria Excel non ancora caricata, riprova tra un attimo.', true); return; }
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    const r = riconosci(rows);
    lastXlsx = { rows, file, r };
    if (r.tipo === 'export') { $('#attr-toolbar').hidden = false; previewXlsx(rows, file); return; }
    if (r.tipo === 'resoconto') { previewResoconto(rows, file, r); return; }
    // formato nuovo: provo con un abbinamento già confermato in passato
    const riga = r.riga >= 0 ? r.riga : rows.findIndex((x) => (x || []).filter((c) => c != null && c !== '').length >= 3);
    if (riga < 0) { $('#xlsx-preview').innerHTML = noteBox('bad', 'Non trovo nessuna tabella in questo file. È il resoconto del PM?'); return; }
    const headers = rows[riga].map((c) => String(c ?? '').trim());
    const sig = headers.map(strip).join('|');
    const saved = loadMaps()[sig];
    if (saved && saved.in != null && saved.out != null && saved.lordo != null) previewResoconto(rows, file, { tipo: 'resoconto', riga, map: saved, headers }, 'Uso l\'abbinamento delle colonne che avevi confermato per questo formato.');
    else previewMappa(rows, file, { riga, map: r.map, headers, sig });
  } catch (e) { toast(`File non leggibile: ${e.message}`, true); }
}

// Formato non riconosciuto: l'utente abbina le colonne una volta sola
function previewMappa(rows, file, { riga, map, headers, sig }) {
  const opts = (sel) => `<option value="">— non presente —</option>${headers.map((h, i) => (h ? `<option value="${i}" ${sel === i ? 'selected' : ''}>${esc(h)}</option>` : '')).join('')}`;
  $('#xlsx-preview').innerHTML = `<div class="rep"><div class="note warn">Non riconosco questo formato. Ho trovato queste colonne: <strong>${esc(headers.filter(Boolean).join(' · '))}</strong>.<br>Abbina quelle che servono (le prime tre sono indispensabili): me lo ricordo per i prossimi file uguali.</div>
    <div class="map-grid">${CAMPI.map(([key, label, req]) => `<label class="f">${esc(label)}${req ? ' *' : ''}<select data-map="${key}">${opts(map[key])}</select></label>`).join('')}</div>
    <div class="actions"><button class="btn primary" id="map-go">Usa questo abbinamento</button><button class="btn ghost" id="map-cancel">Annulla</button></div></div>`;
  $('#map-cancel').onclick = () => { $('#xlsx-preview').innerHTML = ''; lastXlsx = null; };
  $('#map-go').onclick = () => {
    const m = {}; $$('#xlsx-preview select[data-map]').forEach((sel) => { if (sel.value !== '') m[sel.dataset.map] = Number(sel.value); });
    if (m.in == null || m.out == null || m.lordo == null) return toast('Servono almeno arrivo, partenza e importo lordo', true);
    saveMap(sig, m);
    previewResoconto(rows, file, { tipo: 'resoconto', riga, map: m, headers }, 'Abbinamento salvato: la prossima volta non te lo chiederò.');
  };
}

// Resoconto mensile del PM: anteprima con controlli di coerenza, poi importazione come dato definitivo
function previewResoconto(rows, file, r, intro = '') {
  const out = $('#xlsx-preview');
  let p;
  try { p = leggiResoconto(rows, r); } catch (e) { out.innerHTML = noteBox('bad', esc(e.message)); return; }
  if (!p.book.length) { out.innerHTML = noteBox('bad', 'Non trovo prenotazioni sotto le intestazioni: controlla che le date siano compilate.'); return; }
  const sugg = meseSuggerito(p.book, file.name);
  const mesi = new Set(monthsBetween(data.immobile.inizio_gestione, addMonths(currentMonth(), 1)));
  if (sugg) mesi.add(sugg);
  const lista = [...mesi].sort().reverse();
  let mese = sugg || lista[0];

  const render = () => {
    const prev = data.incassi.find((x) => x.mese === mese);
    const rec = costruisciRecord(p, mese);
    const checks = controlla(p, { mese, feePct: data.pm.fee, rogito: data.immobile.rogito, esistente: prev });
    const netto = (p.totali.netto ?? p.somma.netto);
    const fee = rec.fee_pm ?? feePM(data, rec.lordo, rec.commissioni);
    const dovuto = rec.dovuto_pm ?? Math.round((rec.lordo - rec.commissioni - fee - rec.spese_pm) * 100) / 100;
    const warn = checks.filter((c) => c.livello === 'warn').length;
    const ic = { ok: '✅', warn: '⚠️', info: 'ℹ️' };
    out.innerHTML = `<div class="rep">
      ${intro ? `<p class="fine" style="margin:0 0 8px">${esc(intro)}</p>` : ''}
      <div class="rep-head"><h3>Resoconto PM · mese</h3>
        <select id="rep-mese" aria-label="Mese del resoconto">${lista.map((m) => `<option value="${m}" ${m === mese ? 'selected' : ''}>${monthLabel(m, true)}${monthDiff(data.immobile.inizio_gestione, m) < 0 ? ' (prima della gestione)' : ''}</option>`).join('')}</select>
        <span class="badge ok">formato riconosciuto</span></div>
      <div class="rep-sum">
        <div><span>Lordo</span><strong>${eur(rec.lordo, 2)}</strong></div>
        <div><span>Portali</span><strong>${eur(rec.commissioni, 2)}</strong></div>
        <div><span>Fee PM${netto ? ` (${pct(fee / netto)} del netto)` : ''}</span><strong>${eur(fee, 2)}</strong></div>
        <div><span>Spese extra PM</span><strong>${eur(rec.spese_pm, 2)}</strong></div>
        <div><span>Importo per te</span><strong>${eur(dovuto, 2)}</strong></div>
        <div><span>Notti · prenotazioni</span><strong>${rec.notti} · ${rec.prenotazioni}</strong></div>
      </div>
      <ul class="checks">${checks.map((c) => `<li class="lv-${c.livello}"><span class="ic" aria-hidden="true">${ic[c.livello]}</span><span><span class="sr-only">${{ ok: 'Ok', warn: 'Attenzione', info: 'Nota' }[c.livello]}: </span>${esc(maskText(c.testo))}</span></li>`).join('')}</ul>
      <details class="box"><summary>Prenotazioni (${p.book.length})</summary><p class="fine">I nomi degli ospiti non vengono salvati.</p>
        <div class="table-wrap"><table><thead><tr><th>Canale</th><th>Arrivo</th><th>Partenza</th><th class="n">Notti</th><th class="n">Lordo</th><th class="n">Portali (% lordo)</th><th class="n">Fee PM (% netto)</th></tr></thead><tbody>
        ${p.book.map((b) => `<tr><td>${esc(b.canale)}</td><td>${b.check_in.split('-').reverse().join('/')}</td><td>${b.check_out.split('-').reverse().join('/')}</td><td class="n">${b.notti}</td><td class="n">${eur(b.lordo, 2)}</td><td class="n">${eur(b.commissioni, 2)} <small>${pct(b.lordo ? b.commissioni / b.lordo : 0)}</small></td><td class="n">${b.fee != null ? `${eur(b.fee, 2)} <small>${pct(b.lordo - b.commissioni ? b.fee / (b.lordo - b.commissioni) : 0)}</small>` : '—'}</td></tr>`).join('')}
        </tbody></table></div></details>
      <div class="actions"><button class="btn primary" id="rep-go" ${monthDiff(data.immobile.inizio_gestione, mese) < 0 ? 'disabled' : ''}>Importa come definitivo${warn ? ` (${warn} da verificare)` : ''}</button><button class="btn ghost" id="rep-cancel">Annulla</button></div></div>`;
    $('#rep-mese').onchange = (e) => { mese = e.target.value; render(); };
    $('#rep-cancel').onclick = () => { out.innerHTML = ''; lastXlsx = null; ridisegnaAnteprima = null; };
    $('#rep-go').onclick = async () => {
      if (prev?.stato === 'definitivo' && !confirm(`${monthLabel(mese, true)} è già definitivo: lo sostituisco con questo resoconto?`)) return;
      try {
        const path = await uploadFile(file, `resoconti/${mese}`);
        const merged = { ritenuta: 0, bonifico: null, ...(prev || {}), ...rec,
          nota: prev?.stato === 'definitivo' ? (prev.nota || '') : '',
          allegati: [...new Set([...(prev?.allegati || []), ...(path ? [path] : [])])] };
        data.incassi = data.incassi.filter((x) => x.mese !== mese).concat(merged);
        await persist(`Resoconto PM ${mese}`);
        $('#xlsx-preview').innerHTML = noteBox('', `${monthLabel(mese, true)} importato come <strong>definitivo</strong>. Quando arriva il bonifico, apri il mese con "Modifica" e inserisci l'importo ricevuto: se coincide con ${eur(dovuto, 2)} comparirà ✓.`);
        lastXlsx = null; ridisegnaAnteprima = null;
      } catch (err) { if (err?.message) toast(err.message, true); }
    };
  };
  ridisegnaAnteprima = render;
  render();
}

// Fatture e PDF: non si leggono, si allegano a un mese
function previewAllegato(file) {
  const mesi = data.incassi.map((x) => x.mese).sort().reverse();
  const out = $('#xlsx-preview');
  if (!mesi.length) { out.innerHTML = noteBox('warn', 'Registra prima almeno un mese (carica il resoconto Excel o inseriscilo a mano), poi potrai allegarci le fatture.'); return; }
  out.innerHTML = `<div class="rep"><p class="prose"><strong>${esc(file.name)}</strong>: file non leggibile come dati, lo allego a un mese.</p>
    <div class="row" style="grid-template-columns:repeat(auto-fit,minmax(12rem,1fr))">
      <label class="f">Mese<select id="all-mese">${mesi.map((m) => `<option value="${m}">${monthLabel(m, true)}</option>`).join('')}</select></label>
      <label class="f">Tipo<select id="all-tipo"><option value="fattura-pm">Fattura del PM</option><option value="estratto-conto">Estratto conto</option><option value="altro">Altro</option></select></label></div>
    <div class="actions"><button class="btn primary" id="all-go">Allega</button><button class="btn ghost" id="all-cancel">Annulla</button></div></div>`;
  $('#all-cancel').onclick = () => { out.innerHTML = ''; };
  $('#all-go').onclick = async () => {
    const mese = $('#all-mese').value; const tipo = $('#all-tipo').value;
    try {
      const path = await uploadFile(file, `${mese}/${tipo}`);
      const rec = data.incassi.find((x) => x.mese === mese);
      rec.allegati = [...new Set([...(rec.allegati || []), path])];
      await persist(`Allegato ${tipo} ${mese}`);
      out.innerHTML = noteBox('', `Allegato a ${monthLabel(mese, true)}.`);
    } catch (err) { if (err?.message) toast(err.message, true); }
  };
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
  $('#xlsx-preview').innerHTML = `<p class="ink2" style="font-size:var(--fs-sm);margin:14px 0 8px">${book.length} prenotazioni lette da <strong>${esc(file.name)}</strong>. Seleziona i mesi da importare (quelli precedenti alla gestione sono esclusi).</p>
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
          notti: g.reduce((s, b) => s + b.notti, 0), prenotazioni: g.length, dettaglio: g, importato: today(),
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
  ['quotaBooking', 'Quota Booking (% del lordo)', 0, 100, 1, () => `trattiene ${pct(data.pm?.tariffe_portali?.Booking ?? 0)}`],
  ['quotaAirbnb', 'Quota Airbnb (% del lordo)', 0, 100, 1, (v) => `trattiene ${pct(data.pm?.tariffe_portali?.Airbnb ?? 0)} · diretta ${nf0.format(Math.max(0, 100 - Number(ui.sim.quotaBooking) - v))}%`],
  ['feePct', 'Fee property manager (% del netto dopo i portali)', 0, 45, 0.5, null],
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
    const pr = P[k]; Object.assign(ui.sim, { preset: k, notti: pr.notti, adr: pr.adr, commPct: pr.commPct, quotaBooking: pr.quotaBooking, quotaAirbnb: pr.quotaAirbnb }); saveUI(); renderSimulatore();
  });
  $('#preset-reale').onclick = () => {
    const reg = registro(data, fineAnalisi(), { stime: true });
    const R = reg.righe.filter((r) => r.inc).slice(-12);
    if (!R.length) return toast('Nessun incasso reale registrato', true);
    const w = stagionalita(data.storico);
    const quota = R.reduce((s, r) => s + w[Number(r.mese.slice(5, 7)) - 1], 0);
    const notti = R.reduce((s, r) => s + r.notti, 0); const L = R.reduce((s, r) => s + r.lordo, 0);
    // mix reale dei canali (sul lordo) dai resoconti con il dettaglio delle prenotazioni; altrimenti resta quello attuale
    const per = datiCanali(R); const Lc = Object.values(per).reduce((x, c) => x + c.lordo, 0);
    const mixReale = Lc > 0 ? { quotaBooking: Math.round((per.Booking?.lordo || 0) / Lc * 1000) / 10, quotaAirbnb: Math.round((per.Airbnb?.lordo || 0) / Lc * 1000) / 10 } : {};
    Object.assign(ui.sim, { preset: 'reale', notti: Math.round(notti / quota), adr: Math.round(L / (notti || 1)), ...mixReale });
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
    <p class="muted" id="sim-comm" style="font-size:var(--fs-sm);margin:4px 0 10px"></p>
    <label class="f">Base cedolare<select id="sim-cedbase"><option value="lordo">lordo pagato dall'ospite</option><option value="netto_portali">netto commissioni portali</option></select></label>
    <details class="box"><summary>Dettaglio costi fissi dal budget</summary><dl class="kv" style="font-size:var(--fs-sm)">${data.budget.map((b) => `<dt>${esc(b.voce)}${b.certo ? '' : ' <span class="badge">stima</span>'}</dt><dd>${eur(b.annuo)}</dd>`).join('')}<dt class="tot">Totale</dt><dd class="tot">${eur(costiAnnuiBudget())}</dd></dl>
      <button class="btn small" type="button" id="sim-costi-reset" style="margin-top:8px">Usa il totale del budget</button></details>
    <div class="actions"><button class="btn primary" id="sim-save" type="button">Usa questo scenario in Panoramica</button><button class="btn ghost" id="sim-reset" type="button">Ripristina</button></div>`;
  $('#sim-cedbase').value = s.cedBase;
  $('#sim-cedbase').onchange = (e) => { s.cedBase = e.target.value; s.preset = s.preset; saveUI(); updateSim(); };
  $$('#sim-inputs input[data-k]').forEach((inp) => inp.addEventListener('input', () => {
    const k = inp.dataset.k; let v = Number(inp.value); if (Number.isNaN(v)) return;
    $$(`#sim-inputs input[data-k="${k}"]`).forEach((o) => { if (o !== inp) o.value = inp.value; });
    if (inp.hasAttribute('data-pct')) v /= 100;
    if (k === 'quotaBooking' || k === 'quotaAirbnb') { // Booking + Airbnb non superano il 100% (il resto è prenotazione diretta)
      const altro = Number(s[k === 'quotaBooking' ? 'quotaAirbnb' : 'quotaBooking']);
      if (v + altro > 100) { v = 100 - altro; $$(`#sim-inputs input[data-k="${k}"]`).forEach((o) => { o.value = v; }); }
    }
    s[k] = v; if (['notti', 'adr', 'quotaBooking', 'quotaAirbnb'].includes(k)) { s.preset = 'custom'; $$('#seg-preset button').forEach((b) => b.setAttribute('aria-pressed', 'false')); }
    const f = SIM_FIELDS.find((x) => x[0] === k); if (f[5]) $(`#h-${k}`).textContent = f[5](v);
    if (k === 'quotaBooking' && $('#h-quotaAirbnb')) $('#h-quotaAirbnb').textContent = SIM_FIELDS.find((x) => x[0] === 'quotaAirbnb')[5](Number(s.quotaAirbnb));
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
  const el = $('#sim-comm');
  if (el) {
    const tar = data.pm?.tariffe_portali || {}; const pmSuLordo = p.feePct * (1 - p.commPct / 100);
    el.innerHTML = `Commissione media dei portali: <strong>${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(p.commPct)}% del lordo</strong> (Booking ${pct(tar.Booking ?? 0)} e Airbnb ${pct(tar.Airbnb ?? 0)} sulle rispettive quote). Il property manager prende il ${nf0.format(p.feePct)}% del netto di ogni soggiorno, cioè circa il ${new Intl.NumberFormat('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pmSuLordo)}% del lordo: cambia con il mix dei canali.`;
  }
  const sim = runScenario({ ...p, anni: 30 });
  const view = sim.slice(0, p.anni * 12);
  // primi 12 mesi CON la rata (dalla prima rata): un anno intero di rate, più il preammortamento una tantum.
  // Il primo anno solare di gestione ha meno rate e darebbe un cash flow troppo ottimista.
  const m0 = Math.max(0, monthDiff(data.immobile.inizio_gestione, data.mutuo.prima_rata.slice(0, 7)));
  const y1 = sim.slice(m0, m0 + 12);
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
    ['Cash flow medio mensile (12 mesi di rata)', eurS(cfY1 / 12), `annuo ${eurS(cfY1)}`, cls(cfY1), 'simCf'],
    ['Rendimento netto su prezzo', pct(noiY1 / data.immobile.prezzo), `cash-on-cash ${pct(cfY1 / cap)}`, cls(noiY1), 'simRend'],
    ['Breakeven di cassa', bc ? monthLabel(bc, true) : 'oltre 30 anni', bc ? when(bc) : 'il CF cumulato non recupera il capitale', '', 'simBc'],
    ['Breakeven patrimoniale', bp ? monthLabel(bp, true) : 'oltre 30 anni', bp ? when(bp) : 'con questi parametri', '', 'simBp'],
  ];
  info.setCtx('sim', { p, cfY1, noiY1, cap, Lbe, lordoY1, servizio, data });
  $('#sim-kpi').innerHTML = tiles.map(([l, v, s2, c, key]) => `<div class="card tile"><div class="t-label"><span>${l}</span>${info.btn(key, l, 'sim')}</div><div class="t-value ${c}">${v}</div><div class="t-sub">${s2}</div></div>`).join('')
    + `<div class="card tile" style="grid-column:1/-1"><div class="t-label"><span>Lordo annuo per avere cash flow zero</span>${info.btn('simBe', 'Lordo annuo per avere cash flow zero', 'sim')}</div><div class="t-value">${eur(Lbe)}</div>
       <div class="t-sub">≈ ${nf0.format(Lbe / p.adr)} notti a ${eur(p.adr)} · scenario attuale: ${eur(lordoY1)} lordi (${lordoY1 >= Lbe ? '<span class="pos">sopra</span>' : '<span class="neg">sotto</span>'} la soglia di ${eur(Math.abs(lordoY1 - Lbe))})</div></div>`;

  // Confronti con storico
  const P = presets(data);
  const cmpColors = { 2024: css('--s3'), 2025: css('--s4'), 2026: css('--s5'), media: css('--s7') };
  $('#cmp-chips').innerHTML = '<span class="lbl">Confronta con</span>' + Object.entries(P).map(([k, v]) => `<label class="chip ${ui.cmp[k] ? '' : 'off'}" style="color:${cmpColors[k]}"><input type="checkbox" data-c="${k}" ${ui.cmp[k] ? 'checked' : ''}><span class="sw"></span><span style="color:var(--ink-2)">${v.label}</span></label>`).join('');
  $$('#cmp-chips input').forEach((i) => i.addEventListener('change', () => { ui.cmp[i.dataset.c] = i.checked; saveUI(); updateSim(); }));
  const s1 = css('--s1'); const s2c = css('--s2');
  const nVis = renderFinestra('#sim-range', 'sim', p.anni, addMonths(data.immobile.inizio_gestione, p.anni * 12 - 1).slice(0, 4), updateSim);
  const vis = view.slice(0, nVis);
  const ds = [
    { label: 'Posizione netta', data: vis.map((r) => Math.round(r.posizione)), borderColor: s1, backgroundColor: s1, borderWidth: 2, pointRadius: 0, tension: 0.2 },
    { label: 'Cash flow cumulato', data: vis.map((r) => Math.round(r.cfCum)), borderColor: s2c, backgroundColor: s2c, borderWidth: 2, pointRadius: 0, tension: 0.2 },
  ];
  const leg = [[s1, 'Posizione netta'], [s2c, 'Cash flow cumulato']];
  for (const [k, on] of Object.entries(ui.cmp)) {
    if (!on || !P[k]) continue;
    const alt = runScenario({ ...p, notti: P[k].notti, adr: P[k].adr, commPct: P[k].commPct, anni: p.anni });
    ds.push({ label: `Posizione netta · ${P[k].label}`, data: alt.slice(0, nVis).map((r) => Math.round(r.posizione)), borderColor: cmpColors[k], backgroundColor: cmpColors[k], borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.2 });
    leg.push([cmpColors[k], `Posizione netta · ${P[k].label}`, true]);
  }
  const iBpS = view.findIndex((r) => r.posizione >= 0); const iBcS = view.findIndex((r) => r.cfCum >= cap);
  for (const [lab, idx, ser, col] of [['Breakeven patrimoniale', iBpS, view.map((r) => r.posizione), s1], ['Breakeven di cassa', iBcS, view.map((r) => r.cfCum), s2c]]) {
    const d = puntoBreakeven(lab, idx, ser, col); d.data = d.data.slice(0, nVis);
    if (d.data.some((x) => x != null)) ds.push(d);
  }
  chart('c-sim', {
    type: 'line', data: { labels: vis.map((r) => monthLabel(r.mese)), datasets: ds },
    options: opzioniTempo(vis.map((r) => r.mese)),
  });
  $('#sim-legend').innerHTML = legendHTML(leg) + `<span><i style="background:${css('--muted')};transform:rotate(45deg);border-radius:2px;width:9px;height:9px"></i>breakeven</span>`;

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
  opt.scales.y.ticks.display = true; // dati di mercato pubblici: sempre visibili
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
  const onPages = location.hostname.endsWith('.github.io');
  settingsMode ??= cfg.token ? cfg.mode : (onPages ? 'github' : (cfg.mode || 'local'));
  const f = $('#f-src');
  const defaults = { owner: onPages ? location.hostname.split('.')[0] : '', repo: 'ortigia-data', branch: 'main', path: 'ledger.json' };
  ['owner', 'repo', 'branch', 'path'].forEach((k) => { f[k].value = cfg[k] || defaults[k]; });
  f.token.value = '';
  f.token.placeholder = cfg.token ? `token salvato (…${cfg.token.slice(-4)}) · lascia vuoto per mantenerlo` : 'github_pat_…';
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
      <label class="f">Data prima rata<input type="date" name="prima_rata" value="${data.mutuo.prima_rata}"></label>
      <label class="f">Preammortamento nella prima rata (€)<input type="number" step="0.01" name="preamm" value="${data.mutuo.preammortamento || 0}"></label>
      <label class="f">Inizio gestione<input type="month" name="inizio" value="${data.immobile.inizio_gestione}"></label>
    </div>
    <h3 style="margin:18px 0 8px">Budget costi annui</h3>
    <div class="table-wrap"><table><thead><tr><th>Voce</th><th>Categoria</th><th class="n">€ / anno</th><th>Certo</th><th>Dal</th></tr></thead><tbody>
    ${b.map((x, i) => `<tr><td><input name="b_voce_${i}" value="${esc(x.voce)}"></td><td>${esc(CATEGORIE[x.categoria] || x.categoria)}</td><td><input type="number" step="0.01" name="b_annuo_${i}" value="${x.annuo}" style="width:110px;text-align:right"></td>
      <td><input type="checkbox" name="b_certo_${i}" ${x.certo ? 'checked' : ''} aria-label="certo"></td><td><input type="month" name="b_dal_${i}" value="${x.dal || ''}" style="width:150px"></td></tr>`).join('')}
    </tbody></table></div>
    <p class="fine">"Certo" = costo fisso conosciuto (polizza, internet): conteggiato sempre. Non certo = stima: si può escludere con "Includi costi stimati". In entrambi i casi, quando registri una bolletta reale per quella categoria, nei mesi coperti vale la bolletta.</p>
    <div class="note" style="margin-top:10px">${esc(data.pm.note)}<br>${esc(data.fiscale.note)}</div>`;
  const fp = $('#f-param'); fp.pm_base.value = data.pm.base; fp.ced_base.value = data.fiscale.base;
}
$('#f-src').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target; const old = getConfig();
  const cfg = { mode: settingsMode, owner: f.owner.value.trim(), repo: f.repo.value.trim(), branch: f.branch.value.trim() || 'main', path: f.path.value.trim() || 'ledger.json',
    token: (() => { const v = f.token.value.trim(); if (!v) return old.token; const m = v.match(/(github_pat_\w+|gh[pousr]_\w+)/); return m ? m[1] : v; })() };
  if (cfg.mode === 'github' && (!cfg.owner || !cfg.repo || !cfg.token)) return toast('Compila utente, repository e token', true);
  if (cfg.mode === 'github') {
    const out = $('#src-check');
    const line = (ok, txt) => `<div>${ok ? '✅' : '❌'} ${txt}</div>`;
    out.className = 'note'; out.innerHTML = 'Verifica del token in corso…';
    const tk = cfg.token;
    const desc = `token ${f.token.value.trim() ? 'incollato ora' : 'già salvato'}: inizia con "${esc(tk.slice(0, 11))}", finisce con "…${esc(tk.slice(-4))}", ${tk.length} caratteri`;
    const h = { Authorization: `Bearer ${tk}`, Accept: 'application/vnd.github+json' };
    try {
      const u = await fetch('https://api.github.com/user', { headers: h });
      if (!u.ok) {
        out.className = 'note bad';
        out.innerHTML = line(false, `GitHub non riconosce il token (${desc}).`)
          + '<div style="margin-top:6px">Un token fine-grained è lungo circa 93 caratteri e inizia con <code>github_pat_</code>. Se hai premuto "Regenerate", il codice valido è solo l\'ultimo generato: rigeneralo una volta, copialo per intero e incollalo qui.</div>';
        return;
      }
      const login = (await u.json()).login;
      const r = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, { headers: h });
      if (!r.ok) {
        out.className = 'note bad';
        out.innerHTML = line(true, `Token valido (utente ${esc(login)})`) + line(false, `Il token non ha accesso a ${esc(cfg.owner)}/${esc(cfg.repo)}: in GitHub → token → Edit → Repository access seleziona ortigia-data e premi Update.`);
        return;
      }
      const c = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${cfg.branch}`, { headers: h });
      if (!c.ok) {
        out.className = 'note bad';
        out.innerHTML = line(true, `Token valido (utente ${esc(login)})`) + line(true, 'Repository accessibile') + line(false, `File ${esc(cfg.path)} non leggibile: imposta Contents su "Read and write" nel token.`);
        return;
      }
      out.className = 'note'; out.innerHTML = line(true, `Token valido (utente ${esc(login)})`) + line(true, 'Repository accessibile') + line(true, 'Dati trovati, ricarico…');
    } catch (err) { out.className = 'note bad'; out.textContent = `Errore di rete: ${err.message}`; return; }
  }
  setConfig(cfg); setTimeout(() => location.reload(), 600);
});
$('#f-param').addEventListener('submit', async (e) => {
  e.preventDefault(); const f = e.target;
  data.pm.fee = Number(f.pm_fee.value) / 100; data.pm.base = f.pm_base.value;
  data.fiscale.cedolare = Number(f.ced.value) / 100; data.fiscale.base = f.ced_base.value;
  data.mutuo.rata = Number(f.rata.value); data.mutuo.spese_incasso = Number(f.spese_incasso.value);
  data.mutuo.prima_rata = f.prima_rata.value || data.mutuo.prima_rata; data.mutuo.preammortamento = Number(f.preamm.value) || 0;
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

// Aggiorna i dati (nell'app installata non c'è il pulsante ricarica del browser)
$('#refresh-btn').addEventListener('click', async () => {
  const b = $('#refresh-btn'); b.disabled = true; b.style.opacity = '.5';
  setStatus('busy', 'Aggiornamento…');
  try {
    const fresh = await store.load();
    if (fresh) { data = fresh; migrate(); }
    setStatus(store.offline ? 'busy' : 'ok', store.label());
    if (data) { renderAll(); requestAnimationFrame(() => ({ panoramica: renderPanoramica, simulatore: updateSim, mercato: renderMercato }[ui.view]?.())); }
    toast(store.offline ? 'Sei offline: mostro gli ultimi dati scaricati' : 'Dati aggiornati');
  } catch (e) { setStatus('err', 'Errore'); toast(e.message, true); }
  b.disabled = false; b.style.opacity = '';
});

// App installabile (PWA): registra il service worker solo su https
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => { /* non bloccante */ });
}

// Avvio quando Chart.js è pronto (script defer)
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
