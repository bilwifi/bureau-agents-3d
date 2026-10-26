// Monde des agents : personnages persistants, progression, lieux de vie, humeur, chronique.
// Tout est dérivé des travaux réels lus par le serveur (journaux, transcripts, verdicts) : rien n'est inventé.
// Mémoire : donnees/monde.json (historique conservé au-delà de la fenêtre d'affichage, recalculable).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------- Identité stable, tirée du nom de la lignée ----------
const PRENOMS = ['Ada', 'Bola', 'Céleste', 'Dina', 'Elikia', 'Fanta', 'Grâce', 'Hiro', 'Ilunga', 'Jade', 'Kiese', 'Lumbu', 'Malaika', 'Nkosi', 'Olga', 'Pemba',
  'Rosine', 'Sefu', 'Tshala', 'Ulla', 'Vava', 'Wema', 'Yaya', 'Zola', 'Amani', 'Baraka', 'Chloé', 'Dibu', 'Esther', 'Fiston', 'Gédéon', 'Haïfa', 'Imani', 'Josué',
  'Kalala', 'Léa', 'Mbuyi', 'Nadia', 'Omari', 'Pacifique', 'Rafiki', 'Sifa', 'Tumba', 'Uzima', 'Victoire', 'Yannick', 'Zawadi', 'Mosa'];
const COULEURS = ['#c9d2e3', '#f2c14e', '#7fd1b9', '#f78c6b', '#9b8cff', '#6cc3f0', '#ef6f8a', '#a6d96a', '#e0b084', '#5fd3d0', '#d58cf0', '#ffd6a5'];
const ACCESSOIRES = ['casquette', 'echarpe', 'lunettes', 'noeud', 'casque', 'fleur', 'chapeau', 'sac'];
const TRAITS = ['curieux', 'méthodique', 'enjoué', 'calme', 'perfectionniste', 'rêveur', 'bavard', 'têtu', 'généreux', 'prudent', 'malicieux', 'serein'];
function hachage(s) { let h = 2166136261; for (const c of s) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const pioche = (liste, h, sel) => liste[hachage(h + '#' + sel) % liste.length];

const BADGES = {
  'premier-coup': { nom: 'Du premier coup', icone: '🎯', texte: 'lot approuvé dès la première revue' },
  approuve: { nom: 'Approuvé', icone: '✅', texte: 'premier lot approuvé' },
  perseverant: { nom: 'Persévérant', icone: '🧗', texte: 'six tours de travail sur le même lot' },
  lynx: { nom: 'Œil de lynx', icone: '🦉', texte: 'a trouvé un point bloquant en revue' },
  gardien: { nom: 'Gardien', icone: '🛡️', texte: 'dix points relevés en revue' },
  batisseur: { nom: 'Bâtisseur', icone: '🧱', texte: 'dix versions livrées' },
  assembleur: { nom: 'Assembleur', icone: '🔗', texte: 'trois intégrations qualifiées' },
  infatigable: { nom: 'Infatigable', icone: '⚡', texte: 'quatre travaux terminés le même jour' },
  noctambule: { nom: 'Noctambule', icone: '🌙', texte: 'un travail terminé entre minuit et 5 h' },
};
const TITRES = ['Apprenti', 'Compagnon', 'Artisan', 'Expert', 'Maître', 'Légende'];
const xpPour = n => 25 * n * (n - 1);            // niveau 2 : 50, 3 : 150, 4 : 300, 5 : 500…
const niveauDe = xp => { let n = 1; while (xp >= xpPour(n + 1)) n++; return n; };
const titreDe = n => TITRES[Math.min(TITRES.length - 1, n - 1)];
const NOMBRES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze'];
const enLettres = n => NOMBRES[n] ?? String(n);
// Nom de lot lisible : hub-h1-3 → H1-3, pilote-29 → pilote 29.
export const lotLisible = lot => String(lot || '?').replace(/^hub-(h\d+)(?=-|$)/i, (_, h) => h.toUpperCase()).replace(/^pilote-(\d+)$/, 'pilote $1');
function domaine(lot) {
  if (/^hub-ui/.test(lot)) return 'Interface du hub';
  if (/^hub-/.test(lot)) return 'Hub';
  if (/^B-/i.test(lot)) return 'Lots B';
  if (/^pilote/.test(lot)) return 'Assemblage des pilotes';
  if (lot === 'claude') return 'Analyses Claude';
  return 'Divers';
}
const ROLES_LIGNEE = { production: 'producteur', revue: 'relecteur', integration: 'intégrateur', diagnostic: 'diagnosticien', analyse: 'analyste' };

export function creerMonde({ ICI, CONFIG }) {
  const FICHIER = path.join(ICI, 'donnees', 'monde.json');
  let memoire = { version: 1, travaux: {}, noms: {} };
  try { const m = JSON.parse(fs.readFileSync(FICHIER, 'utf8')); if (m.version === 1) memoire = { ...memoire, ...m }; } catch {}
  let signature = '';

  // Lignée : même agent, même rôle, même lot. La correction appartient au producteur du lot ;
  // l'intégration suit la famille de lots (pilote-27, pilote-28… → un seul intégrateur).
  function ligneeDe(t) {
    if (t.session) return null;
    const role = t.role === 'correction' ? 'production' : t.role;
    const lot = role === 'integration' ? String(t.lot).replace(/-\d+$/, '') : t.lot;
    return `${t.agent === 'claude' ? 'claude' : 'codex'}:${role}:${lot}`;
  }
  function prenomDe(lignee) {
    if (memoire.noms[lignee]) return memoire.noms[lignee];
    const pris = new Set(Object.values(memoire.noms));
    const h = hachage(lignee);
    let p = null;
    for (let i = 0; i < PRENOMS.length && !p; i++) { const c = PRENOMS[(h + i) % PRENOMS.length]; if (!pris.has(c)) p = c; }
    p ||= PRENOMS[h % PRENOMS.length] + ' ' + (1 + Object.keys(memoire.noms).length);
    memoire.noms[lignee] = p;
    return p;
  }

  // Retient chaque travail vu (y compris au-delà de la fenêtre de lecture des journaux).
  function memoriser(travaux) {
    for (const t of travaux) {
      const lignee = ligneeDe(t); if (!lignee) continue;
      memoire.travaux[t.nom] = { nom: t.nom, lignee, agent: t.agent, role: t.role, lot: t.lot, tour: t.tour ?? null,
        debut: t.debut || null, fin: t.fin || null, statut: t.statut, verdict: t.verdict || null, titre: t.agent === 'claude' ? t.titre : undefined };
    }
    const noms = Object.keys(memoire.travaux);
    if (noms.length > 5000) for (const n of noms.sort((a, b) => (memoire.travaux[a].fin || 0) - (memoire.travaux[b].fin || 0)).slice(0, noms.length - 5000)) delete memoire.travaux[n];
    const sig = Object.values(memoire.travaux).reduce((a, t) => a + (t.fin || 0) % 1e6 + t.statut.length, 0) + ':' + noms.length + ':' + Object.keys(memoire.noms).length;
    if (sig !== signature) {
      signature = sig;
      try { const tmp = FICHIER + '.tmp'; fs.mkdirSync(path.dirname(FICHIER), { recursive: true }); fs.writeFileSync(tmp, JSON.stringify(memoire)); fs.renameSync(tmp, FICHIER); } catch (e) { console.warn('monde.json non écrit : ' + e.message); }
    }
  }

  // ---------- Progression : rejoue l'historique dans l'ordre des fins ----------
  function calculer(maintenant) {
    const persos = new Map();
    const perso = lignee => {
      let p = persos.get(lignee);
      if (!p) {
        const [agent, role, ...lot] = lignee.split(':');
        p = { id: lignee, prenom: prenomDe(lignee), agent, role, lot: lot.join(':'),
          couleur: pioche(COULEURS, lignee, 'c'), accessoire: pioche(ACCESSOIRES, lignee, 'a'), couleurAccessoire: pioche(COULEURS, lignee, 'ca'), trait: pioche(TRAITS, lignee, 't'),
          xp: 0, xpSemaine: 0, badges: [], travaux: [], stats: { termines: 0, echecs: 0, livraisons: 0, revues: 0, approbations: 0, remarques: 0, bloquants: 0, qualifies: 0, nonQualifies: 0, toursMax: 0, revuesLot: 0, lotsApprouves: 0 }, lots: {} };
        persos.set(lignee, p);
      }
      return p;
    };
    const evenements = [];
    const ev = (type, date, p, texte, extra = {}) => evenements.push({ id: `${type}:${p?.id || ''}:${extra.cle || ''}:${date}`, type, date, lignee: p?.id || null, texte, ...extra });
    const semaine = maintenant - 7 * 86400_000;
    const gagner = (p, xp, date) => {
      const avant = niveauDe(p.xp); p.xp += xp; if (date > semaine) p.xpSemaine += xp;
      const apres = niveauDe(p.xp);
      if (apres > avant) ev('niveau', date, p, `${p.prenom} passe au niveau ${apres} (${titreDe(apres)}).`, { cle: apres });
    };
    const badge = (p, id, date) => {
      if (p.badges.some(b => b.id === id)) return;
      p.badges.push({ id, ...BADGES[id], date });
      ev('badge', date, p, `${p.prenom} gagne le badge « ${BADGES[id].nom} » ${BADGES[id].icone}.`, { cle: id, badge: id });
    };
    const travaux = Object.values(memoire.travaux);
    for (const t of travaux) { const p = perso(t.lignee); p.travaux.push(t); }
    // première apparition de chaque lignée
    for (const p of persos.values()) {
      const premier = p.travaux.reduce((a, t) => Math.min(a, t.debut || t.fin || Infinity), Infinity);
      if (premier < Infinity) ev('arrivee', premier, p, `${p.prenom} rejoint l'équipe (${ROLES_LIGNEE[p.role] || p.role}${p.lot !== 'claude' ? ', ' + lotLisible(p.lot) : ''}).`);
    }
    const finis = travaux.filter(t => t.fin && !['actif', 'silencieux'].includes(t.statut)).sort((a, b) => a.fin - b.fin);
    const revuesLot = new Map(); // lot → [{ date, ok }]
    const parJour = new Map();
    for (const t of finis) {
      const p = perso(t.lignee), v = t.verdict || {}, s = p.stats, L = lotLisible(t.lot);
      p.lots[t.lot] = (p.lots[t.lot] || 0) + 1;
      if (t.tour) s.toursMax = Math.max(s.toursMax, t.tour);
      if (t.statut === 'termine') { s.termines++; gagner(p, 10, t.fin); }
      else { s.echecs++; gagner(p, 3, t.fin); ev('echec', t.fin, p, `Le travail de ${p.prenom} sur ${L} s'est arrêté avant la fin.`, { cle: t.nom, lot: t.lot }); }
      const h = new Date(t.fin).getHours(); if (t.statut === 'termine' && h < 5) badge(p, 'noctambule', t.fin);
      const jour = p.id + new Date(t.fin).toDateString(); parJour.set(jour, (parJour.get(jour) || 0) + (t.statut === 'termine' ? 1 : 0));
      if (parJour.get(jour) >= 4) badge(p, 'infatigable', t.fin);
      if (p.role === 'production') {
        const nTours = p.lots[t.lot];
        if (Math.max(nTours, t.tour || 0) >= 6) badge(p, 'perseverant', t.fin);
        if (v.sha && t.statut === 'termine') { s.livraisons++; gagner(p, 5, t.fin); if (s.livraisons >= 10) badge(p, 'batisseur', t.fin); }
      }
      if (t.role === 'revue' && (v.p0 != null || v.p1 != null)) {
        s.revues++;
        const p0 = v.p0 || 0, p1 = v.p1 || 0, prec = revuesLot.get(t.lot) || [];
        const producteur = persos.get(`${t.agent}:production:${t.lot}`);
        if (p0 + p1 === 0) {
          s.approbations++; gagner(p, 10, t.fin);
          const premiereRevue = !prec.some(r => !r.ok);
          if (producteur) {
            const tours = Math.max(producteur.lots[t.lot] || 1, ...producteur.travaux.filter(x => x.lot === t.lot && x.fin && x.fin <= t.fin).map(x => x.tour || 1));
            producteur.stats.lotsApprouves++;
            const premierCoup = premiereRevue && tours <= 1;
            gagner(producteur, premierCoup ? 50 : 30, t.fin);
            badge(producteur, 'approuve', t.fin);
            if (premierCoup) badge(producteur, 'premier-coup', t.fin);
            ev('approbation', t.fin, producteur, `${producteur.prenom} a fait approuver ${L} ${premierCoup ? 'du premier coup' : `après ${enLettres(tours)} tour${tours > 1 ? 's' : ''}`}.`, { cle: t.nom, lot: t.lot, relecteur: p.id });
          } else ev('approbation', t.fin, p, `${p.prenom} a approuvé ${L}.`, { cle: t.nom, lot: t.lot, relecteur: p.id });
        } else {
          s.remarques += p0 + p1; s.bloquants += p0;
          gagner(p, Math.min(30, p0 * 15 + p1 * 5), t.fin);
          if (p0 > 0) badge(p, 'lynx', t.fin);
          if (s.remarques >= 10) badge(p, 'gardien', t.fin);
          ev('remarques', t.fin, p, `${p.prenom} a relevé ${enLettres(p0 + p1)} point${p0 + p1 > 1 ? 's' : ''} à revoir sur ${L}${p0 ? ', dont ' + (p0 > 1 ? enLettres(p0) + ' bloquants' : 'un bloquant') : ''}.`, { cle: t.nom, lot: t.lot, producteur: producteur?.id || null });
          if (producteur) producteur.stats.revuesLot++;
        }
        if (producteur && p0 + p1 === 0) producteur.stats.revuesLot++;
        prec.push({ date: t.fin, ok: p0 + p1 === 0 }); revuesLot.set(t.lot, prec);
      }
      if (t.role === 'integration' && v.qualifie != null) {
        if (v.qualifie) { s.qualifies++; gagner(p, 40, t.fin); if (s.qualifies >= 3) badge(p, 'assembleur', t.fin); ev('integration', t.fin, p, `${p.prenom} a qualifié ${L} : l'assemblage avance.`, { cle: t.nom, lot: t.lot }); }
        else { s.nonQualifies++; gagner(p, 5, t.fin); ev('non-qualifie', t.fin, p, `${p.prenom} n'a pas pu qualifier ${L} ; on remet l'ouvrage sur le métier.`, { cle: t.nom, lot: t.lot }); }
      }
    }
    evenements.sort((a, b) => a.date - b.date);
    // Moral : nuage après des remarques répétées ou un échec, entrain après une approbation ou une qualification (6 h).
    const recent = d => d && maintenant - d < 6 * 3600_000;
    for (const p of persos.values()) {
      const fin = p.travaux.filter(t => t.fin && !['actif', 'silencieux'].includes(t.statut)).sort((a, b) => b.fin - a.fin)[0];
      let moral = { etat: 'calme', raison: null };
      if (p.role === 'production') {
        const rv = [p.lot].flatMap(l => revuesLot.get(l) || []).filter(r => maintenant - r.date < 24 * 3600_000);
        const [d1, d2] = rv.slice(-2).reverse();
        if (d1?.ok && recent(d1.date)) moral = { etat: 'entrain', raison: `${lotLisible(p.lot)} vient d'être approuvé` };
        else if (d1 && d2 && !d1.ok && !d2.ok) moral = { etat: 'nuage', raison: `deux revues de suite avec des points à revoir sur ${lotLisible(p.lot)}` };
      } else if (p.role === 'revue') {
        const ap = p.travaux.filter(t => t.fin && t.verdict && t.verdict.p0 === 0 && t.verdict.p1 === 0).sort((a, b) => b.fin - a.fin)[0];
        if (recent(ap?.fin)) moral = { etat: 'entrain', raison: `a approuvé ${lotLisible(ap.lot)}` };
      } else if (p.role === 'integration' && recent(fin?.fin) && fin.verdict?.qualifie != null) {
        moral = fin.verdict.qualifie ? { etat: 'entrain', raison: `${lotLisible(fin.lot)} qualifié` } : { etat: 'nuage', raison: `${lotLisible(fin.lot)} non qualifié` };
      }
      if (fin && fin.statut !== 'termine' && recent(fin.fin)) moral = { etat: 'nuage', raison: "dernier travail arrêté avant la fin" };
      p.moral = moral;
    }
    return { persos, evenements, revuesLot };
  }

  function fiche(p, maintenant) {
    const n = niveauDe(p.xp), s = p.stats;
    const taux = p.role === 'revue' ? (s.revues ? Math.round(s.approbations / s.revues * 100) : null) : p.role === 'production' ? (s.revuesLot ? Math.round(s.lotsApprouves / s.revuesLot * 100) : null) : p.role === 'integration' ? (s.qualifies + s.nonQualifies ? Math.round(s.qualifies / (s.qualifies + s.nonQualifies) * 100) : null) : null;
    const dernier = p.travaux.filter(t => t.fin).sort((a, b) => b.fin - a.fin)[0] || null;
    return { id: p.id, prenom: p.prenom, agent: p.agent, role: p.role, lot: p.lot, couleur: p.couleur, accessoire: p.accessoire, couleurAccessoire: p.couleurAccessoire, trait: p.trait,
      xp: p.xp, xpSemaine: p.xpSemaine, niveau: n, titre: titreDe(n), xpNiveau: xpPour(n), xpSuivant: xpPour(n + 1),
      badges: p.badges.map(b => ({ id: b.id, nom: b.nom, icone: b.icone, date: b.date })), stats: s, taux, moral: p.moral,
      derniereFin: dernier?.fin || null, dernierTravail: dernier?.nom || null };
  }

  // ---------- Lieux de vie : déduits de l'état réel de chaque travail ----------
  // Processus des campagnes d'essais : un agent dont un campaign-lock.sh tourne sans détenir de place attend une place.
  let cachePs = { date: 0, procs: new Map() };
  function processus() {
    if (process.platform === 'win32') return new Map();
    if (Date.now() - cachePs.date < 3000) return cachePs.procs;
    const procs = new Map();
    try {
      for (const l of execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 1 << 24 }).split('\n')) {
        const m = l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/); if (m) procs.set(Number(m[1]), { ppid: Number(m[2]), cmd: m[3] });
      }
    } catch {}
    cachePs = { date: Date.now(), procs };
    return procs;
  }
  function campagnes(etat) {
    const procs = processus(), res = {};
    const agents = new Map(etat.travaux.filter(t => t.pid).map(t => [t.pid, t.nom]));
    const detenteurs = new Set(etat.places.filter(p => p.vivant && p.pid).map(p => p.pid));
    for (const [pid, p] of procs) {
      if (!/campaign-lock\.sh/.test(p.cmd)) continue;
      let q = pid, nom = null;
      for (let i = 0; i < 12 && q > 1 && !nom; i++) { nom = agents.get(q) || null; q = procs.get(q)?.ppid || 0; }
      if (!nom) continue;
      if (detenteurs.has(pid)) res[nom] = 'essais'; else if (res[nom] !== 'essais') res[nom] = 'attente';
    }
    return res;
  }
  function lieux(etat) {
    const maintenant = etat.genereA, camp = campagnes(etat), res = {};
    const longue = (CONFIG.longueCommandeMinutes ?? 5) * 60_000;
    for (const t of etat.travaux) {
      if (t.statut === 'silencieux') { res[t.nom] = { lieu: 'jardin', raison: `silencieux depuis ${Math.round((maintenant - t.derniereEcriture) / 60_000)} min` }; continue; }
      if (t.statut !== 'actif') continue;
      if (camp[t.nom] === 'attente') res[t.nom] = { lieu: 'cafe', raison: "attend une place d'essais" };
      else if (camp[t.nom] === 'essais') res[t.nom] = { lieu: 'travail', raison: "occupe une place d'essais", essais: true };
      else if (t.derniereMarque === 'exec' && t.derniereEcriture && maintenant - t.derniereEcriture > longue) res[t.nom] = { lieu: 'cafe', raison: `longue commande (${Math.round((maintenant - t.derniereEcriture) / 60_000)} min)` };
      else if (t.role === 'diagnostic' || t.role === 'analyse') res[t.nom] = { lieu: 'bibliotheque', raison: t.role === 'diagnostic' ? 'diagnostic' : 'analyse' };
    }
    return res;
  }

  // ---------- Vue complète, ajoutée à /api/etat ----------
  function enrichir(etat) {
    const maintenant = etat.genereA;
    memoriser(etat.travaux);
    const { persos, evenements } = calculer(maintenant);
    const affectations = {};
    for (const t of etat.travaux) { const l = ligneeDe(t); if (l) affectations[t.nom] = l; }
    const personnages = {};
    for (const p of persos.values()) personnages[p.id] = fiche(p, maintenant);
    const semaine = [...persos.values()].filter(p => p.xpSemaine > 0).sort((a, b) => b.xpSemaine - a.xpSemaine)[0];
    const trophees = [...persos.values()].flatMap(p => p.badges.map(b => ({ lignee: p.id, prenom: p.prenom, id: b.id, nom: b.nom, icone: b.icone, date: b.date }))).sort((a, b) => b.date - a.date).slice(0, 40);
    // Lignées avec un travail en cours ; revues en cours où le producteur (sans travail) rejoint son relecteur.
    const occupees = new Set(etat.travaux.filter(t => t.statut === 'actif' || t.statut === 'silencieux').map(t => affectations[t.nom]));
    const revues = etat.travaux.filter(t => t.role === 'revue' && t.statut === 'actif')
      .map(t => ({ lot: t.lot, relecteur: t.nom, producteur: `${t.agent === 'claude' ? 'claude' : 'codex'}:production:${t.lot}` }))
      .filter(r => persos.has(r.producteur) && !occupees.has(r.producteur));
    // Résidents : personnages sans travail en cours, le plus récemment actifs (24 h), qui vivent dans les maisons.
    const residents = [...persos.values()].filter(p => !occupees.has(p.id) && personnages[p.id].derniereFin && maintenant - personnages[p.id].derniereFin < 24 * 3600_000)
      .sort((a, b) => personnages[b.id].derniereFin - personnages[a.id].derniereFin).slice(0, CONFIG.maisonsMax ?? 14).map(p => p.id);
    for (const r of revues) if (!residents.includes(r.producteur)) residents.push(r.producteur);
    rafraichirMeteo();
    return {
      personnages, affectations, trophees, lieux: lieux(etat), revues, residents, ...rythme(etat, evenements),
      meteo: CONFIG.meteo === false ? null : meteo,
      employeSemaine: semaine ? { lignee: semaine.id, prenom: semaine.prenom, xp: semaine.xpSemaine } : null,
      evenements: evenements.filter(e => e.date > maintenant - 3 * 86400_000).slice(-80),
    };
  }

  // ---------- Rythme du campus ----------
  const minutes = h => { const m = String(h || '').match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  function rythme(etat, evenements) {
    const maintenant = new Date(etat.genereA), mn = maintenant.getHours() * 60 + maintenant.getMinutes(), jour = maintenant.getDay();
    const lundi = new Date(maintenant); lundi.setHours(0, 0, 0, 0); lundi.setDate(lundi.getDate() - ((jour + 6) % 7));
    const approuves = new Set(evenements.filter(e => e.type === 'approbation' && e.date >= lundi.getTime()).map(e => e.lot));
    const pilotes = evenements.filter(e => e.type === 'integration');
    const debutR = minutes(CONFIG.reunion), dureeR = CONFIG.reunionMinutes ?? 15;
    const reunion = debutR != null && jour >= 1 && jour <= 5 && mn >= debutR && mn < debutR + dureeR;
    const f = CONFIG.fete || {}, debutF = minutes(f.heure);
    const fete = !!f && debutF != null && jour === (f.jour ?? 5) && mn >= debutF && mn < debutF + (f.minutes ?? 120) && approuves.size >= (f.lotsMin ?? 2);
    const charge = etat.machine?.charge?.[0] ?? 0, coeurs = etat.machine?.coeurs || 1;
    return {
      reunion, fete, heureReunion: CONFIG.reunion || null,
      compteur: { pilotesQualifies: pilotes.length, dernierPilote: pilotes.at(-1)?.lot || null, lotsApprouvesSemaine: [...approuves], lotsSemaineMin: f.lotsMin ?? 2 },
      fatigue: { quotaBas: !!etat.quota && etat.quota.restant < (CONFIG.quotaBas ?? 20), chaleur: charge / coeurs > (CONFIG.chaleur ?? 0.75), charge, coeurs },
    };
  }

  // ---------- Météo réelle (Open-Meteo, gratuit, sans clé) ----------
  // Rafraîchie en arrière-plan toutes les 15 min ; hors ligne ou désactivée (meteo: false) : null, sans jamais bloquer.
  let meteo = null, meteoDate = 0, meteoEnCours = false;
  const CIELS = [[[0], 'dégagé', 'soleil'], [[1, 2], 'peu nuageux', 'eclaircies'], [[3], 'couvert', 'nuages'], [[45, 48], 'brouillard', 'brouillard'],
    [[51, 53, 55, 56, 57], 'bruine', 'pluie'], [[61, 63, 65, 66, 67, 80, 81, 82], 'pluie', 'pluie'], [[71, 73, 75, 77, 85, 86], 'neige', 'neige'], [[95, 96, 99], 'orage', 'orage']];
  function rafraichirMeteo() {
    if (CONFIG.meteo === false || meteoEnCours || Date.now() - meteoDate < 15 * 60_000) return;
    meteoEnCours = true; meteoDate = Date.now();
    const l = { latitude: -4.3217, longitude: 15.3125, nom: 'Kinshasa', ...(CONFIG.meteoLieu || {}) };
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${Number(l.latitude)}&longitude=${Number(l.longitude)}&current=temperature_2m,weather_code,is_day,precipitation,cloud_cover,wind_speed_10m&timezone=auto`;
    fetch(url, { signal: AbortSignal.timeout(5000) }).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))).then(j => {
      const c = j.current || {}, ciel = CIELS.find(([codes]) => codes.includes(c.weather_code)) || [[], 'variable', 'nuages'];
      meteo = { lieu: l.nom, temperature: c.temperature_2m, code: c.weather_code, libelle: ciel[1], ciel: ciel[2], jour: c.is_day === 1, pluie: c.precipitation, nuages: c.cloud_cover, vent: c.wind_speed_10m, heure: c.time, lueA: Date.now() };
    }).catch(() => { meteoDate = Date.now() - 10 * 60_000; /* nouvel essai dans 5 min ; on garde la dernière météo connue */ }).finally(() => { meteoEnCours = false; });
  }

  // ---------- Chronique du jour, en langage simple ----------
  const TYPES_CHRONIQUE = new Set(['approbation', 'integration', 'non-qualifie', 'remarques', 'badge', 'niveau', 'echec']);
  function chronique(jour = new Date()) {
    const { evenements } = calculer(Date.now());
    const d0 = new Date(jour); d0.setHours(0, 0, 0, 0); const d1 = d0.getTime() + 86400_000;
    const lignes = evenements.filter(e => TYPES_CHRONIQUE.has(e.type) && e.date >= d0.getTime() && e.date < d1)
      .map(e => ({ heure: new Date(e.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), type: e.type, texte: e.texte, lignee: e.lignee, date: e.date }));
    const titre = `Chronique du ${d0.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`;
    const texte = [titre, '', ...(lignes.length ? lignes.map(l => `${l.heure} — ${l.texte}`) : ['Journée calme : rien de notable pour l\'instant.'])].join('\n') + '\n';
    return { titre, lignes, texte };
  }

  // Fiche carrière détaillée d'un personnage (tiroir).
  function carriere(id) {
    const { persos } = calculer(Date.now());
    const p = persos.get(id); if (!p) return null;
    const lots = Object.entries(p.lots).sort((a, b) => b[1] - a[1]);
    const domaines = {};
    for (const [lot, n] of lots) domaines[domaine(lot)] = (domaines[domaine(lot)] || 0) + n;
    return { ...fiche(p, Date.now()), specialites: { lots: lots.slice(0, 8).map(([lot, n]) => ({ lot, n })), domaines: Object.entries(domaines).sort((a, b) => b[1] - a[1]).map(([d, n]) => ({ domaine: d, n })) },
      historique: p.travaux.slice().sort((a, b) => (b.fin || b.debut || 0) - (a.fin || a.debut || 0)).slice(0, 40).map(t => ({ nom: t.nom, role: t.role, lot: t.lot, tour: t.tour, debut: t.debut, fin: t.fin, statut: t.statut, verdict: t.verdict })) };
  }

  return { enrichir, carriere, chronique, ligneeDe };
}
