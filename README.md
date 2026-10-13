# Ortigia · dashboard investimento

Pagina statica (HTML + JS, nessun build) per monitorare l'investimento immobiliare di Ronco San Tommaso.
Il codice è pubblico e **non contiene dati personali**: i dati vivono in un repository GitHub **privato**
(`ortigia-data/ledger.json` + `allegati/`), letto e scritto dalla pagina tramite l'API di GitHub con un token
personale salvato solo nel browser di ciascun dispositivo.

## Sezioni
- **Panoramica**: cash flow cumulato, breakeven di cassa e patrimoniale, rendimento netto, cash-on-cash, ROI totale,
  debito residuo, cedolare da accantonare, ricavi vs storico, conto economico mensile.
- **Registro**: incassi mensili del PM (manuali o da Excel export prenotazioni), spese/bollette con competenza, stime di valore.
- **Simulatore**: parametri modificabili, preset 2024 / 2025 / 2026 / media / reale, confronto scenari, tabella anno per anno.
- **Mercato**: indice Idealista €/m² Ortigia e valore indicizzato.
- **Getquin**: valori da inserire come asset manuale + CSV storico.
- **Impostazioni**: origine dati, parametri (fee PM, cedolare, budget costi), backup JSON.

## Messa online (gratis)
1. Crea su GitHub due repository: `ortigia-dashboard` (**pubblico**) e `ortigia-data` (**privato**).
2. Carica questa cartella in `ortigia-dashboard` e la cartella `ortigia-data` nell'altro repository.
3. In `ortigia-dashboard` → Settings → Pages → Source: *Deploy from a branch* → `main` / root.
   La pagina sarà su `https://<utente>.github.io/ortigia-dashboard/`.
4. Crea un token: GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*
   - Repository access: *Only select repositories* → `ortigia-data`
   - Permissions → Repository → **Contents: Read and write**
5. Apri la pagina → Impostazioni → GitHub → utente, `ortigia-data`, token → *Collega e ricarica*. Ripeti su ogni dispositivo.

## Sviluppo locale
```
python3 -m http.server 8765   # dalla cartella che contiene ortigia-dashboard e ortigia-data
```
Poi apri `http://localhost:8765/ortigia-dashboard/?ledger=../ortigia-data/ledger.json` (modalità locale, dati nel browser).
