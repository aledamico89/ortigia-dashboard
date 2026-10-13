// Persistenza: repository GitHub privato (via API, token personale salvato solo nel browser)
// oppure modalità locale (localStorage + import/export JSON).

const CFG_KEY = 'ortigia.cfg.v1';
const LOCAL_KEY = 'ortigia.ledger.v1';
const LOCAL_FILES = 'ortigia.files.v1';

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }

export function getConfig() {
  try { return JSON.parse(safeGet(CFG_KEY)) || { mode: 'local' }; } catch { return { mode: 'local' }; }
}
export function setConfig(cfg) { safeSet(CFG_KEY, JSON.stringify(cfg)); }

const utf8ToB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64ToUtf8 = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const bufToB64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

class GitHubStore {
  constructor(cfg) {
    this.cfg = cfg; this.sha = null;
    this.base = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/`;
  }
  headers() {
    return { Authorization: `Bearer ${this.cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  url(path) { return this.base + path.split('/').map(encodeURIComponent).join('/') + `?ref=${encodeURIComponent(this.cfg.branch || 'main')}`; }
  async load() {
    const res = await fetch(this.url(this.cfg.path || 'ledger.json'), { headers: this.headers(), cache: 'no-store' });
    if (res.status === 401) throw new Error('Token non valido o scaduto.');
    if (res.status === 404) throw new Error(await this.diagnose());
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const j = await res.json();
    this.sha = j.sha;
    // file > 1MB: content vuoto, usare il blob raw
    if (!j.content && j.download_url) {
      const raw = await fetch(j.git_url, { headers: { ...this.headers(), Accept: 'application/vnd.github.raw' } });
      return JSON.parse(await raw.text());
    }
    return JSON.parse(b64ToUtf8(j.content));
  }
  // Un 404 può voler dire: token di un altro utente, token senza accesso al repo, nome repo/branch/file errato.
  async diagnose() {
    const { owner, repo, branch = 'main', path = 'ledger.json' } = this.cfg;
    const u = await fetch('https://api.github.com/user', { headers: this.headers() });
    if (!u.ok) return 'Token non valido: ricrealo e incollalo di nuovo.';
    const login = (await u.json()).login;
    const r = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: this.headers() });
    if (r.status === 404) {
      return `Il token (utente ${login}) non vede il repository "${owner}/${repo}". Controlla che utente e repository siano scritti esattamente così `
        + 'e che nel token, alla voce "Repository access", sia selezionato ortigia-data (Only select repositories).';
    }
    const b = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`, { headers: this.headers() });
    if (b.status === 404) return `Il repository c'è, ma non il branch "${branch}".`;
    return `Il repository è accessibile, ma il file "${path}" non esiste oppure il token non ha il permesso "Contents: Read" (impostalo su Read and write).`;
  }
  async save(data, message) {
    const body = { message: message || 'Aggiornamento dati', content: utf8ToB64(JSON.stringify(data, null, 1)), branch: this.cfg.branch || 'main' };
    if (this.sha) body.sha = this.sha;
    const res = await fetch(this.base + (this.cfg.path || 'ledger.json'), { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) });
    if (res.status === 409 || res.status === 422) throw new Error('I dati sono stati modificati da un altro dispositivo. Ricarica la pagina e ripeti la modifica.');
    if (!res.ok) throw new Error(`Salvataggio non riuscito (GitHub ${res.status}).`);
    const j = await res.json();
    this.sha = j.content.sha;
  }
  async upload(path, file) {
    const content = bufToB64(await file.arrayBuffer());
    const res = await fetch(this.base + path.split('/').map(encodeURIComponent).join('/'), {
      method: 'PUT', headers: this.headers(),
      body: JSON.stringify({ message: `Allegato ${file.name}`, content, branch: this.cfg.branch || 'main' }),
    });
    if (!res.ok) throw new Error(`Caricamento allegato non riuscito (GitHub ${res.status}).`);
    return path;
  }
  async open(path) {
    const res = await fetch(this.url(path), { headers: { ...this.headers(), Accept: 'application/vnd.github.raw' } });
    if (!res.ok) throw new Error(`Allegato non disponibile (GitHub ${res.status}).`);
    return URL.createObjectURL(await res.blob());
  }
  label() { return `GitHub · ${this.cfg.owner}/${this.cfg.repo}`; }
}

class LocalStore {
  constructor(cfg) { this.cfg = cfg; }
  async load() {
    const s = safeGet(LOCAL_KEY);
    if (s) return JSON.parse(s);
    // primo avvio: seed opzionale da URL (?ledger=...) o da ./ledger.sample.json se presente
    const seed = new URLSearchParams(location.search).get('ledger') || this.cfg.seedUrl;
    if (seed) {
      const res = await fetch(seed, { cache: 'no-store' });
      if (res.ok) return res.json();
    }
    return null;
  }
  async save(data) {
    if (!safeSet(LOCAL_KEY, JSON.stringify(data))) throw new Error('Spazio del browser esaurito o non disponibile: esporta un backup JSON.');
  }
  async upload(path, file) {
    if (file.size > 1.5e6) throw new Error('In modalità locale gli allegati sono limitati a 1,5 MB. Collega GitHub per file più grandi.');
    const url = await new Promise((ok, ko) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.onerror = ko; fr.readAsDataURL(file); });
    let files = {}; try { files = JSON.parse(safeGet(LOCAL_FILES)) || {}; } catch { /* vuoto */ }
    files[path] = url;
    if (!safeSet(LOCAL_FILES, JSON.stringify(files))) throw new Error('Spazio del browser esaurito.');
    return path;
  }
  async open(path) {
    let files = {}; try { files = JSON.parse(safeGet(LOCAL_FILES)) || {}; } catch { /* vuoto */ }
    if (!files[path]) throw new Error('Allegato non presente in questo browser.');
    return files[path];
  }
  label() { return 'Locale · solo questo browser'; }
}

export function makeStore(cfg = getConfig()) {
  if (cfg.mode === 'github' && cfg.owner && cfg.repo && cfg.token) return new GitHubStore(cfg);
  return new LocalStore(cfg);
}

export function resetLocal() { try { localStorage.removeItem(LOCAL_KEY); } catch { /* ignore */ } }
