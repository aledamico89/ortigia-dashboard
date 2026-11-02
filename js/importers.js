// Lettura dei file del property manager. Funzioni pure (niente DOM, niente rete): testabili da riga di comando.
//
// Formati riconosciuti
//  - "resoconto"  resoconto mensile del PM: righe PORTALE / IN / OUT / IMP. LORDO / COMM. PORTALI / NETTO / COMM AGENZ.
//                 + blocco totali ("TOTALE LORDO", "Totale Dovuto…"). È il documento definitivo del mese.
//  - "export"     export prenotazioni del gestionale (colonne Check in / Check-out / Addebito soggiorno…): provvisorio.
//  - sconosciuto  qualunque altra tabella: la pagina propone l'abbinamento manuale delle colonne.
// I nomi degli ospiti NON vengono mai letti nei dati salvati: restano solo nel file originale allegato.

export const MESI_IT = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

// ---------- Utilità ----------
export const strip = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const r2 = (x) => Math.round(x * 100) / 100;
export const toNum = (v) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[€\s]/g, '');
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) ? n : 0;
};
const isNum = (v) => v != null && v !== '' && (typeof v === 'number' || /^-?[\d.,]+\s*€?$/.test(String(v).trim()));
export const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function parseDate(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 86400 * 1000)) : null;
  const s = String(v).trim();
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) return new Date(Number(m[3].length === 2 ? `20${m[3]}` : m[3]), Number(m[2]) - 1, Number(m[1]));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return null;
}
const monthOf = (iso) => iso.slice(0, 7);
const dayDiff = (a, b) => Math.round((new Date(b) - new Date(a)) / 864e5);

export function meseDaNome(name) {
  const s = strip(name);
  for (let i = 0; i < 12; i++) {
    const m = s.match(new RegExp(`\\b${MESI_IT[i]}\\b\\s*(20\\d{2})?`));
    if (m) return m[1] ? `${m[1]}-${String(i + 1).padStart(2, '0')}` : { mese: i + 1 };
  }
  const n = s.match(/\b(20\d{2}) ?(0[1-9]|1[0-2])\b/);
  return n ? `${n[1]}-${n[2]}` : null;
}

export function canaleNormalizzato(v) {
  const s = strip(v);
  if (!s) return 'Altro';
  if (s.includes('booking') && s.includes('engine')) return 'Diretta';
  if (s.includes('booking')) return 'Booking';
  if (s.includes('airbnb')) return 'Airbnb';
  if (/front|direct|sito|telefon|whatsapp|mail/.test(s)) return 'Diretta';
  if (s.includes('expedia')) return 'Expedia';
  return String(v).trim();
}

// ---------- Campi e sinonimi delle intestazioni ----------
export const CAMPI = [
  ['in', 'Arrivo (check-in)', true, ['in', 'check in', 'checkin', 'arrivo', 'data arrivo']],
  ['out', 'Partenza (check-out)', true, ['out', 'check out', 'checkout', 'partenza', 'data partenza']],
  ['lordo', 'Importo lordo', true, ['imp lordo', 'importo lordo', 'lordo', 'addebito soggiorno', 'importo soggiorno', 'totale soggiorno']],
  ['canale', 'Canale / portale', false, ['portale', 'canale', 'channel', 'provenienza']],
  ['notti', 'Notti', false, ['notti', 'n notti', 'nights']],
  ['comm', 'Commissioni portali', false, ['comm portali', 'commissioni portali', 'commissione portale', 'commissioni portale', 'comm portale', 'commissioni']],
  ['netto', 'Netto dopo portali', false, ['netto', 'importo netto']],
  ['fee', 'Commissione agenzia / PM', false, ['comm agenz', 'comm agenzia', 'commissione agenzia', 'commissioni agenzia', 'fee pm', 'commissione pm', 'provvigione']],
  ['tassa', 'Tassa di soggiorno', false, ['tassa', 'tassa di soggiorno', 'tassa soggiorno', 'city tax']],
  ['pax', 'Ospiti', false, ['pax', 'ospiti', 'persone', 'n ospiti']],
  ['stato', 'Stato', false, ['stato', 'status']],
];

export function autoMap(headers) {
  const H = headers.map(strip);
  const used = new Set(); const map = {};
  for (const [key, , , syn] of CAMPI) {
    let idx = -1;
    for (const s of syn) { const i = H.findIndex((h, k) => !used.has(k) && h === s); if (i >= 0) { idx = i; break; } }
    if (idx < 0) for (const s of syn) { if (s.length < 8) continue; const i = H.findIndex((h, k) => !used.has(k) && h.includes(s)); if (i >= 0) { idx = i; break; } }
    if (idx >= 0) { map[key] = idx; used.add(idx); }
  }
  return map;
}

/** Cerca la riga di intestazione e dice che tipo di file è. */
export function riconosci(rows) {
  const limit = Math.min(rows.length, 25);
  let best = { riga: -1, map: {}, score: 0 };
  for (let i = 0; i < limit; i++) {
    const cells = (rows[i] || []).map((c) => (typeof c === 'string' ? c : ''));
    if (cells.filter(Boolean).length < 3) continue;
    const map = autoMap(cells);
    const score = Object.keys(map).length + (map.in != null ? 2 : 0) + (map.out != null ? 2 : 0) + (map.lordo != null ? 2 : 0);
    if (score > best.score) best = { riga: i, map, score };
  }
  const headers = best.riga >= 0 ? rows[best.riga].map((c) => String(c ?? '')) : [];
  const completo = best.map.in != null && best.map.out != null && best.map.lordo != null;
  const H = headers.map(strip);
  let tipo = 'sconosciuto';
  if (completo) {
    const exportCols = H.includes('addebito soggiorno') || (H.includes('check in') && H.includes('stato') && !H.includes('imp lordo'));
    tipo = exportCols ? 'export' : 'resoconto';
  }
  return { tipo, riga: best.riga, map: best.map, headers };
}

// ---------- Resoconto mensile ----------
function leggiTotali(rows, dopoRiga) {
  const T = {};
  const valoreADestra = (r, i) => { for (let j = i + 1; j < r.length; j++) if (isNum(r[j])) return toNum(r[j]); return null; };
  rows.forEach((r, ri) => {
    if (ri <= dopoRiga) return;
    (r || []).forEach((c, i) => {
      if (typeof c !== 'string') return;
      const s = strip(c);
      const v = valoreADestra(r, i);
      if (/^totale lordo/.test(s)) T.lordo = v;
      else if (/^totale comm\w* agenz/.test(s)) T.fee = v == null ? null : Math.abs(v);
      else if (/^totale comm/.test(s)) T.comm = v == null ? null : Math.abs(v);
      else if (/^totale netto/.test(s)) T.netto = v;
      else if (/^spese puli/.test(s)) { T.pulizie = v == null ? 0 : Math.abs(v); T.pulizie_presente = true; }
      else if (/^totale dovuto/.test(s)) { T.dovuto = v; T.etichetta_dovuto = c.replace(/\s+/g, ' ').trim(); }
    });
  });
  return T;
}

/** Legge le prenotazioni. Restituisce righe anonime (nessun nome ospite) + totali del file. */
export function leggiResoconto(rows, { riga, map }) {
  const book = [];
  for (let ri = riga + 1; ri < rows.length; ri++) {
    const r = rows[ri] || [];
    const ci = parseDate(r[map.in]); const co = parseDate(r[map.out]);
    if (!ci || !co) continue; // righe vuote, totali, note
    if (map.stato != null && /cancell|annull|no.?show/i.test(String(r[map.stato] ?? ''))) continue;
    const lordo = toNum(r[map.lordo]);
    const comm = map.comm != null ? Math.abs(toNum(r[map.comm])) : 0;
    const netto = map.netto != null && isNum(r[map.netto]) ? toNum(r[map.netto]) : r2(lordo - comm);
    book.push({
      canale: map.canale != null ? canaleNormalizzato(r[map.canale]) : 'Altro',
      pax: map.pax != null ? toNum(r[map.pax]) || null : null,
      check_in: isoDate(ci), check_out: isoDate(co),
      notti: (map.notti != null && toNum(r[map.notti])) || Math.max(1, Math.round((co - ci) / 864e5)),
      lordo: r2(lordo), commissioni: r2(comm), netto: r2(netto),
      fee: map.fee != null && isNum(r[map.fee]) ? r2(Math.abs(toNum(r[map.fee]))) : null,
      tassa: map.tassa != null ? r2(toNum(r[map.tassa])) : 0,
    });
  }
  const somma = (f) => r2(book.reduce((s, b) => s + (f(b) || 0), 0));
  return {
    book,
    totali: leggiTotali(rows, riga),
    somma: { lordo: somma((b) => b.lordo), comm: somma((b) => b.commissioni), netto: somma((b) => b.netto), fee: map.fee != null ? somma((b) => b.fee) : null, notti: somma((b) => b.notti) },
    colonne: { fee: map.fee != null, comm: map.comm != null, netto: map.netto != null, tassa: map.tassa != null, canale: map.canale != null },
  };
}

export function meseSuggerito(book, nomeFile, anno = null) {
  const dalNome = meseDaNome(nomeFile);
  if (typeof dalNome === 'string') return dalNome;
  const per = {};
  for (const b of book) { const m = monthOf(b.check_out); per[m] = (per[m] || 0) + b.notti; }
  const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  if (dalNome && dalNome.mese && top) return `${top.slice(0, 4)}-${String(dalNome.mese).padStart(2, '0')}`;
  return top;
}

const sovrapposte = (a, b) => a.check_in < b.check_out && b.check_in < a.check_out;
const compatibile = (c1, c2) => c1 === c2;

/**
 * Controlli di coerenza. Ogni voce: { livello: 'ok' | 'warn' | 'info', testo }.
 * ctx: { mese, feePct, rogito, esistente (record già in registro per il mese) }
 */
export function controlla(p, ctx) {
  const out = []; const add = (livello, testo) => out.push({ livello, testo });
  const { book, totali: T, somma: S } = p;
  const fmt = (x) => new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' }).format(x);
  const d = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;  // gg/mm

  add('ok', `${book.length} prenotazioni, ${S.notti} notti.`);

  // 1. totali del file vs somma delle righe
  const conf = [['lordo', 'lordo', 'Lordo'], ['comm', 'comm', 'Commissioni portali'], ['netto', 'netto', 'Netto']];
  const diffs = [];
  for (const [kt, ks, lab] of conf) {
    if (T[kt] == null) continue;
    if (Math.abs(T[kt] - S[ks]) > 0.05) diffs.push(`${lab}: totale del file ${fmt(T[kt])} ≠ somma righe ${fmt(S[ks])}`);
  }
  if (diffs.length) add('warn', `Totali che non tornano con le righe → ${diffs.join('; ')}.`);
  else if (T.lordo != null) add('ok', 'I totali del file coincidono con la somma delle righe.');
  else add('info', 'Totali non trovati nel file: uso la somma delle righe.');

  // 2. aritmetica per riga
  const storte = book.filter((b) => Math.abs(b.lordo - b.commissioni - b.netto) > 0.02);
  if (storte.length) add('warn', `${storte.length} righe in cui lordo − commissioni ≠ netto.`);

  // 3. commissione del PM
  const netto = T.netto ?? S.netto; const lordo = T.lordo ?? S.lordo;
  const fee = T.fee ?? S.fee;
  if (fee != null && netto) {
    const pct = fee / netto; const sulLordo = lordo ? fee / lordo : null;
    const attesa = ctx.feePct;
    if (Math.abs(pct - attesa) <= 0.002) add('ok', `Commissione PM ${fmt(fee)} € = ${fmt(pct * 100)}% del netto dopo i portali (atteso ${fmt(attesa * 100)}%).`);
    else if (sulLordo != null && Math.abs(sulLordo - attesa) <= 0.002) add('warn', `Commissione PM ${fmt(fee)} € = ${fmt(sulLordo * 100)}% del LORDO: il contratto la prevede sul netto dopo i portali.`);
    else add('warn', `Commissione PM ${fmt(fee)} € = ${fmt(pct * 100)}% del netto, ma il parametro impostato è ${fmt(attesa * 100)}%. Controlla con il PM.`);
  } else add('info', 'Commissione del PM non presente nel file: la calcolo con la percentuale impostata.');

  // 4. importo dovuto
  if (T.dovuto != null) {
    const calc = r2(netto - (fee ?? r2(netto * ctx.feePct)) - (T.pulizie || 0));
    if (Math.abs(calc - T.dovuto) <= 0.05) add('ok', `Importo del resoconto ${fmt(T.dovuto)} € = netto − commissione PM${T.pulizie ? ' − spese' : ''}.`);
    else add('warn', `Importo del resoconto ${fmt(T.dovuto)} € ma netto − commissione dà ${fmt(calc)} €.`);
    if (/dovuto a/i.test(T.etichetta_dovuto || '') && !/(propriet|owner)/i.test(T.etichetta_dovuto)) {
      add('info', `L'etichetta del file è "${T.etichetta_dovuto}": non dice a chi spetta. L'importo coincide con quello che dovresti ricevere tu; conferma con il PM la direzione del pagamento prima di considerarlo incassato.`);
    }
  }

  // 5. spese addebitate dal PM
  if (T.pulizie_presente) add(T.pulizie ? 'warn' : 'ok', T.pulizie ? `Spese addebitate dal PM: ${fmt(T.pulizie)} € (il contratto prevede pulizie incluse nella commissione).` : 'Nessuna spesa extra addebitata (pulizie incluse nella commissione, come da contratto).');

  // 6. tassa di soggiorno
  if (p.colonne.tassa && book.every((b) => !b.tassa)) add('info', 'La colonna "Tassa" è vuota: la tassa di soggiorno non compare nel resoconto. Verifica che l\'importo lordo sia al netto della tassa.');

  // 7. soggiorni a cavallo del mese
  const m = ctx.mese;
  for (const b of book) {
    const prima = monthOf(b.check_in) < m; const dopo = monthOf(b.check_out) > m;
    if (!prima && !dopo) continue;
    const quando = `${b.canale} ${d(b.check_in)}→${d(b.check_out)} (${fmt(b.lordo)} €) ${prima ? 'inizia prima del mese' : 'finisce dopo il mese'}`;
    if (ctx.rogito && b.check_in === ctx.rogito) add('info', `${quando}, ma coincide con il giorno del rogito: l'atto ti trasferisce possesso e frutti da quel giorno, quindi è tuo. Nessuna rettifica.`);
    else if (ctx.rogito && b.check_in < ctx.rogito) add('warn', `${quando}, e parte PRIMA del rogito: le notti precedenti spettano al venditore. Chiedi al PM come le ha ripartite.`);
    else add('info', `${quando}: il PM lo ha incluso per intero in questo resoconto.`);
  }

  // 8. sovrapposizioni
  const ov = [];
  for (let i = 0; i < book.length; i++) for (let j = i + 1; j < book.length; j++) if (sovrapposte(book[i], book[j])) ov.push(`${d(book[i].check_in)}→${d(book[i].check_out)} e ${d(book[j].check_in)}→${d(book[j].check_out)}`);
  add(ov.length ? 'warn' : 'ok', ov.length ? `Prenotazioni sovrapposte: ${ov.join('; ')}.` : 'Nessuna sovrapposizione tra prenotazioni.');

  // 9. confronto con dati già presenti
  const e = ctx.esistente;
  if (e) {
    const quando = e.importato ? ` importato il ${d(e.importato)}` : '';
    add('info', `Il mese ha già un record ${e.stato || ''}${quando} (lordo ${fmt(e.lordo)} €, ${e.prenotazioni ?? e.dettaglio?.length ?? '?'} prenotazioni): verrà sostituito (differenza ${fmt(lordo - e.lordo)} €).`);
    const mancanti = (e.dettaglio || []).filter((x) => {
      const c = canaleNormalizzato(x.canale);
      return !book.some((b) => compatibile(canaleNormalizzato(b.canale), c) && sovrapposte(b, { check_in: x.check_in, check_out: x.check_out }));
    });
    // le prenotazioni dell'export provvisorio possono essere state cancellate o modificate dopo: è una nota, non un errore
    for (const x of mancanti) add('info', `Nel dato provvisorio${quando} c'era ${canaleNormalizzato(x.canale)} ${d(x.check_in)}→${d(x.check_out)} (${fmt(x.lordo)} €) che nel resoconto non compare: può essere stata cancellata o modificata dopo l'export.`);
  }
  return out;
}

/** Record da salvare nel registro (nessun nome ospite). */
export function costruisciRecord(p, mese) {
  const T = p.totali; const S = p.somma;
  return {
    mese, fonte: 'resoconto PM', stato: 'definitivo',
    lordo: T.lordo ?? S.lordo, commissioni: T.comm ?? S.comm,
    fee_pm: T.fee ?? S.fee ?? null,
    spese_pm: T.pulizie || 0,
    dovuto_pm: T.dovuto ?? null,
    notti: S.notti, prenotazioni: p.book.length,
    dettaglio: p.book.map(({ canale, pax, check_in, check_out, notti, lordo, commissioni, fee }) => ({ canale, pax, check_in, check_out, notti, lordo, commissioni, fee })),
  };
}
