// Bureau des agents : vue en direct des agents Codex (codex-run.sh) et Claude (sessions et sous-agents).
// Lecture seule : journaux, transcripts, processus, verrous de campagne. Aucune dépendance obligatoire.
// Usage : node serveur.mjs  → http://127.0.0.1:4317   (configuration : config.json, voir config.example.json)
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { creerActions, JETON } from './actions.mjs';
import { creerMonde } from './monde.mjs';

const ICI = path.dirname(fileURLToPath(import.meta.url));

// ---------- Configuration ----------
const DEFAUT = {
  port: 4317,
  hote: '127.0.0.1',
  codexOut: ['/private/tmp/claude-*/*/*/scratchpad/codex'],
  consignes: ['/private/tmp/claude-*/*/*/scratchpad', '/private/tmp/claude-*/*/*/scratchpad/codex'],
  claudeProjects: ['~/.claude/projects/*'],
  claudeProjectFilter: null,
  campaignLock: '/tmp/jnapps-campaign.lock',
  placesMax: 6,
  silenceMinutes: 15,
  fenetreHeures: 48,
  actions: true,           // false : bureau en lecture seule (aucun bouton d'action)
  codexModel: 'gpt-6.1-sol',
  codexBin: null,          // détecté (application ChatGPT, Homebrew…)
  claudeBin: null,         // détecté (application Claude, PATH…)
  depot: null,             // dossier de travail des nouvelles missions
  codexRun: null,          // script du poste pour les nouvelles missions (ex. codex-run.sh du kit) ; sinon lanceur.sh
  maisonsMax: 14,          // personnages sans travail affichés dans les maisons
  longueCommandeMinutes: 5, // commande sans sortie depuis ce délai : l'agent patiente au café
  reunion: '09:00',        // réunion du matin (jours ouvrés), heure locale ; null : pas de réunion
  reunionMinutes: 15,
  fete: { jour: 5, heure: '17:00', minutes: 120, lotsMin: 2 }, // fête de fin de semaine si assez de lots approuvés
  quotaBas: 20,            // quota Codex restant (%) sous lequel les agents Codex bâillent
  chaleur: 0.75,           // charge / cœurs au-dessus de laquelle la baie chauffe
};
const CONFIG = (() => {
  let c = { ...DEFAUT };
  const f = process.env.BUREAU_CONFIG || path.join(ICI, 'config.json');
  try { c = { ...c, ...JSON.parse(fs.readFileSync(f, 'utf8')) }; } catch (e) { if (e.code !== 'ENOENT') console.warn(`config illisible (${f}) : ${e.message}`); }
  if (process.env.PORT) c.port = Number(process.env.PORT);
  if (process.env.CODEX_OUT) c.codexOut = process.env.CODEX_OUT.split(':');
  if (process.env.CLAUDE_PROJECTS) c.claudeProjects = process.env.CLAUDE_PROJECTS.split(':');
  if (process.env.CAMPAIGN_LOCK) c.campaignLock = process.env.CAMPAIGN_LOCK;
  return c;
})();
const FENETRE = CONFIG.fenetreHeures * 3600_000;

// Développe un motif simple : `~` et `*` par segment de chemin.
function developper(motif) {
  const abs = motif.replace(/^~(?=\/|$)/, os.homedir());
  let courants = [abs.startsWith('/') ? '/' : ''];
  for (const seg of abs.split('/').filter(Boolean)) {
    const suivants = [];
    for (const base of courants) {
      if (!seg.includes('*')) { suivants.push(path.join(base, seg)); continue; }
      const re = new RegExp('^' + seg.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      try { for (const e of fs.readdirSync(base || '.', { withFileTypes: true })) if (e.isDirectory() && re.test(e.name)) suivants.push(path.join(base, e.name)); } catch {}
    }
    courants = suivants;
  }
  return courants.filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
}

// ---------- Utilitaires fichiers ----------
function queue(fichier, octets) {
  const fd = fs.openSync(fichier, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const n = Math.min(size, octets);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, size - n);
    return buf.toString('utf8');
  } finally { fs.closeSync(fd); }
}
function tete(fichier, octets) {
  const fd = fs.openSync(fichier, 'r');
  try { const buf = Buffer.alloc(octets); const n = fs.readSync(fd, buf, 0, octets, 0); return buf.subarray(0, n).toString('utf8'); }
  finally { fs.closeSync(fd); }
}
function lireSur(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }

// ---------- Tâche : résumé de la consigne donnée à l'agent ----------
const nettoyer = s => s.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim();
const majuscule = s => s ? s[0].toUpperCase() + s.slice(1) : s;
function premierePhrase(s) { const m = s.match(/^(.{20,}?[.!?])(\s|$)/); return m ? m[1] : s; }
export function extraireTache(consigne) {
  if (!consigne) return null;
  const lignes = consigne.split('\n').map(l => l.trim()).filter(Boolean);
  let court = null;
  for (const l of lignes) {
    const m = l.match(/^(?:#+\s*)?(?:T[âa]che|Mission|Objectif|But|Task)\s*:\s*(.+)/i);
    if (m) { const gras = m[1].match(/\*\*(.+?)\*\*/); court = nettoyer(gras ? gras[1] : premierePhrase(m[1])); break; }
  }
  if (!court) for (const l of lignes) {
    const m = l.match(/^Tu es (?:l['’]|le |la |un |une )?(.+)/i);
    if (m) { court = nettoyer(premierePhrase(m[1])).replace(/[.]$/, ''); break; }
  }
  if (!court) {
    const l = lignes.find(x => !/^(Réponds|Reponds|Redige|Rédige|Lis d'abord|Environnement|Contexte|Dépôt|Depot)\b/i.test(x)) || lignes[0];
    court = nettoyer(premierePhrase(l || ''));
  }
  const i = consigne.search(/^(?:#+\s*)?(?:T[âa]che|Mission|Objectif|Tu es)/im);
  return { tache: majuscule(court).slice(0, 160), detail: nettoyer(consigne.slice(Math.max(0, i))).slice(0, 700) };
}

// ---------- Agents Codex (codex-run.sh) ----------
function etimeEnSec(e) {
  const [j, reste] = e.includes('-') ? e.split('-') : ['0', e];
  const p = reste.split(':').map(Number);
  while (p.length < 3) p.unshift(0);
  return Number(j) * 86400 + p[0] * 3600 + p[1] * 60 + p[2];
}
function travauxVivants() {
  const vivants = new Map();
  try {
    const ps = execFileSync('ps', ['-axo', 'pid=,etime=,command='], { encoding: 'utf8', maxBuffer: 1 << 24 });
    for (const ligne of ps.split('\n')) {
      const m = ligne.match(/^\s*(\d+)\s+(\S+)\s+(?:\/bin\/)?sh\s+\S*(?:codex-run|lanceur)\.sh\s+(\S+)(?:\s+(\S+))?/);
      if (m) vivants.set(m[3], { pid: Number(m[1]), depuisSec: etimeEnSec(m[2]), consigne: m[4] || null });
    }
  } catch {}
  return vivants;
}
function placesCampagne() {
  const places = [], B = CONFIG.campaignLock;
  if (!B) return places;
  for (const s of [B, ...[2, 3, 4, 5, 6, 7, 8].map(i => `${B}.${i}`)]) {
    if (!fs.existsSync(s)) continue;
    const pid = Number((lireSur(`${s}.pid`) || '').trim());
    let vivant = false;
    if (pid) { try { process.kill(pid, 0); vivant = true; } catch {} }
    places.push({ place: path.basename(s), pid: pid || null, vivant });
  }
  return places;
}
function batterie() {
  if (process.platform !== 'darwin') return null;
  try {
    const t = execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' });
    const m = t.match(/(\d+)%;\s*([^;]+);\s*([^\s]+)?/);
    return { secteur: /AC Power/.test(t), pourcent: m ? Number(m[1]) : null, etat: m ? m[2].trim() : null, restant: m && m[3] && m[3] !== '(no' ? m[3] : null };
  } catch { return null; }
}
// Rôle et lot déduits du nom : hub-h1-2-revue-r4 → lot hub-h1-2, rôle revue, tour 4.
function decoder(nom) {
  let role = 'production';
  if (/(^|-)(revue|review)(-|$)/.test(nom)) role = 'revue';
  else if (/^int-|(^|-)integration(-|$)/.test(nom)) role = 'integration';
  else if (/(^|-)diag(-|$)|^diag/.test(nom)) role = 'diagnostic';
  else if (/(^|-)correction(-|$)/.test(nom)) role = 'correction';
  const tour = (nom.match(/-r(\d+)$/) || [])[1];
  const lot = nom
    .replace(/^(int|prod|diag|review|revue)-/, '')
    .replace(/-(revue|review|correction|producteur|integration)(-r\d+)?$/, '')
    .replace(/-r\d+$/, '')
    .replace(/-(p\d+|socle|session|shell|audience)$/, '');
  return { role, lot, tour: tour ? Number(tour) : null };
}
function dernierMessage(q) {
  const i = q.lastIndexOf('\ncodex\n');
  if (i < 0) return null;
  let t = q.slice(i + 7);
  const fin = t.search(/\n(exec|tokens used|codex)\n/);
  if (fin >= 0) t = t.slice(0, fin);
  return t.trim().slice(0, 900);
}
function derniereCommande(q) {
  const i = q.lastIndexOf('\nexec\n');
  if (i < 0) return null;
  const l = q.slice(i + 6).split('\n').filter(Boolean);
  let c = (l[0] || '').replace(/^\/bin\/zsh -lc '?/, '').replace(/^export PATH=\S+\s*/, '');
  if (c.length < 8 && l[1]) c += ' ' + l[1];
  const lieu = (q.slice(i).match(/ in (\/[^\n]+)\n/) || [])[1];
  return { commande: c.slice(0, 220), lieu: lieu ? path.basename(lieu) : null };
}
function verdict(rapport) {
  if (!rapport) return null;
  const v = {};
  rapport = rapport.slice(0, 700);
  const p0 = rapport.match(/P0\s*=\s*(\d+)/); if (p0) v.p0 = Number(p0[1]);
  const p1 = rapport.match(/P1\s*=\s*(\d+)/); if (p1) v.p1 = Number(p1[1]);
  if (/NON[ _-]QUALIFI/i.test(rapport)) v.qualifie = false;
  else if (/\bQUALIFI[ÉE]/i.test(rapport)) v.qualifie = true;
  const sha = rapport.match(/\b[0-9a-f]{9,40}\b/); if (sha) v.sha = sha[0].slice(0, 9);
  return v;
}

const consignesCodex = new Map(); // nom → chemin de la consigne (retenu même après la fin du travail)
const tachesCache = new Map();    // chemin → { mtime, tache }
function tacheDe(fichier) {
  if (!fichier) return null;
  let st; try { st = fs.statSync(fichier); } catch { return null; }
  const k = tachesCache.get(fichier);
  if (k && k.mtime === st.mtimeMs) return k.tache;
  const t = extraireTache(tete(fichier, 12_000));
  tachesCache.set(fichier, { mtime: st.mtimeMs, tache: t });
  return t;
}
const dossiersCodex = new Map(); // nom → dossier de sortie
// Index des consignes (<nom>.prompt ou <nom>.md) dans les dossiers configurés, rafraîchi toutes les minutes.
let indexConsignes = { date: 0, carte: new Map() };
function consigneIndexee(nom) {
  if (Date.now() - indexConsignes.date > 60_000) {
    const carte = new Map();
    for (const dir of (CONFIG.consignes || []).flatMap(developper)) {
      let fs_ = []; try { fs_ = fs.readdirSync(dir); } catch { continue; }
      for (const f of fs_) {
        const m = f.match(/^(.+)\.(prompt|md)$/); if (!m) continue;
        const p = path.join(dir, f), prec = carte.get(m[1]);
        try { const t = fs.statSync(p).mtimeMs; if (!prec || prec.t < t) carte.set(m[1], { p, t }); } catch {}
      }
    }
    indexConsignes = { date: Date.now(), carte };
  }
  return indexConsignes.carte.get(nom)?.p || null;
}

function agentsCodex(maintenant) {
  const vivants = travauxVivants();
  const noms = new Map();
  for (const dir of [...CONFIG.codexOut.flatMap(developper), path.join(ICI, 'donnees', 'codex')]) {
    let fichiers = []; try { fichiers = fs.readdirSync(dir); } catch { continue; }
    for (const f of fichiers) {
      if (!f.endsWith('.log') || f === 'quota-bas.log') continue;
      const nom = f.slice(0, -4), st = fs.statSync(path.join(dir, f));
      if (maintenant - st.mtimeMs > FENETRE && !vivants.has(nom)) continue;
      const prec = noms.get(nom);
      if (!prec || prec.mtime < st.mtimeMs) noms.set(nom, { dir, mtime: st.mtimeMs });
    }
  }
  for (const [nom, v] of vivants) {
    if (v.consigne) consignesCodex.set(nom, v.consigne);
    if (!noms.has(nom)) noms.set(nom, { dir: v.consigne ? path.dirname(v.consigne) : null, mtime: 0 });
  }
  let quota = null, quotaDate = 0;
  const travaux = [];
  for (const [nom, { dir }] of noms) {
    dossiersCodex.set(nom, dir);
    const log = dir && path.join(dir, `${nom}.log`);
    let st = null; try { st = fs.statSync(log); } catch {}
    const vivant = vivants.get(nom);
    const q = st ? queue(log, 300_000) : '';
    const h = st ? tete(log, 3000) : '';
    const modele = (h.match(/^model=(\S+)/m) || [])[1] || null;
    const qm = h.match(/quota_used=([\d.]+) restant=([\d.]+) reinit=(\S+)/);
    if (qm && st && st.birthtimeMs > quotaDate) { quotaDate = st.birthtimeMs; quota = { utilise: Number(qm[1]), restant: Number(qm[2]), reinit: qm[3].replace('_', ' ') }; }
    const exitM = q.match(/\nexit=(\d+)\s*$/);
    const rapport = dir ? lireSur(path.join(dir, `${nom}.last.md`)) : null;
    const debut = vivant ? maintenant - vivant.depuisSec * 1000 : (st ? st.birthtimeMs : null);
    const derniereEcriture = st ? st.mtimeMs : null;
    let statut;
    if (vivant) statut = derniereEcriture && maintenant - derniereEcriture > CONFIG.silenceMinutes * 60_000 ? 'silencieux' : 'actif';
    else if (exitM) statut = exitM[1] === '0' ? 'termine' : 'echec';
    else statut = 'interrompu';
    const consigne = consignesCodex.get(nom) || consigneIndexee(nom);
    const t = tacheDe(consigne);
    travaux.push({
      nom, agent: 'codex', ...decoder(nom), statut, modele, pid: vivant?.pid ?? null,
      tache: t?.tache || null, tacheDetail: t?.detail || null,
      debut, fin: vivant ? null : derniereEcriture, derniereEcriture,
      tailleLog: st ? st.size : 0,
      message: vivant ? dernierMessage(q) : null,
      commande: vivant ? derniereCommande(q) : null,
      derniereMarque: vivant ? ([...q.matchAll(/\n(exec|codex|apply patch|tokens used)\n/g)].at(-1)?.[1] ?? null) : null,
      limite: /limite_atteinte=1/.test(q), repli: /fallback=gpt-6-sol/.test(q),
      aSession: /session id:\s*[0-9a-f-]{36}/.test(h), lanceParBureau: /^lance_par=bureau/m.test(h),
      verdict: verdict(rapport), aRapport: !!rapport,
    });
  }
  return { travaux, quota };
}

// ---------- Agents Claude (sessions et sous-agents) ----------
const cacheClaude = new Map();    // chemin → { taille, mtime, resume }
const fichiersClaude = new Map(); // nom → chemin du transcript

function lignesQueue(f, octets) {
  const l = queue(f, octets).split('\n'); if (l.length > 1) l.shift();
  const out = [];
  for (const x of l) { if (!x.trim()) continue; try { out.push(JSON.parse(x)); } catch {} }
  return out;
}
const contenu = e => { const c = e?.message?.content; return Array.isArray(c) ? c : []; };
function texteUtilisateur(e) {
  if (e?.type !== 'user' || e.isMeta) return null;
  const c = e.message?.content;
  const t = typeof c === 'string' ? c : Array.isArray(c) ? c.filter(x => x.type === 'text').map(x => x.text).join('\n') : '';
  if (!t.trim() || /^\s*</.test(t) || /^Caveat:/.test(t)) return null;
  return t.trim();
}
function resumeOutil(u) {
  const i = u.input || {};
  const c = i.command || i.description || i.file_path || i.pattern || i.url || i.query || i.prompt || '';
  return { commande: `${u.name}${c ? ' ' + String(c).replace(/\s+/g, ' ') : ''}`.slice(0, 220), lieu: null, outil: u.name };
}
function lireTranscript(f, st) {
  const k = cacheClaude.get(f);
  if (k && k.taille === st.size && k.mtime === st.mtimeMs) return k.resume;
  const ev = lignesQueue(f, 400_000);
  let dernierTs = 0, message = null, commande = null, remise = null, finTour = false, demande = null;
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i];
    const ts = Date.parse(e.timestamp || '') || 0;
    if (!dernierTs && ts) {
      dernierTs = ts;
      finTour = (e.type === 'system' && e.subtype === 'stop_hook_summary') || (e.type === 'assistant' && e.message?.stop_reason === 'end_turn');
    }
    if (!demande) demande = texteUtilisateur(e);
    if (e.type !== 'assistant') continue;
    for (const c of contenu(e).slice().reverse()) {
      if (c.type === 'tool_use' && c.name === 'SubagentHandback' && !remise) remise = String(c.input?.message || '');
      if (c.type === 'tool_use' && !commande && c.name !== 'SubagentHandback') commande = resumeOutil(c);
      if (c.type === 'text' && !message && c.text?.trim()) message = c.text.trim();
    }
  }
  const der = ev[ev.length - 1];
  const outilEnCours = der?.type === 'assistant' && contenu(der).some(c => c.type === 'tool_use');
  const resume = { dernierTs, message, commande, remise, finTour, outilEnCours, demande };
  cacheClaude.set(f, { taille: st.size, mtime: st.mtimeMs, resume });
  return resume;
}
function premiereConsigne(f) {
  try { for (const l of tete(f, 60_000).split('\n')) { const t = texteUtilisateur(JSON.parse(l)); if (t) return t; } } catch {}
  return '';
}
function nomProjet(dir) {
  const b = path.basename(dir).replace(/^-Users-[^-]+-/, '');
  return b.split('-').slice(-3).join('-').replace(/^(Documents|src)-/, '');
}
function decoderClaude(desc, consigne, type) {
  const t = `${desc} ${consigne.slice(0, 300)}`;
  let role = 'analyse';
  if (/relecteur|relecture|revue|review|avis|vérifi/i.test(t)) role = 'revue';
  else if (/intégr|assembl/i.test(desc)) role = 'integration';
  else if (/corrig|correction/i.test(desc)) role = 'correction';
  else if (/produc|implémen|écri/i.test(desc) && type !== 'Plan' && type !== 'Explore') role = 'production';
  const lot = ((desc.match(/\b(B-\d+[A-Z]?\d*|H\d+-\d+\w*|pilote[- ]?\d+\w*)/i) || [])[1] || 'claude').toLowerCase();
  const tour = Number((desc.match(/\br(\d+)\b/i) || [])[1]) || null;
  return { role, lot, tour };
}
function agentsClaude(maintenant) {
  const agents = [], sessions = [];
  const filtre = CONFIG.claudeProjectFilter ? new RegExp(CONFIG.claudeProjectFilter) : null;
  for (const proj of CONFIG.claudeProjects.flatMap(developper)) {
    if (filtre && !filtre.test(path.basename(proj))) continue;
    const projet = nomProjet(proj);
    let ents = []; try { ents = fs.readdirSync(proj, { withFileTypes: true }); } catch { continue; }
    for (const d of ents) {
      if (d.isFile() && d.name.endsWith('.jsonl')) {
        const f = path.join(proj, d.name); let st; try { st = fs.statSync(f); } catch { continue; }
        if (maintenant - st.mtimeMs > 2 * 3600_000) continue;
        const r = lireTranscript(f, st);
        if (!r.dernierTs || maintenant - r.dernierTs > 2 * 3600_000) continue;
        const id = d.name.slice(0, -6);
        let titre = id.slice(0, 8); try { titre = JSON.parse(fs.readFileSync(path.join(proj, id, 'custom-title.json'), 'utf8')).customTitle || titre; } catch {}
        const actif = !r.finTour && maintenant - r.dernierTs < 10 * 60_000;
        const nom = 'session:' + id;
        fichiersClaude.set(nom, f);
        sessions.push({ nom, titre, projet, statut: actif ? 'actif' : 'attente', derniereEcriture: r.dernierTs,
          tache: titre, tacheDetail: r.demande ? 'Dernière demande : ' + r.demande.slice(0, 600) : null,
          message: r.message?.slice(0, 900) || null, commande: r.commande });
        continue;
      }
      if (!d.isDirectory()) continue;
      const sd = path.join(proj, d.name, 'subagents');
      let subs = []; try { subs = fs.readdirSync(sd).filter(x => x.endsWith('.jsonl')); } catch { continue; }
      for (const x of subs) {
        const f = path.join(sd, x); let st; try { st = fs.statSync(f); } catch { continue; }
        if (maintenant - st.mtimeMs > FENETRE) continue;
        const r = lireTranscript(f, st);
        if (!r.dernierTs || maintenant - r.dernierTs > FENETRE) continue;
        const id = x.slice(0, -6).replace(/^agent-/, '');
        let meta = {}; try { meta = JSON.parse(fs.readFileSync(f.replace(/\.jsonl$/, '.meta.json'), 'utf8')); } catch {}
        const desc = meta.description || id;
        const consigne = premiereConsigne(f);
        const age = maintenant - r.dernierTs;
        let statut;
        if (r.remise || (r.finTour && age > 60_000)) statut = 'termine';
        else if (age < CONFIG.silenceMinutes * 60_000 || (r.outilEnCours && age < 40 * 60_000)) statut = 'actif';
        else if (age < 60 * 60_000) statut = 'silencieux';
        else statut = 'interrompu';
        const nom = 'claude:' + id;
        fichiersClaude.set(nom, f);
        const rapport = r.remise || (statut === 'termine' ? r.message : null);
        const t = extraireTache(consigne);
        const vivant = statut === 'actif' || statut === 'silencieux';
        agents.push({
          nom, titre: desc, projet, agent: 'claude', typeAgent: meta.agentType || null, ...decoderClaude(desc, consigne, meta.agentType),
          tache: desc !== id ? desc : t?.tache || null, tacheDetail: t?.detail || null,
          statut, modele: 'claude', pid: null, debut: st.birthtimeMs, fin: vivant ? null : r.dernierTs,
          derniereEcriture: r.dernierTs, tailleLog: st.size,
          message: vivant ? r.message?.slice(0, 900) || null : null,
          commande: vivant ? r.commande : null,
          derniereMarque: r.commande?.outil === 'Bash' ? 'exec' : r.commande?.outil && /Edit|Write/.test(r.commande.outil) ? 'apply patch' : r.commande ? 'outil' : null,
          verdict: verdict(rapport), aRapport: !!rapport,
        });
      }
    }
  }
  return { agents, sessions };
}
function texteClaude(nom, vue) {
  const f = fichiersClaude.get(nom); if (!f) return null;
  const ev = lignesQueue(f, vue === 'journal' ? 200_000 : 600_000);
  if (vue === 'rapport') {
    for (let i = ev.length - 1; i >= 0; i--) for (const c of contenu(ev[i]).slice().reverse()) if (c.type === 'tool_use' && c.name === 'SubagentHandback') return String(c.input?.message || '');
    for (let i = ev.length - 1; i >= 0; i--) if (ev[i].type === 'assistant') { const t = contenu(ev[i]).filter(c => c.type === 'text').map(c => c.text).join('\n'); if (t.trim()) return t; }
    return null;
  }
  const out = [];
  for (const e of ev.slice(-150)) {
    const h = e.timestamp ? new Date(e.timestamp).toLocaleTimeString('fr-FR') : '';
    const u = texteUtilisateur(e); if (u) out.push(`${h} 👤 ${u.slice(0, 600)}`);
    for (const c of contenu(e)) {
      if (e.type === 'assistant' && c.type === 'text' && c.text.trim()) out.push(`${h} 💬 ${c.text.trim()}`);
      else if (e.type === 'assistant' && c.type === 'tool_use') out.push(`${h} ▸ ${resumeOutil(c).commande}`);
      else if (c.type === 'tool_result') { const t = typeof c.content === 'string' ? c.content : (Array.isArray(c.content) ? c.content.map(x => x.text || '').join('') : ''); out.push(`${h}   ↳ ${t.replace(/\s+$/, '').slice(0, 400)}`); }
    }
  }
  return out.join('\n');
}

// ---------- État global ----------
function etat() {
  const maintenant = Date.now();
  const codex = agentsCodex(maintenant);
  const claude = agentsClaude(maintenant);
  const travaux = [...codex.travaux, ...claude.agents].sort((a, b) => (b.debut || 0) - (a.debut || 0));
  return {
    genereA: maintenant, poste: os.hostname(), travaux, sessions: claude.sessions, quota: codex.quota,
    machine: { charge: os.loadavg().map(x => Math.round(x * 10) / 10), coeurs: os.cpus().length, batterie: batterie() },
    places: placesCampagne(), placesMax: CONFIG.placesMax,
  };
}

// ---------- Actions ----------
const actions = creerActions({ ICI, CONFIG, dossierCodex: n => dossiersCodex.get(n), fichierClaude: n => fichiersClaude.get(n) });
const monde = creerMonde({ ICI, CONFIG });
const HOTES = new Set([`127.0.0.1:${CONFIG.port}`, `localhost:${CONFIG.port}`, `[::1]:${CONFIG.port}`]);
function autorise(req) {
  if (!CONFIG.actions) return 'actions désactivées sur ce poste';
  if (req.headers['x-bureau-jeton'] !== JETON) return 'jeton absent ou périmé : rechargez la page';
  if (CONFIG.hote === '127.0.0.1' && !HOTES.has(req.headers.host)) return 'hôte refusé';
  const o = req.headers.origin; if (o && !HOTES.has(o.replace(/^https?:\/\//, ''))) return 'origine refusée';
  return null;
}
function corps(req) {
  return new Promise((ok, ko) => {
    let t = ''; req.on('data', d => { t += d; if (t.length > 200_000) { ko(new Error('requête trop grosse')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(t || '{}')); } catch { ko(new Error('JSON invalide')); } });
  });
}
async function action(req, res, url) {
  if (req.method !== 'POST') return texte(res, 405, 'POST attendu');
  const refus = autorise(req); if (refus) return texte(res, 403, JSON.stringify({ erreur: refus }), 'application/json');
  try {
    const b = await corps(req);
    const nomOk = n => typeof n === 'string' && nomValide(n);
    let r;
    switch (url.pathname) {
      case '/api/action/question': if (!nomOk(b.nom) || !b.question?.trim()) throw new Error('agent ou question manquant'); r = actions.poserQuestion(b.nom, String(b.question).slice(0, 4000)); break;
      case '/api/action/suite': if (!nomOk(b.source)) throw new Error('agent source manquant'); r = actions.consigneDeSuite(b.source, String(b.nom || ''), String(b.consigne || '').slice(0, 50_000)); break;
      case '/api/action/arret': if (!nomOk(b.nom)) throw new Error('agent manquant'); r = actions.arreter(b.nom); break;
      case '/api/action/mission': r = actions.nouvelleMission(String(b.nom || ''), String(b.consigne || '').slice(0, 50_000)); break;
      default: return texte(res, 404, '');
    }
    texte(res, 200, JSON.stringify({ ok: true, ...r }), 'application/json');
  } catch (e) { texte(res, 400, JSON.stringify({ erreur: e.message }), 'application/json'); }
}

// ---------- Serveur HTTP ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css' };
const THREE_LOCAL = path.join(ICI, 'node_modules', 'three');
const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/';
const texte = (res, code, corps, type = 'text/plain; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' }); res.end(corps); };
const nomValide = n => /^[\w.:-]+$/.test(n);

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/action/')) return void action(req, res, url);
    if (url.pathname === '/api/etat') { const e = etat(); return texte(res, 200, JSON.stringify({ ...e, monde: monde.enrichir(e), actions: !!CONFIG.actions, codexRun: !!CONFIG.codexRun }), 'application/json; charset=utf-8'); }
    if (url.pathname === '/api/chronique') {
      const j = url.searchParams.get('jour'), c = monde.chronique(j && /^\d{4}-\d{2}-\d{2}$/.test(j) ? new Date(j + 'T12:00:00') : new Date());
      return url.searchParams.get('format') === 'json' ? texte(res, 200, JSON.stringify(c), 'application/json; charset=utf-8') : texte(res, 200, c.texte);
    }
    if (url.pathname === '/api/carriere') { const c = monde.carriere(url.searchParams.get('id') || ''); return texte(res, c ? 200 : 404, JSON.stringify(c), 'application/json; charset=utf-8'); }
    if (url.pathname === '/api/questions') { const nom = url.searchParams.get('nom') || ''; return texte(res, 200, JSON.stringify(nomValide(nom) ? actions.questionsDe(nom) : []), 'application/json; charset=utf-8'); }
    if (url.pathname === '/api/rapport' || url.pathname === '/api/journal') {
      const nom = url.searchParams.get('nom') || '', vue = url.pathname.slice(5);
      if (!nomValide(nom)) return texte(res, 400, '');
      if (/^(claude|session):/.test(nom)) { const t = texteClaude(nom, vue); return texte(res, t ? 200 : 404, t || ''); }
      const dir = dossiersCodex.get(nom); if (!dir) return texte(res, 404, '');
      if (vue === 'rapport') { const r = lireSur(path.join(dir, `${nom}.last.md`)); return texte(res, r ? 200 : 404, r || 'Pas encore de rapport final.'); }
      const f = path.join(dir, `${nom}.log`);
      return fs.existsSync(f) ? texte(res, 200, queue(f, 40_000)) : texte(res, 404, '');
    }
    if (url.pathname === '/api/consigne') {
      const nom = url.searchParams.get('nom') || '';
      if (!nomValide(nom)) return texte(res, 400, '');
      if (/^claude:/.test(nom)) { const t = fichiersClaude.get(nom) && premiereConsigne(fichiersClaude.get(nom)); return texte(res, t ? 200 : 404, t || 'Consigne introuvable.'); }
      if (/^session:/.test(nom)) { const f = fichiersClaude.get(nom), r = f && lireTranscript(f, fs.statSync(f)); return texte(res, r?.demande ? 200 : 404, r?.demande ? 'Dernière demande du propriétaire :\n\n' + r.demande : 'Aucune demande trouvée.'); }
      const f = consignesCodex.get(nom) || consigneIndexee(nom);
      const t = f && lireSur(f);
      return texte(res, t ? 200 : 404, t || 'Consigne introuvable.');
    }
    // Three.js : copie locale (npm install) sinon CDN
    if (url.pathname.startsWith('/vendor/three/')) {
      const rel = path.normalize(url.pathname.slice('/vendor/three/'.length));
      if (rel.startsWith('..')) return texte(res, 400, '');
      const f = path.join(THREE_LOCAL, rel);
      if (fs.existsSync(f)) { res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=86400' }); return res.end(fs.readFileSync(f)); }
      res.writeHead(302, { location: THREE_CDN + rel }); return res.end();
    }
    const page = { '/': 'bureau3d.html', '/pixel': 'bureau.html', '/tableau': 'index.html' }[url.pathname];
    if (!page) return texte(res, 404, 'Introuvable');
    const html = fs.readFileSync(path.join(ICI, 'public', page), 'utf8').replace('</head>', `<meta name="jeton" content="${CONFIG.actions ? JETON : ''}">\n</head>`);
    texte(res, 200, html, TYPES['.html']);
  } catch (e) { texte(res, 500, String(e)); }
}).listen(CONFIG.port, CONFIG.hote, () => console.log(`Bureau des agents (${os.hostname()}) : http://${CONFIG.hote}:${CONFIG.port}`));
