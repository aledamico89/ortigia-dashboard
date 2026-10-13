// Motore di calcolo: piano di ammortamento, registro mensile, KPI, simulazioni.
// Funzioni pure: nessun accesso al DOM o alla rete.

export const CATEGORIE = {
  assicurazione: 'Assicurazione',
  internet: 'Internet',
  luce: 'Luce',
  acqua: 'Acqua',
  tari: 'TARI',
  imu: 'IMU',
  manutenzione: 'Manutenzione',
  commercialista: 'Commercialista',
  arredi: 'Arredi e dotazioni',
  altro: 'Altro',
  cedolare: 'Cedolare secca versata (F24)',
  rimborso_anticipato: 'Rimborso anticipato mutuo',
};
// Categorie che non sono costi operativi (gestite a parte)
export const NON_COSTI = ['cedolare', 'rimborso_anticipato'];

const r2 = (x) => Math.round(x * 100) / 100;

// ---------- Date helpers (chiave mese = 'YYYY-MM') ----------
export const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
export function addMonths(key, n) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return monthKey(d);
}
export function monthDiff(a, b) { // b - a in mesi
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}
export function monthsBetween(a, b) {
  const out = [];
  for (let k = a; monthDiff(k, b) >= 0; k = addMonths(k, 1)) out.push(k);
  return out;
}
export const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
export const monthLabel = (key, long = false) => {
  const [y, m] = key.split('-').map(Number);
  return long ? `${MESI[m - 1]} ${y}` : `${MESI[m - 1]} ${String(y).slice(2)}`;
};

// ---------- Mutuo ----------
export function pmt(capitale, tassoMensile, n) {
  if (tassoMensile === 0) return capitale / n;
  return capitale * tassoMensile / (1 - Math.pow(1 + tassoMensile, -n));
}

/**
 * Piano di ammortamento alla francese. `extra` = [{mese, importo}] rimborsi anticipati:
 * dopo un rimborso la rata viene ricalcolata sulla durata residua (riduzione rata).
 * Ritorna mappa mese -> {n, rata, interessi, capitale, spese, preamm, extra, debito}
 */
export function pianoMutuo(mutuo, extra = []) {
  const i = mutuo.tan / 12;
  const n = mutuo.anni * 12;
  let rata = mutuo.rata || r2(pmt(mutuo.importo, i, n));
  let debito = mutuo.importo;
  const start = mutuo.prima_rata.slice(0, 7);
  const extraByMonth = {};
  for (const e of extra) extraByMonth[e.mese] = (extraByMonth[e.mese] || 0) + e.importo;
  const piano = new Map();
  for (let k = 0; k < n && debito > 0.005; k++) {
    const mese = addMonths(start, k);
    const interessi = r2(debito * i);
    let capitale = r2(rata - interessi);
    if (capitale > debito || k === n - 1) capitale = r2(debito);
    debito = r2(debito - capitale);
    let ex = 0;
    if (extraByMonth[mese]) {
      ex = Math.min(extraByMonth[mese], debito);
      debito = r2(debito - ex);
      const residue = n - k - 1;
      if (residue > 0 && debito > 0) rata = r2(pmt(debito, i, residue));
    }
    piano.set(mese, {
      n: k + 1, rata: r2(interessi + capitale), interessi, capitale,
      spese: mutuo.spese_incasso || 0,
      preamm: k === 0 ? (mutuo.preammortamento || 0) : 0,
      extra: ex, debito,
    });
  }
  return piano;
}

export function debitoAl(mutuo, piano, mese) {
  let deb = mutuo.importo;
  for (const [m, row] of piano) { if (monthDiff(m, mese) >= 0) deb = row.debito; else break; }
  return deb;
}

// ---------- Capitale proprio ----------
export const capitaleProprio = (data) => data.acquisto.reduce((s, x) => s + Number(x.importo || 0), 0);
// Costi di transazione = esborso non recuperato dall'equity (capitale proprio - anticipo sul prezzo)
export const costiTransazione = (data) => capitaleProprio(data) - (data.immobile.prezzo - data.mutuo.importo);

// ---------- Fee PM e cedolare ----------
export function feePM(data, lordo, commissioni) {
  const base = data.pm.base === 'lordo' ? lordo : lordo - commissioni;
  return r2(base * data.pm.fee);
}
export function cedolare(data, lordo, commissioni) {
  const base = data.fiscale.base === 'netto_portali' ? lordo - commissioni : lordo;
  return r2(base * data.fiscale.cedolare);
}

// ---------- Allocazione spese per competenza ----------
function allocaSpese(spese) {
  // mese -> categoria -> importo ; e set dei mesi coperti per categoria
  const alloc = {}; const coperti = {};
  for (const s of spese) {
    if (NON_COSTI.includes(s.categoria)) continue;
    const dal = s.competenza_dal || s.data.slice(0, 7);
    const al = s.competenza_al || dal;
    const mesi = monthsBetween(dal, al);
    const quota = Number(s.importo) / mesi.length;
    for (const m of mesi) {
      alloc[m] ??= {};
      alloc[m][s.categoria] = (alloc[m][s.categoria] || 0) + quota;
      (coperti[s.categoria] ??= new Set()).add(m);
    }
  }
  return { alloc, coperti };
}

/**
 * Registro mensile reale dall'inizio della gestione fino a `fine` (incluso).
 * opts.stime: includi i costi stimati (budget non certi) nei mesi non coperti da spese reali.
 */
export function registro(data, fine, opts = { stime: true }) {
  const inizio = data.immobile.inizio_gestione;
  const extra = data.spese.filter((s) => s.categoria === 'rimborso_anticipato')
    .map((s) => ({ mese: s.data.slice(0, 7), importo: Number(s.importo) }));
  const piano = pianoMutuo(data.mutuo, extra);
  const { alloc, coperti } = allocaSpese(data.spese);
  const incassi = Object.fromEntries(data.incassi.map((x) => [x.mese, x]));
  const righe = [];
  let debito = data.mutuo.importo;
  for (const mese of monthsBetween(inizio, fine)) {
    const inc = incassi[mese];
    const lordo = inc ? Number(inc.lordo || 0) : 0;
    const comm = inc ? Number(inc.commissioni || 0) : 0;
    const fee = inc ? (inc.fee_pm != null && inc.fee_pm !== '' ? Number(inc.fee_pm) : feePM(data, lordo, comm)) : 0;
    const ced = cedolare(data, lordo, comm);
    const costi = {}; let costiTot = 0; let costiStimati = 0;
    // spese reali
    for (const [cat, v] of Object.entries(alloc[mese] || {})) { costi[cat] = { importo: v, stimato: false }; costiTot += v; }
    // budget per categorie non coperte
    for (const b of data.budget) {
      if (b.dal && monthDiff(b.dal, mese) < 0) continue;
      if (b.al && monthDiff(mese, b.al) < 0) continue;
      if (coperti[b.categoria]?.has(mese)) continue;
      if (!b.certo && !opts.stime) continue;
      const v = Number(b.annuo || 0) / 12;
      if (!v) continue;
      costi[b.categoria] = { importo: (costi[b.categoria]?.importo || 0) + v, stimato: !b.certo };
      costiTot += v; if (!b.certo) costiStimati += v;
    }
    const p = piano.get(mese);
    const interessi = p ? p.interessi + p.preamm : 0;
    const capitale = p ? p.capitale : 0;
    const speseMutuo = p ? p.spese : 0;
    const rimborsoExtra = p ? p.extra : 0;
    if (p) debito = p.debito;
    const nettoPM = lordo - comm - fee;
    const noi = nettoPM - ced - costiTot; // reddito operativo netto dopo tasse, prima del mutuo
    const servizio = interessi + capitale + speseMutuo;
    const cf = noi - servizio; // cash flow netto (esclusi rimborsi anticipati volontari)
    righe.push({
      mese, inc, lordo, comm, fee, nettoPM, ced, costi, costiTot, costiStimati, noi,
      interessi, capitale, speseMutuo, servizio, rimborsoExtra, cf, debito,
      notti: inc ? Number(inc.notti || 0) : 0,
      ritenuta: inc ? Number(inc.ritenuta || 0) : 0,
    });
  }
  return { righe, piano };
}

// ---------- KPI ----------
export function valoreImmobile(data, mese, modo) {
  const prezzo = data.immobile.prezzo;
  if (modo === 'mercato') {
    const ref = data.mercato.mensile.find((x) => x[0] === data.mercato.riferimento_rogito)?.[1];
    const last = [...data.mercato.mensile].filter((x) => monthDiff(x[0], mese) >= 0).pop()?.[1];
    if (ref && last) return Math.round(prezzo * last / ref);
  }
  if (modo === 'stima') {
    const v = [...(data.valutazioni || [])].filter((x) => monthDiff(x.data.slice(0, 7), mese) >= 0).pop();
    if (v) return Number(v.valore);
  }
  return prezzo;
}

export function kpi(data, reg, modoValore = 'nominale') {
  const R = reg.righe;
  const n = R.length || 1;
  const sum = (f) => R.reduce((s, r) => s + f(r), 0);
  const cap = capitaleProprio(data);
  const trans = costiTransazione(data);
  const last = R[R.length - 1];
  const debito = last ? last.debito : data.mutuo.importo;
  const valore = valoreImmobile(data, last?.mese || data.immobile.inizio_gestione, modoValore);
  const cfCum = sum((r) => r.cf);
  const noiCum = sum((r) => r.noi);
  const capRimb = data.mutuo.importo - debito;
  const rival = valore - data.immobile.prezzo;
  const posizione = (valore - debito) + cfCum - cap; // >=0 = breakeven patrimoniale
  const tasseMaturate = sum((r) => r.ced);
  const ritenute = sum((r) => r.ritenuta);
  const tassePagate = data.spese.filter((s) => s.categoria === 'cedolare').reduce((s, x) => s + Number(x.importo), 0);
  return {
    mesi: R.length, cap, trans, debito, valore, cfCum, noiCum, capRimb, rival, posizione,
    lordo: sum((r) => r.lordo), comm: sum((r) => r.comm), fee: sum((r) => r.fee),
    ced: tasseMaturate, costi: sum((r) => r.costiTot), costiStimati: sum((r) => r.costiStimati),
    interessi: sum((r) => r.interessi), capitale: sum((r) => r.capitale), speseMutuo: sum((r) => r.speseMutuo),
    notti: sum((r) => r.notti),
    rendNetto: (noiCum * 12 / n) / data.immobile.prezzo,
    cashOnCash: (cfCum * 12 / n) / cap,
    roiTot: (cfCum + capRimb + rival) / cap,
    roiTotAnn: ((cfCum + capRimb + rival) * 12 / n) / cap,
    recuperoCassa: cfCum / cap,
    recuperoPatr: (cfCum + capRimb + rival) / trans,
    tasseDaAccantonare: tasseMaturate - ritenute - tassePagate,
    ritenute, equity: valore - debito, ltv: debito / valore,
  };
}

// ---------- Simulatore ----------
export function stagionalita(storico) {
  const w = Array(12).fill(0);
  for (const y of ['2024', '2025']) storico[y]?.notti.forEach((v, i) => { w[i] += v; });
  const s26 = storico['2026']?.notti || [];
  s26.forEach((v, i) => { if (i < 10) w[i] += v; else w[i] += (w[i] / 2); });
  const tot = w.reduce((a, b) => a + b, 0) || 12;
  return w.map((v) => v / tot);
}

export function presets(data) {
  const st = data.storico;
  const comm26 = st['2026'].commissioni.reduce((a, b) => a + b, 0) / st['2026'].lordo.reduce((a, b) => a + b, 0);
  const commPct = Math.round(comm26 * 1000) / 10;
  const n26 = st['2026'].notti.slice(0, 10).reduce((a, b) => a + b, 0);
  const l26 = st['2026'].lordo.slice(0, 10).reduce((a, b) => a + b, 0);
  // Nov–Dic 2026 stimati come media 2024–2025
  const nd = Math.round(((st['2024'].notti[10] + st['2024'].notti[11]) + (st['2025'].notti[10] + st['2025'].notti[11])) / 2);
  const notti26 = n26 + nd;
  const adr26 = Math.round(l26 / n26);
  const n24 = st['2024'].notti.reduce((a, b) => a + b, 0);
  const n25 = st['2025'].notti.reduce((a, b) => a + b, 0);
  return {
    '2024': { label: '2024', notti: n24, adr: Math.round(st['2024'].lordo_annuo / n24), commPct },
    '2025': { label: '2025', notti: n25, adr: Math.round(st['2025'].lordo_annuo / n25), commPct },
    '2026': { label: '2026 proiettato', notti: notti26, adr: adr26, commPct },
    media: { label: 'Media 24–25', notti: Math.round((n24 + n25) / 2), adr: Math.round((st['2024'].lordo_annuo + st['2025'].lordo_annuo) / (n24 + n25)), commPct },
  };
}

/**
 * Simulazione mensile.
 * p: {notti, adr, commPct, feePct, cedPct, cedBase, costiAnnui, crescitaRicavi, inflazione, rivalutazione, anni, extraAnnuo}
 * start: {mese, debito, cfCum, valore, piano?}
 */
export function simula(data, p, start) {
  const w = stagionalita(data.storico);
  const i = data.mutuo.tan / 12;
  const cap = capitaleProprio(data);
  const fine = addMonths(data.mutuo.prima_rata.slice(0, 7), data.mutuo.anni * 12 - 1);
  let debito = start.debito;
  let rata = null;
  let cfCum = start.cfCum;
  let valore = start.valore;
  const out = [];
  const totMesi = p.anni * 12;
  for (let k = 0; k < totMesi; k++) {
    const mese = addMonths(start.mese, k);
    const anno = Math.floor(k / 12);
    const mi = Number(mese.slice(5, 7)) - 1;
    const g = Math.pow(1 + p.crescitaRicavi, anno);
    const inf = Math.pow(1 + p.inflazione, anno);
    const lordo = p.notti * p.adr * g * w[mi];
    const comm = lordo * p.commPct / 100;
    const fee = (lordo - comm) * p.feePct / 100;
    const ced = (p.cedBase === 'netto_portali' ? lordo - comm : lordo) * p.cedPct / 100;
    const costi = (p.costiAnnui * inf) / 12;
    const noi = lordo - comm - fee - ced - costi;
    let servizio = 0; let capitale = 0;
    const primaRata = data.mutuo.prima_rata.slice(0, 7);
    if (debito > 0 && monthDiff(primaRata, mese) >= 0 && monthDiff(mese, fine) >= 0) {
      const residue = monthDiff(mese, fine) + 1;
      if (rata === null) rata = (start.piano?.get(mese)?.rata) || pmt(debito, i, residue);
      const interessi = debito * i;
      capitale = Math.min(rata - interessi, debito);
      debito -= capitale;
      servizio = interessi + capitale + (data.mutuo.spese_incasso || 0);
      if (mese === primaRata) servizio += data.mutuo.preammortamento || 0;
      if (p.extraAnnuo && mi === 11 && debito > 0) {
        const ex = Math.min(p.extraAnnuo, debito);
        debito -= ex; cfCum -= ex; // il rimborso esce di cassa ma aumenta l'equity
        const res = monthDiff(mese, fine);
        rata = res > 0 ? pmt(debito, i, res) : 0;
      }
    }
    const cf = noi - servizio;
    cfCum += cf;
    valore *= Math.pow(1 + p.rivalutazione, 1 / 12);
    const posizione = (valore - debito) + cfCum - cap;
    out.push({ mese, lordo, comm, fee, ced, costi, noi, servizio, capitale, cf, cfCum, debito, valore, posizione });
  }
  return out;
}

export function sintesiAnnua(sim) {
  const anni = [];
  for (let k = 0; k < sim.length; k += 12) {
    const blk = sim.slice(k, k + 12);
    const s = (f) => blk.reduce((a, r) => a + f(r), 0);
    const last = blk[blk.length - 1];
    anni.push({ anno: k / 12 + 1, mese: last.mese, lordo: s((r) => r.lordo), noi: s((r) => r.noi), cf: s((r) => r.cf),
      cfCum: last.cfCum, debito: last.debito, valore: last.valore, posizione: last.posizione });
  }
  return anni;
}

export function primoMese(sim, pred) {
  const r = sim.find(pred);
  return r ? r.mese : null;
}
