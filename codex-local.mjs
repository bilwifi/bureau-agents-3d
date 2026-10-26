// Lecture seule des rollouts Codex Desktop/CLI. Aucun accès aux identifiants
// de connexion ni écriture dans CODEX_HOME. Lectures bornées, même pour de gros journaux.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const LIMITE = 4 * 1024 * 1024;
const texte = p => (p.content || []).filter(c => /^(input_text|output_text|text)$/.test(c.type)).map(c => c.text || '').join('\n');
function demandeUtile(t) {
  t = t.replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/g, '').trim();
  if (t.includes('## My request:')) t = t.split('## My request:').at(-1).trim();
  return !t || /^\s*</.test(t) || /^# AGENTS\.md/.test(t) ? null : t;
}

export function appliquerEvenement(s, e) {
  const p = e.payload || {}, ts = Date.parse(e.timestamp) || 0;
  const activite = () => { s.date = Math.max(s.date || 0, ts); };
  if (e.type === 'session_meta') {
    s.id = p.id || p.session_id; s.cwd = p.cwd; s.creation = Date.parse(p.timestamp || e.timestamp);
    s.source = p.source; return;
  }
  if (e.type === 'turn_context') { s.modele = p.model || s.modele; s.cwd = p.cwd || s.cwd; return; }
  if (e.type === 'event_msg') {
    if (p.type === 'task_started') {
      activite(); s.etat = 'actif'; s.debut = Date.parse(p.started_at) || ts;
      s.rapport = null; s.commande = null; s.marque = null;
    } else if (p.type === 'task_complete') {
      activite(); s.etat = 'termine'; s.rapport = p.last_agent_message || s.message;
    } else if (p.type === 'turn_aborted') { activite(); s.etat = 'interrompu'; }
    else if (p.type === 'user_message') {
      const t = demandeUtile(p.message || ''); if (t) { activite(); s.demande = t.slice(0, 12000); s.etat = 'actif'; }
    } else if (p.type === 'agent_message') { activite(); s.message = p.message?.slice(0, 12000) || s.message; }
    return;
  }
  if (e.type !== 'response_item') return;
  if (p.type === 'message' && p.role === 'user') {
    const t = demandeUtile(texte(p));
    if (t) { activite(); s.demande = t.slice(0, 12000); s.etat = 'actif'; s.debut = ts; s.rapport = null; s.commande = null; }
  } else if (p.type === 'message' && p.role === 'assistant') {
    activite(); s.message = texte(p).slice(0, 12000); s.marque = 'codex';
    if (p.phase === 'final_answer') { s.etat = 'termine'; s.rapport = s.message; }
    else if (p.phase === 'commentary') s.etat = 'actif';
  } else if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(p.type)) {
    activite(); s.etat = 'actif';
    let args = p.arguments || p.input || p.action || '';
    if (typeof args === 'string') { try { args = JSON.parse(args); } catch {} }
    const detail = typeof args === 'object' ? args.cmd || args.command || args.code || args.path || '' : args;
    s.commande = { commande: `${p.name || 'shell'} ${Array.isArray(detail) ? detail.join(' ') : detail}`.replace(/\s+/g, ' ').slice(0, 220), lieu: s.cwd ? path.basename(s.cwd) : null };
    s.marque = /patch|edit|write/i.test(p.name || '') ? 'apply patch' : 'exec';
  } else if (['reasoning', 'function_call_output', 'custom_tool_call_output'].includes(p.type)) {
    activite(); s.etat = 'actif';
  }
}

function lireBloc(f, debut, taille) {
  const fd = fs.openSync(f, 'r');
  try { const b = Buffer.alloc(taille); const n = fs.readSync(fd, b, 0, taille, debut); return b.subarray(0, n); }
  finally { fs.closeSync(fd); }
}
function evenements(t) {
  return t.split('\n').flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } });
}

export function creerLecteurCodex({ racines = [path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')], fenetreHeures = 48, silenceMinutes = 15 } = {}) {
  const cache = new Map(), connus = new Map();
  let titres = new Map();
  let inventaire = [], dateInventaire = 0;
  function fichiers(now) {
    if (now - dateInventaire < 3000) return inventaire;
    const out = [];
    function visiter(d) {
      let entrees; try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entrees) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) visiter(f);
        else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(f);
      }
    }
    for (const r of racines) visiter(path.resolve(r.replace(/^~(?=[\\/]|$)/, os.homedir())));
    titres = new Map();
    for (const r of racines) {
      try {
        const index = path.join(path.resolve(r.replace(/^~(?=[\\/]|$)/, os.homedir())), '..', 'session_index.jsonl');
        const st = fs.statSync(index), debut = Math.max(0, st.size - LIMITE);
        for (const e of evenements(lireBloc(index, debut, Math.min(st.size, LIMITE)).toString('utf8'))) if (e.id && e.thread_name) titres.set(e.id, e.thread_name);
      } catch { /* L'index de titres est facultatif (CLI, versions anciennes). */ }
    }
    inventaire = out; dateInventaire = now;
    const presents = new Set(out); for (const f of cache.keys()) if (!presents.has(f)) cache.delete(f);
    return out;
  }
  function lire(f, st) {
    const precedent = cache.get(f);
    if (precedent && precedent.taille === st.size && precedent.mtime === st.mtimeMs) return precedent.s;
    const increment = precedent && st.size > precedent.taille && st.size - precedent.position <= LIMITE;
    const s = increment ? { ...precedent.s } : {};
    let debut = increment ? precedent.position : Math.max(0, st.size - LIMITE);
    if (!increment) for (const e of evenements(lireBloc(f, 0, Math.min(st.size, 256 * 1024)).toString('utf8'))) {
      if (e.type === 'session_meta' || e.type === 'turn_context') appliquerEvenement(s, e);
      else if (!s.initiale && e.type === 'response_item' && e.payload?.role === 'user') s.initiale = demandeUtile(texte(e.payload))?.slice(0, 12000) || null;
    }
    let b = lireBloc(f, debut, Math.min(LIMITE, st.size - debut));
    if (!increment && debut > 0) { const i = b.indexOf(10); if (i < 0) b = Buffer.alloc(0); else { debut += i + 1; b = b.subarray(i + 1); } }
    const fin = b.lastIndexOf(10);
    const position = fin < 0 ? debut : debut + fin + 1;
    if (fin >= 0) for (const e of evenements(b.subarray(0, fin + 1).toString('utf8'))) appliquerEvenement(s, e);
    cache.set(f, { taille: st.size, mtime: st.mtimeMs, position, s });
    return s;
  }
  function travaux(now = Date.now(), dejaSuivies = new Set()) {
    const resultats = new Map(); connus.clear();
    for (const f of fichiers(now)) {
      try {
        const st = fs.statSync(f);
        if (now - st.mtimeMs > fenetreHeures * 3600000) continue;
        const s = lire(f, st);
        if (!s.id || !s.date || now - s.date > fenetreHeures * 3600000 || dejaSuivies.has(s.id)) continue;
        const nom = `codex-local:${s.id}`;
        const statut = s.etat === 'actif' && now - s.date > silenceMinutes * 60000 ? 'silencieux' : s.etat || 'interrompu';
        const vivant = ['actif', 'silencieux'].includes(statut);
        const tache = (titres.get(s.id) || s.demande || s.initiale || (s.cwd && path.basename(s.cwd)) || 'Session Codex').replace(/\s+/g, ' ').slice(0, 160);
        const travail = { nom, agent: 'codex', origine: 'codex-local', titre: tache, tache, tacheDetail: s.demande?.slice(0, 700) || null,
          role: 'production', lot: s.id, tour: null, statut, modele: s.modele || null, pid: null,
          debut: s.debut || s.creation || st.birthtimeMs, fin: vivant ? null : s.date, derniereEcriture: s.date,
          tailleLog: st.size, message: vivant ? s.message?.slice(0, 900) || null : null,
          commande: vivant ? s.commande || null : null, derniereMarque: vivant ? s.marque || null : null,
          aSession: false, lanceParBureau: false, verdict: null, aRapport: !!s.rapport };
        if (!resultats.has(nom) || resultats.get(nom).derniereEcriture < s.date) { resultats.set(nom, travail); connus.set(nom, s); }
      } catch { /* fichier supprimé/écrit en parallèle : réessayer au prochain passage */ }
    }
    return [...resultats.values()];
  }
  function contenu(nom, vue) {
    const s = connus.get(nom); if (!s) return null;
    if (vue === 'consigne') return s.demande || null;
    if (vue === 'rapport') return s.rapport || null;
    return [`Session Codex : ${s.id}`, `Dernière activité : ${new Date(s.date).toISOString()}`, s.demande && `Demande : ${s.demande}`, s.message && `Message : ${s.message}`, s.commande && `Outil : ${s.commande.commande}`].filter(Boolean).join('\n\n');
  }
  return { travaux, contenu };
}
