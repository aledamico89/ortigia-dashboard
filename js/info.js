// Spiegazioni delle metriche: pulsante "?" + riquadro che si apre al clic/tocco.
// I testi usano i numeri reali del momento (passati come contesto da app.js).

export function createInfo(fmt) {
  const { eur, eurS, pct, nf0, esc, monthLabel } = fmt;
  const ctx = {};
  const mesiTxt = (n) => `${n} ${n === 1 ? 'mese' : 'mesi'}`;
  const annual = (x, n) => (n ? x * 12 / n : 0);
  const pochiMesi = (k) => (k.mesi < 12
    ? `Con ${mesiTxt(k.mesi)} di dati il valore è poco affidabile: la stagionalità pesa molto (estate piena, inverno quasi vuoto). Diventa significativo dopo 12 mesi.` : '');
  const senzaRata = (R) => (R?.some((r) => r.servizio === 0)
    ? 'Nei mesi prima della prima rata del mutuo (2 novembre 2026) il cash flow risulta più alto del normale.' : '');

  const INFO = {
    // ---------- Panoramica ----------
    cf: {
      t: 'Cash flow netto cumulato',
      cosa: 'Quanti soldi ti sono rimasti in tasca (o hai dovuto aggiungere) dall\'inizio della gestione, dopo aver pagato proprio tutto.',
      calc: ({ k }) => `Lordo ${eur(k.lordo)} − portali ${eur(k.comm)} − property manager ${eur(k.fee)} − cedolare ${eur(k.ced)} − costi ${eur(k.costi)} − rata mutuo ${eur(k.interessi + k.capitale + k.speseMutuo)} = <strong>${eurS(k.cfCum)}</strong>`,
      leggi: 'Positivo: la casa si paga da sola e avanza qualcosa. Negativo: stai integrando di tasca tua. Nella rata c\'è anche la quota capitale, che non è persa: riduce il debito e diventa patrimonio tuo.',
      nota: ({ R }) => senzaRata(R),
    },
    bkCassa: {
      t: 'Breakeven di cassa',
      cosa: 'Il momento in cui il cash flow cumulato avrà restituito tutto il capitale che hai messo di tasca tua.',
      calc: ({ k }) => `Capitale proprio da recuperare: ${eur(k.cap)} (anticipo sul prezzo + notaio + agenzia + spese bancarie). Recuperato finora: ${eurS(k.cfCum)} = <strong>${pct(k.recuperoCassa, 0)}</strong>.`,
      leggi: 'È la misura più prudente: ignora sia il mutuo che ripaghi sia la rivalutazione della casa. La data prevista usa lo scenario scelto nel Simulatore.',
      nota: ({ scenLabel, etaCassa }) => (etaCassa ? `Con lo scenario "${scenLabel}" lo raggiungi a ${monthLabel(etaCassa, true)}.` : `Con lo scenario "${scenLabel}" non si raggiunge entro 30 anni: il cash flow annuo è troppo basso o negativo.`),
    },
    bkPatr: {
      t: 'Breakeven patrimoniale',
      cosa: 'Il momento in cui, vendendo la casa, rientreresti di tutto ciò che hai speso. Risponde alla domanda: "se vendessi oggi, sarei in pari?"',
      calc: ({ k }) => `I costi "persi" con l'acquisto sono ${eur(k.trans)} (notaio, agenzia, spese bancarie). Li recuperi con cash flow (${eurS(k.cfCum)}) + mutuo già rimborsato (${eur(k.capRimb)})${k.rival ? ` + rivalutazione (${eurS(k.rival)})` : ''}: <strong>${pct(k.recuperoPatr, 0)}</strong>.`,
      leggi: 'Arriva prima del breakeven di cassa perché conta anche il debito che ripaghi ogni mese. Non considera le spese di una futura vendita (agenzia, eventuali tasse).',
      nota: ({ etaPatr, p }) => (etaPatr ? `Previsto a ${monthLabel(etaPatr, true)} con rivalutazione ${pct(p.rivalutazione)} annua (modificabile nel Simulatore).` : ''),
    },
    rendNetto: {
      t: 'Rendimento netto su prezzo',
      cosa: 'Quanto rende la casa in sé, come se l\'avessi comprata tutta in contanti, senza mutuo.',
      calc: ({ k, data }) => `Reddito netto ${eur(k.noiCum)} in ${mesiTxt(k.mesi)} → ${eur(annual(k.noiCum, k.mesi))} l'anno ÷ prezzo ${eur(data.immobile.prezzo)} = <strong>${pct(k.rendNetto)}</strong>. Il reddito netto è il lordo meno portali, property manager, cedolare e costi, prima della rata.`,
      leggi: 'Serve a confrontare l\'immobile con altri investimenti "senza leva", per esempio un titolo di Stato o un conto deposito.',
      nota: ({ k }) => pochiMesi(k),
    },
    coc: {
      t: 'Cash-on-cash',
      cosa: 'Il rendimento sui soldi che hai messo tu, dopo aver pagato anche la rata del mutuo. È la risposta a "quanto mi entra in tasca rispetto a quanto ho investito".',
      calc: ({ k }) => `Cash flow ${eurS(k.cfCum)} in ${mesiTxt(k.mesi)} → ${eurS(annual(k.cfCum, k.mesi))} l'anno ÷ capitale proprio ${eur(k.cap)} = <strong>${pct(k.cashOnCash)}</strong>.`,
      leggi: 'Può essere più alto del rendimento su prezzo (la banca ti presta a un tasso inferiore a quanto rende la casa) oppure più basso, anche negativo, se la rata pesa più del reddito.',
      nota: ({ k, R }) => [pochiMesi(k), senzaRata(R)].filter(Boolean).join(' '),
    },
    roi: {
      t: 'ROI totale',
      cosa: 'Il guadagno complessivo rispetto al capitale proprio: non solo i soldi incassati, ma anche il patrimonio che stai costruendo.',
      calc: ({ k }) => `(Cash flow ${eurS(k.cfCum)} + mutuo rimborsato ${eur(k.capRimb)}${k.rival ? ` + rivalutazione ${eurS(k.rival)}` : ''}) ÷ ${eur(k.cap)} = <strong>${pct(k.roiTot)}</strong> dall'inizio, ${pct(k.roiTotAnn)} su base annua.`,
      leggi: 'La rivalutazione entra nel calcolo solo se in alto scegli "Indice Idealista" o "Ultima stima"; con "Nominale" la casa resta a 215.000 €.',
    },
    lordo: {
      t: 'Lordo incassato',
      cosa: 'Tutto ciò che hanno pagato gli ospiti per i soggiorni. È esclusa la tassa di soggiorno, che va al Comune.',
      calc: ({ k }) => `${eur(k.lordo)} per ${nf0.format(k.notti)} notti. ADR (prezzo medio a notte) = ${k.notti ? eur(k.lordo / k.notti) : '—'}.`,
      leggi: 'Su questa cifra si calcolano la cedolare e, al netto dei portali, la fee del property manager.',
    },
    debito: {
      t: 'Debito residuo',
      cosa: 'Quanto devi ancora alla banca.',
      calc: ({ k, data }) => `Mutuo iniziale ${eur(data.mutuo.importo)} − capitale già rimborsato ${eur(k.capRimb)} = <strong>${eur(k.debito)}</strong>.`,
      leggi: 'Ogni rata ha due parti: interessi (costo) e quota capitale (riduce il debito). All\'inizio la quota capitale è piccola, circa 258 € su 782 €, poi cresce ogni mese.',
    },
    equity: {
      t: 'Patrimonio netto immobiliare',
      cosa: 'La parte della casa che è davvero tua: quello che ti resterebbe vendendola al valore indicato e chiudendo il mutuo.',
      calc: ({ k }) => `Valore ${eur(k.valore)} − debito ${eur(k.debito)} = <strong>${eur(k.equity)}</strong>. LTV (quota finanziata dalla banca) = ${pct(k.ltv, 0)}.`,
      leggi: 'È il valore da inserire su Getquin. Cresce quando ripaghi il mutuo e quando la casa si rivaluta.',
    },
    cedolare: {
      t: 'Cedolare da accantonare',
      cosa: 'La cedolare secca (21%) sugli affitti brevi maturata finora e non ancora versata o trattenuta. Conviene tenerla da parte: si paga con acconti (giugno e novembre) e saldo.',
      calc: ({ k, data }) => `${pct(data.fiscale.cedolare, 0)} × lordo = ${eur(k.ced)} maturata − ritenute già trattenute ${eur(k.ritenute)} = <strong>${eur(k.tasseDaAccantonare)}</strong>.`,
      leggi: 'Se i portali o il property manager trattengono il 21% alla fonte, inserisci la ritenuta nel mese dell\'incasso; gli F24 pagati vanno registrati come spesa "Cedolare secca versata". Base imponibile e modalità vanno confermate con il commercialista.',
    },
    costi: {
      t: 'Costi operativi',
      cosa: 'Le spese per tenere aperta la casa: luce, acqua, internet, polizza, TARI, IMU, manutenzione. Le pulizie e la piccola manutenzione sono già incluse nella fee del property manager.',
      calc: ({ k }) => `Totale ${eur(k.costi)}${k.costiStimati ? `, di cui ${eur(k.costiStimati)} stimati` : ''}.`,
      leggi: 'Dove c\'è una bolletta reale la dashboard usa quella; altrimenti usa la quota mensile del budget (Impostazioni → Budget). Togli la spunta "Includi costi stimati" per vedere solo le spese effettive.',
    },
    occupazione: {
      t: 'Occupazione',
      cosa: 'La percentuale di notti vendute sul totale dei giorni del periodo.',
      calc: ({ k, giorni }) => `${nf0.format(k.notti)} notti ÷ ${giorni} giorni = <strong>${pct(k.notti / giorni, 0)}</strong>.`,
      leggi: 'Storico della casa: 68% nel 2024, 52% nel 2025. Il dato mensile oscilla molto con la stagione.',
    },
    mutuoPct: {
      t: 'Mutuo rimborsato',
      cosa: 'La percentuale del mutuo che hai già restituito alla banca.',
      calc: ({ k, data }) => `Capitale rimborsato ÷ mutuo iniziale = <strong>${pct(k.capRimb / data.mutuo.importo)}</strong>.`,
      leggi: 'Cresce lentamente all\'inizio e più velocemente negli ultimi anni (ammortamento alla francese).',
    },
    ltv: {
      t: 'Loan to value (LTV)',
      cosa: 'Quanta parte della casa è ancora finanziata dalla banca.',
      calc: ({ k }) => `Debito residuo ÷ valore immobile = <strong>${pct(k.ltv, 0)}</strong>.`,
      leggi: 'Più è basso, più la casa è tua. All\'acquisto era 79% (170.000 su 215.000).',
    },
    tassePct: {
      t: 'Tasse sul lordo',
      cosa: 'Il peso della cedolare secca sugli incassi.',
      calc: ({ k }) => `Cedolare maturata ÷ lordo = <strong>${pct(k.lordo ? k.ced / k.lordo : 0)}</strong>.`,
      leggi: 'Con la cedolare calcolata sul lordo è sempre il 21%; scende se imposti la base "netto commissioni portali".',
    },
    costiPct: {
      t: 'Costi sul lordo',
      cosa: 'Quanto pesano le spese fisse della casa sugli incassi.',
      calc: ({ k }) => `Costi operativi ÷ lordo = <strong>${pct(k.lordo ? k.costi / k.lordo : 0)}</strong>.`,
      leggi: 'Nei mesi di bassa stagione sale molto, perché i costi restano mentre gli incassi calano.',
    },
    split: {
      t: 'Dove va ogni euro incassato',
      cosa: 'Come si divide il lordo pagato dagli ospiti tra chi lo riceve: portali, property manager, Stato, fornitori, banca e, alla fine, tu.',
      calc: () => 'Ogni barra è una voce di spesa in euro e in percentuale del lordo. L\'ultima riga, il cash flow netto, è quello che resta.',
      leggi: 'La quota capitale del mutuo è separata dagli interessi perché non è un costo: è risparmio forzato che aumenta il tuo patrimonio.',
    },
    posizione: {
      t: 'Posizione netta nel tempo',
      cosa: 'Il tuo "saldo complessivo" dell\'operazione mese per mese: linea continua per i dati reali, tratteggiata per la proiezione.',
      calc: ({ k }) => `(Valore − debito) + cash flow cumulato − capitale proprio. Oggi: ${eur(k.valore)} − ${eur(k.debito)} ${eurS(k.cfCum)} − ${eur(k.cap)} = <strong>${eurS(k.posizione)}</strong>.`,
      leggi: 'Parte in negativo per i costi d\'acquisto. Quando la linea blu supera lo zero hai raggiunto il breakeven patrimoniale. La linea arancione è il cash flow cumulato.',
    },
    // ---------- Simulatore ----------
    simCf: {
      t: 'Cash flow medio mensile (anno 1)',
      cosa: 'Quanto ti entra (o devi aggiungere) in media ogni mese nel primo anno, con i parametri impostati a sinistra.',
      calc: ({ cfY1 }) => `Cash flow del primo anno ${eurS(cfY1)} ÷ 12 = <strong>${eurS(cfY1 / 12)}</strong> al mese.`,
      leggi: 'La media nasconde la stagionalità: in estate il cash flow è positivo, in inverno negativo.',
    },
    simRend: {
      t: 'Rendimento netto su prezzo (simulato)',
      cosa: 'Il rendimento della casa senza mutuo nel primo anno simulato. Sotto trovi il cash-on-cash, cioè il rendimento sui tuoi soldi dopo la rata.',
      calc: ({ noiY1, cfY1, cap, data }) => `Reddito netto ${eur(noiY1)} ÷ ${eur(data.immobile.prezzo)} = <strong>${pct(noiY1 / data.immobile.prezzo)}</strong>. Cash-on-cash: ${eurS(cfY1)} ÷ ${eur(cap)} = ${pct(cfY1 / cap)}.`,
      leggi: 'Prova a cambiare notti, prezzo medio o fee del PM per vedere quanto si muove.',
    },
    simBc: {
      t: 'Breakeven di cassa (simulato)',
      cosa: 'Quando il cash flow cumulato avrà restituito tutto il capitale proprio, con questi parametri.',
      calc: ({ cap }) => `Obiettivo: recuperare ${eur(cap)} solo con gli incassi netti.`,
      leggi: '"Oltre 30 anni" significa che con questi parametri gli affitti da soli non ripagano l\'investimento: serve più fatturato o costi più bassi.',
    },
    simBp: {
      t: 'Breakeven patrimoniale (simulato)',
      cosa: 'Quando, vendendo la casa al valore simulato, rientreresti di tutto, inclusi notaio, agenzia e spese bancarie.',
      calc: ({ p }) => `Conta cash flow + mutuo ripagato + rivalutazione (${pct(p.rivalutazione)} annua impostata).`,
      leggi: 'Prova ad alzare la rivalutazione: Idealista indica +2,1% nell\'ultimo anno e 3,7% medio dal 2012 per Ortigia.',
    },
    simBe: {
      t: 'Lordo annuo per avere cash flow zero',
      cosa: 'Il fatturato minimo annuo con cui la casa si paga da sola, senza che tu debba aggiungere soldi.',
      calc: ({ Lbe, p, servizio }) => `Deve coprire costi fissi ${eur(p.costiAnnui)} + rate ${eur(servizio)}, dopo aver tolto portali (${nf0.format(p.commPct)}%), property manager (${nf0.format(p.feePct)}%) e cedolare (${nf0.format(p.cedPct)}%): <strong>${eur(Lbe)}</strong>, circa ${nf0.format(Lbe / p.adr)} notti a ${eur(p.adr)}.`,
      leggi: 'È il numero da tenere a mente con il property manager: sopra questa soglia la casa genera cassa, sotto la stai finanziando tu.',
    },
  };

  // ---------- Riquadro ----------
  const pop = document.createElement('div');
  pop.id = 'info-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-modal', 'false'); pop.hidden = true;
  document.body.appendChild(pop);
  let openBtn = null;

  function close() {
    if (!openBtn) return;
    pop.hidden = true; openBtn.setAttribute('aria-expanded', 'false');
    const b = openBtn; openBtn = null; return b;
  }
  function open(btn) {
    const key = btn.dataset.info; const def = INFO[key]; if (!def) return;
    const c = ctx[btn.dataset.ctx || 'panoramica'] || {};
    const val = (x) => (typeof x === 'function' ? x(c) : x);
    let calc = ''; let nota = '';
    try { calc = val(def.calc) || ''; nota = val(def.nota) || ''; } catch { /* contesto non pronto */ }
    pop.innerHTML = `<div class="ip-head"><h4 id="ip-title">${esc(def.t)}</h4><button type="button" class="ip-close" aria-label="Chiudi">×</button></div>
      <p>${esc(def.cosa)}</p>
      ${calc ? `<div class="ip-sec"><span>Come si calcola, con i tuoi numeri</span><p>${calc}</p></div>` : ''}
      ${def.leggi ? `<div class="ip-sec"><span>Come leggerlo</span><p>${esc(val(def.leggi))}</p></div>` : ''}
      ${nota ? `<p class="ip-note">${esc(nota)}</p>` : ''}`;
    pop.setAttribute('aria-labelledby', 'ip-title');
    pop.hidden = false; openBtn = btn; btn.setAttribute('aria-expanded', 'true');
    place(btn);
    pop.querySelector('.ip-close').focus({ preventScroll: true });
  }
  function place(btn) {
    if (matchMedia('(max-width: 640px)').matches) { pop.classList.add('sheet'); pop.style.cssText = ''; return; }
    pop.classList.remove('sheet');
    const r = btn.getBoundingClientRect(); const w = Math.min(pop.offsetWidth || 420, innerWidth - 24);
    const left = Math.min(Math.max(12, r.right - w), innerWidth - w - 12);
    // apre sotto o sopra il pulsante, dal lato con più spazio, senza uscire dallo schermo
    pop.style.maxHeight = ''; pop.style.left = `${left}px`;
    const h = pop.scrollHeight;
    const below = innerHeight - r.bottom - 20; const above = r.top - 20;
    if (h <= below || below >= above) {
      pop.style.top = `${r.bottom + 8}px`; pop.style.maxHeight = `${Math.max(160, below)}px`;
    } else {
      const hh = Math.min(h, above);
      pop.style.top = `${r.top - 8 - hh}px`; pop.style.maxHeight = `${hh}px`;
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button.info[data-info]');
    if (btn) { e.preventDefault(); e.stopPropagation(); const was = openBtn === btn; close(); if (!was) open(btn); return; }
    if (e.target.closest('.ip-close')) { const b = close(); b?.focus(); return; }
    if (openBtn && !pop.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openBtn) { const b = close(); b?.focus(); } });
  addEventListener('resize', () => { if (openBtn) place(openBtn); });
  addEventListener('scroll', () => { if (openBtn && !pop.classList.contains('sheet')) close(); }, { passive: true });

  return {
    btn: (key, label, ctxName = 'panoramica') => `<button type="button" class="info" data-info="${key}" data-ctx="${ctxName}" aria-label="Spiegazione: ${esc(label)}" aria-expanded="false" aria-controls="info-pop">?</button>`,
    setCtx: (name, c) => { ctx[name] = c; },
    close,
  };
}
