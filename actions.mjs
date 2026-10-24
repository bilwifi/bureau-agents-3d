// Actions du bureau : questionner une copie d'un agent, consigne de suite, arrêt, nouvelle mission.
// Garde-fous : écoute locale seulement, jeton par démarrage, vérification de l'hôte et de l'origine,
// confirmation côté page, journal de chaque action dans donnees/actions.log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';

export const JETON = crypto.randomBytes(24).toString('hex');

export function creerActions({ ICI, CONFIG, dossierCodex, fichierClaude }) {
  const DONNEES = path.join(ICI, 'donnees');
  const SORTIE = path.join(DONNEES, 'codex');
  const QUESTIONS = path.join(DONNEES, 'questions');
  const CONSIGNES = path.join(DONNEES, 'consignes');
  for (const d of [SORTIE, QUESTIONS, CONSIGNES]) fs.mkdirSync(d, { recursive: true });
  const questions = new Map(); // id → { agent, question, etat, debut, fichier, pid }

  // ---------- Binaires ----------
  const premierExecutable = liste => liste.find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }) || null;
  function codexBin() {
    return CONFIG.codexBin || premierExecutable(['/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', '/Applications/ChatGPT.app/Contents/Resources/codex', '/opt/homebrew/bin/codex', '/usr/local/bin/codex', path.join(os.homedir(), '.local/bin/codex')]) || 'codex';
  }
  function claudeBin() {
    if (CONFIG.claudeBin) return CONFIG.claudeBin;
    const base = path.join(os.homedir(), 'Library/Application Support/Claude/claude-code');
    const candidats = [];
    try { for (const v of fs.readdirSync(base)) for (const h of fs.readdirSync(path.join(base, v))) candidats.push({ p: path.join(base, v, h, 'claude.app/Contents/MacOS/claude'), t: fs.statSync(path.join(base, v, h)).mtimeMs }); } catch {}
    const recent = premierExecutable(candidats.sort((a, b) => b.t - a.t).map(c => c.p));
    return recent || premierExecutable(['/opt/homebrew/bin/claude', '/usr/local/bin/claude', path.join(os.homedir(), '.local/bin/claude')]) || 'claude';
  }
  const envAvecNode = () => ({ ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` });

  // ---------- Journal ----------
  function journal(action, details) {
    const ligne = JSON.stringify({ date: new Date().toISOString(), poste: os.hostname(), action, ...details }) + '\n';
    fs.appendFileSync(path.join(DONNEES, 'actions.log'), ligne);
  }

  // ---------- Informations sur un travail Codex ----------
  function infoCodex(nom) {
    const dir = dossierCodex(nom); if (!dir) return null;
    const log = path.join(dir, `${nom}.log`);
    let tete = ''; try { const fd = fs.openSync(log, 'r'); const b = Buffer.alloc(8000); const n = fs.readSync(fd, b, 0, 8000, 0); fs.closeSync(fd); tete = b.subarray(0, n).toString('utf8'); } catch { return null; }
    return {
      dir, log,
      session: (tete.match(/session id:\s*([0-9a-f-]{36})/) || [])[1] || null,
      workdir: (tete.match(/^workdir:\s*(.+)$/m) || [])[1]?.trim() || CONFIG.depot || os.homedir(),
      modele: (tete.match(/^model=(\S+)/m) || [])[1] || CONFIG.codexModel,
    };
  }
  // ---------- Informations sur une session Claude ----------
  function infoClaude(nom) {
    const f = fichierClaude(nom); if (!f) return null;
    let cwd = null;
    try {
      const fd = fs.openSync(f, 'r'); const st = fs.fstatSync(fd); const n = Math.min(st.size, 200_000); const b = Buffer.alloc(n); fs.readSync(fd, b, 0, n, st.size - n); fs.closeSync(fd);
      const m = [...b.toString('utf8').matchAll(/"cwd":"((?:[^"\\]|\\.)*)"/g)].at(-1); if (m) cwd = JSON.parse(`"${m[1]}"`);
    } catch {}
    return { fichier: f, session: path.basename(f, '.jsonl'), cwd: cwd || os.homedir() };
  }

  // ---------- 1. Question à une copie (lecture seule) ----------
  function poserQuestion(nom, question) {
    const id = crypto.randomBytes(6).toString('hex');
    const fichier = path.join(QUESTIONS, `${id}.md`);
    const consigne = `Question du propriétaire, posée depuis le bureau des agents. Tu es une copie : réponds en français, brièvement et concrètement, à partir de ce que tu sais déjà de ton travail. Ne modifie rien, ne lance aucune commande qui écrit, ne pousse rien.\n\nQuestion : ${question}`;
    let enfant;
    if (/^session:/.test(nom)) {
      const c = infoClaude(nom); if (!c) throw new Error('session introuvable');
      const sortie = fs.openSync(fichier, 'w');
      enfant = spawn(claudeBin(), ['-p', '--resume', c.session, '--fork-session', '--no-session-persistence', '--tools', 'Read,Grep,Glob', '--output-format', 'text', consigne],
        { cwd: c.cwd, env: envAvecNode(), stdio: ['ignore', sortie, sortie], detached: true });
    } else if (/^claude:/.test(nom)) {
      throw new Error("un sous-agent Claude ne se questionne pas directement : interrogez sa session parente");
    } else {
      const c = infoCodex(nom); if (!c?.session) throw new Error("identifiant de session Codex introuvable dans le journal");
      const brut = path.join(QUESTIONS, `${id}.log`);
      const sortie = fs.openSync(brut, 'w');
      enfant = spawn(codexBin(), ['exec', 'fork', c.session, '--ephemeral', '-c', 'sandbox_mode="read-only"', '-c', 'approval_policy="never"', '-m', c.modele || CONFIG.codexModel, '--skip-git-repo-check', '-o', fichier, '-'],
        { cwd: c.workdir, env: envAvecNode(), stdio: ['pipe', sortie, sortie], detached: true });
      enfant.stdin.end(consigne);
    }
    const q = { id, agent: nom, question, etat: 'en cours', debut: Date.now(), fichier, pid: enfant.pid };
    questions.set(id, q);
    enfant.on('exit', code => { q.etat = code === 0 ? 'repondu' : 'echec'; q.code = code; q.fin = Date.now(); });
    enfant.unref();
    journal('question', { agent: nom, id, question: question.slice(0, 500) });
    return { id };
  }
  function lireQuestion(id) {
    const q = questions.get(id); if (!q) return null;
    let reponse = ''; try { reponse = fs.readFileSync(q.fichier, 'utf8'); } catch {}
    if (q.etat === 'echec' && !reponse.trim()) { try { reponse = fs.readFileSync(q.fichier.replace(/\.md$/, '.log'), 'utf8').slice(-3000); } catch {} }
    if (/Failed to authenticate|OAuth session expired|not logged in|run \/login/i.test(reponse)) {
      reponse = "Claude Code n'est pas connecté en ligne de commande sur ce poste.\nOuvrez un terminal, lancez `claude`, tapez /login et suivez les étapes, puis reposez la question.\n\n— Détail —\n" + reponse.replace(/\x1b\[[0-9;]*m/g, '');
    }
    return { ...q, reponse };
  }
  const questionsDe = nom => [...questions.values()].filter(q => q.agent === nom).sort((a, b) => b.debut - a.debut).map(q => lireQuestion(q.id));

  // ---------- 2 et 4. Lancement Codex (nouvelle mission ou consigne de suite) ----------
  const NOM_VALIDE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,60}$/;
  function lancer(nom, texte, mode, session, workdir) {
    if (!NOM_VALIDE.test(nom)) throw new Error('nom invalide (lettres, chiffres, . _ -, 3 à 61 caractères)');
    if (dossierCodex(nom)) throw new Error(`un travail nommé « ${nom} » existe déjà`);
    const consigne = path.join(CONSIGNES, `${nom}.prompt`);
    fs.writeFileSync(consigne, texte);
    let enfant;
    if (mode === 'mission' && CONFIG.codexRun) {
      // Script du poste (ex. codex-run.sh du kit superviseur) : mêmes règles que les lancements habituels.
      enfant = spawn('sh', [CONFIG.codexRun, nom, consigne], { cwd: CONFIG.depot || path.dirname(CONFIG.codexRun), env: envAvecNode(), stdio: 'ignore', detached: true });
    } else {
      enfant = spawn('sh', [path.join(ICI, 'lanceur.sh'), nom, consigne, SORTIE, workdir || CONFIG.depot || os.homedir(), codexBin(), CONFIG.codexModel, mode, session || ''],
        { env: envAvecNode(), stdio: 'ignore', detached: true });
    }
    enfant.unref();
    return enfant.pid;
  }
  function nouvelleMission(nom, consigne) {
    if (!consigne || consigne.trim().length < 20) throw new Error('consigne trop courte');
    const pid = lancer(nom, consigne, 'mission');
    journal('mission', { nom, pid, consigne: consigne.slice(0, 800), via: CONFIG.codexRun || 'lanceur.sh' });
    return { nom, pid };
  }
  function consigneDeSuite(source, nom, texte) {
    const c = infoCodex(source); if (!c?.session) throw new Error("identifiant de session Codex introuvable dans le journal");
    if (!texte || texte.trim().length < 5) throw new Error('consigne trop courte');
    const pid = lancer(nom, texte, 'suite', c.session, c.workdir);
    journal('suite', { source, nom, pid, session: c.session, consigne: texte.slice(0, 800) });
    return { nom, pid };
  }

  // ---------- 3. Arrêt d'un agent Codex (SIGTERM, jamais SIGKILL) ----------
  function arreter(nom) {
    if (/^(session|claude):/.test(nom)) throw new Error("seuls les agents Codex s'arrêtent depuis le bureau");
    const ps = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const procs = ps.split('\n').map(l => l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean).map(m => ({ pid: +m[1], ppid: +m[2], cmd: m[3] }));
    const cible = procs.find(p => /\bcodex\b.*\bexec\b/.test(p.cmd) && !/caffeinate/.test(p.cmd) && p.cmd.includes(`/${nom}.last.md`));
    if (!cible) throw new Error('processus Codex introuvable (déjà terminé ?)');
    const arbre = [], file = [cible.pid];
    while (file.length) { const p = file.shift(); arbre.push(p); for (const e of procs) if (e.ppid === p) file.push(e.pid); }
    // descendants d'abord (essais, verrous de campagne qui libèrent leur place), puis Codex
    for (const p of arbre.reverse()) { try { process.kill(p, 'SIGTERM'); } catch {} }
    journal('arret', { nom, pids: arbre });
    return { nom, signales: arbre.length };
  }

  return { poserQuestion, lireQuestion, questionsDe, nouvelleMission, consigneDeSuite, arreter, SORTIE, JETON, claudeBin, codexBin };
}
