# Bureau des agents 3D

Vue en direct, dans un bureau 3D, des agents qui travaillent sur ce poste :

- **agents Codex** lancés par `codex-run.sh` (production, correction, revue, intégration, diagnostic) ;
- **sessions locales Codex Desktop et CLI**, y compris sous Windows, lues dans les fichiers `sessions/**/*.jsonl` de Codex ;
- **sous-agents Claude** (relectures, analyses, plans) ;
- **sessions Claude** (superviseurs), assises au pupitre de supervision.

Au-dessus de chaque robot : **la tâche qu'il exécute** (tirée de sa consigne) et **ce qu'il fait à l'instant** (essais, lecture du code, modification, git…). En fin de travail, le robot passe à l'imprimante, affiche son verdict (`P0=0 P1=1`, `qualifié`, `livré <sha>`…) puis sort.

Trois vues :

| Adresse | Vue |
|---|---|
| `/` | Bureau 3D (Three.js : éclairage, ombres, halos, caméra orbitale) |
| `/pixel` | Bureau en pixel art |
| `/tableau` | Tableau chiffré : agents en cours, parcours des lots, chronologie |

Le serveur lit les journaux, transcripts, processus et verrous de campagne. Il n'agit que sur demande explicite depuis la page (voir *Agir sur les agents*), et chaque action est journalisée.

## Installation sur un poste

```bash
git clone git@github.com:bilwifi/bureau-agents-3d.git
cd bureau-agents-3d
npm install        # facultatif : copie locale de Three.js (sinon chargé depuis le CDN)
npm start          # http://127.0.0.1:4317
```

Node 20 ou plus. Aucune autre dépendance. La météo est le seul appel réseau du serveur (désactivable).

### Windows et Codex Desktop

Le serveur détecte aussi les conversations enregistrées localement par Codex Desktop/CLI.
Le dossier par défaut est `%USERPROFILE%\.codex\sessions`, ou `sessions` sous
`CODEX_HOME` si cette variable est définie. Aucun script `codex-run.sh` n'est nécessaire
pour ces conversations. Pour un autre emplacement, ajouter dans `config.json` :

```json
{
  "codexSessions": ["C:/Users/votre-nom/.codex/sessions"],
  "actions": false
}
```

Lancer `npm install` puis `npm start` depuis PowerShell avec Node 20 ou plus.
Les chemins Windows absolus et les motifs avec `~` sont acceptés dans la configuration.
Pour désactiver la lecture native : `"codexSessions": []`.

Les événements du journal indiquent le début, la fin et l'interruption des tours.
Un tour sans activité pendant `silenceMinutes` est affiché comme silencieux ; cela ne
prouve pas que son processus tourne toujours. Modifier un réglage de conversation ne
la rend pas active. Les titres viennent de `session_index.jsonl` lorsqu'il existe.
La fiche affiche la dernière consigne, le dernier message, l'outil récent et le rapport
final disponible ; l'onglet Journal présente ce résumé, sans charger le transcript complet.
Les gros fichiers sont lus par blocs bornés, puis seuls les ajouts sont analysés.

Cette intégration lit uniquement les fichiers de sessions locales et leur index, sans
modifier Codex ni lire ses identifiants de connexion. Les conversations distantes sans
journal local ne sont pas visibles. Les actions sur les sessions natives ne sont pas
prises en charge ; les lanceurs et la détection de campagnes Unix restent propres aux
agents lancés par scripts. Le format des journaux Codex peut évoluer.

## Configuration

Les valeurs par défaut conviennent à un poste qui utilise le kit superviseur J-napps. Pour un autre poste, copier `config.example.json` en `config.json` (ignoré par git) et ajuster :

| Clé | Rôle | Défaut |
|---|---|---|
| `port`, `hote` | adresse d'écoute | `4317`, `127.0.0.1` |
| `codexOut` | dossiers des journaux `<nom>.log` / `<nom>.last.md` de `codex-run.sh` (motifs `*` et `~` acceptés) | `/private/tmp/claude-*/*/*/scratchpad/codex` |
| `consignes` | dossiers où chercher les consignes `<nom>.prompt` ou `<nom>.md` | scratchpads Claude |
| `claudeProjects` | dossiers de projets Claude Code | `~/.claude/projects/*` |
| `claudeProjectFilter` | expression régulière pour ne garder que certains projets | aucun filtre |
| `codexSessions` | dossiers des journaux natifs Codex Desktop/CLI (lecture récursive, `[]` pour désactiver) | `CODEX_HOME/sessions` ou `~/.codex/sessions` |
| `campaignLock` | préfixe des verrous de campagne (bancs d'essais) | `/tmp/jnapps-campaign.lock` |
| `placesMax` | nombre de places d'essais | `6` |
| `silenceMinutes` | délai sans écriture avant « silencieux » | `15` |
| `fenetreHeures` | historique affiché | `48` |
| `maisonsMax` | personnages sans travail affichés dans les maisons | `14` |
| `longueCommandeMinutes` | commande sans sortie depuis ce délai : l'agent patiente au café | `5` |
| `reunion`, `reunionMinutes` | heure de la réunion du matin (jours ouvrés, `null` pour aucune) et durée | `"09:00"`, `15` |
| `fete` | fête de fin de semaine : `jour` (0 = dimanche), `heure`, `minutes`, `lotsMin` | `{ "jour": 5, "heure": "17:00", "minutes": 120, "lotsMin": 2 }` |
| `quotaBas` | quota Codex restant (%) sous lequel les agents bâillent | `20` |
| `chaleur` | charge / cœurs au-dessus de laquelle la baie chauffe | `0.75` |
| `meteo` | météo réelle (Open-Meteo) ; `false` : aucun appel réseau | `true` |
| `meteoLieu` | `latitude`, `longitude`, `nom` de la ville | Kinshasa |

Variables d'environnement prioritaires : `PORT`, `CODEX_OUT`, `CLAUDE_PROJECTS`, `CAMPAIGN_LOCK` (listes séparées par `:`), `BUREAU_CONFIG` (chemin d'un autre fichier de configuration).

## Conventions lues

- **Nom du travail Codex** : le rôle, le lot et le tour sont déduits du nom (`hub-h1-2-revue-r4` → revue, lot `hub-h1-2`, tour 4 ; `prod-B-178` → production ; `int-…` → intégration ; `diag-…` → diagnostic).
- **Tâche** : première ligne `Tâche :` / `Mission :` de la consigne (le passage en gras de préférence), sinon la phrase `Tu es …`, sinon la première phrase utile. Pour un sous-agent Claude, sa description ; pour une session, son titre et la dernière demande.
- **Verdict** : `P0=`, `P1=`, `QUALIFIÉ` / `NON QUALIFIÉ` et le premier SHA dans les 700 premiers caractères du rapport final.

## Agir sur les agents depuis le bureau 3D

Clic sur un robot (ou sur une ligne du fil d'événements) : sa fiche s'ouvre avec, selon l'agent :

| Action | Pour qui | Ce qui se passe |
|---|---|---|
| 💬 **Poser une question** | agents Codex, sessions Claude | Une **copie** de l'agent, avec toute sa mémoire, répond dans l'onglet *Questions*. L'agent lui-même n'est pas dérangé. Copie Codex en lecture seule (`codex exec fork --ephemeral`, bac à sable `read-only`) ; copie Claude limitée à `Read, Grep, Glob` et non enregistrée. |
| ↪ **Consigne de suite** | agents Codex terminés | La consigne est envoyée dans **sa** conversation (`codex exec resume`) : il reprend avec tout son contexte, sous un nouveau nom (`…-suite1`), et revient au bureau comme un nouveau robot. |
| ⏹ **Arrêter** | agents Codex en cours | `SIGTERM` à l'agent et à ses commandes (jamais `SIGKILL`) : les verrous de campagne libèrent leur place, le journal se termine par `exit=143`. |
| ＋ **Nouvelle mission** (bouton du haut, touche `M`) | — | Rôle, lot, tour → nom déduit (`prod-B-180`, `B-180-revue-r2`…), consigne complète, confirmation. Lancée par `codexRun` s'il est configuré (ex. `codex-run.sh` du kit), sinon par `lanceur.sh`. |

À savoir :

- **Coût** : une question recharge tout le contexte de l'agent (ex. ~385 000 jetons pour un diagnostic de taille moyenne). À réserver aux vraies questions.
- **Claude en ligne de commande** : les questions aux sessions Claude utilisent le binaire `claude`. Il doit être connecté une fois sur le poste (`claude`, puis `/login`) ; sinon la fiche l'indique.
- **Sous-agents Claude** : on ne peut pas les interroger directement ; passer par leur session parente.
- **Sécurité** : les actions n'acceptent que des requêtes `POST` venant de la page elle-même (jeton tiré au démarrage du serveur, hôte et origine vérifiés). Chaque action est journalisée dans `donnees/actions.log`. `"actions": false` dans `config.json` remet le bureau en lecture seule.
- **Données locales** : `donnees/` (consignes lancées, réponses, journal des actions, sorties du lanceur) est ignoré par git.

Clés de configuration propres aux actions : `actions`, `codexModel`, `codexBin`, `claudeBin` (détectés sinon), `depot` (dossier de travail des missions), `codexRun` (script de lancement du poste).

## Le monde des agents

Le bureau 3D est aussi un petit monde où les agents ont une vie. **Règle : tout ce qui s'y passe correspond à un fait réel lu par le serveur** (journaux `codex-run.sh`, transcripts Claude, processus, verrous de campagne, verdicts). Aucun modèle d'IA n'anime le monde ; seuls les petits mouvements d'attente (regarder autour de soi, cligner des yeux…) sont décoratifs. Le calcul est fait par `monde.mjs`.

### Personnages et progression

- **Lignée** : un personnage = un même agent (Codex ou Claude), un même rôle, un même lot. Le producteur de `hub-h1-2` de r1 à r6 est un seul personnage ; la correction appartient au producteur du lot ; le relecteur du même lot est un autre personnage. Les intégrations suivent la famille de lots (`pilote-27`, `pilote-28`… → un seul intégrateur).
- **Identité stable** tirée du nom de la lignée : prénom, couleur, accessoire (casquette, écharpe, lunettes, nœud, casque, fleur, chapeau, sac) et trait de caractère.
- **Expérience** calculée sur les vrais verdicts : travail terminé +10 (arrêté avant la fin +3), version livrée +5, point relevé en revue +5 (bloquant +15, plafond 30), revue qui approuve +10, lot approuvé +30 pour son producteur (+50 du premier coup), intégration qualifiée +40. Niveaux : 50, 150, 300, 500 XP… (Apprenti, Compagnon, Artisan, Expert, Maître, Légende).
- **Badges** : 🎯 Du premier coup, ✅ Approuvé, 🧗 Persévérant (six tours sur un lot), 🦉 Œil de lynx (point bloquant trouvé), 🛡️ Gardien (dix points relevés), 🧱 Bâtisseur (dix versions livrées), 🔗 Assembleur (trois intégrations qualifiées), ⚡ Infatigable (quatre travaux le même jour), 🌙 Noctambule.
- **Fiche carrière** : onglet *Carrière* du tiroir (historique, taux d'approbation, spécialités par lot et par domaine, badges, progression).
- **Mur des trophées** (bouton 🏆 ou touche `R`, ou clic sur le panneau devant la porte) et **employé de la semaine** (le plus d'XP sur 7 jours, couronne dorée).
- **Mémoire** : `donnees/monde.json` (ignoré par git) garde chaque travail vu, même au-delà de la fenêtre de 48 h, et les prénoms attribués. On peut le supprimer : il se reconstruit à partir des journaux encore présents.

`/api/carriere?id=<lignée>` renvoie la fiche carrière en JSON ; `/api/etat` contient la clé `monde`.

### Lieux de vie

Le bureau est devenu un campus : les zones d'origine (atelier, salle de revue, intégration, supervision) sont au centre, reliées par une avenue et des allées aux lieux de vie. Chaque déplacement correspond à un état réel :

| Lieu | Qui y va | Fait réel lu |
|---|---|---|
| ☕ **Café** (baby-foot, ping-pong, comptoir) | agent qui **attend une place d'essais** ou dont **une commande dure** | un `campaign-lock.sh` de l'agent tourne sans détenir de place (verrou `.pid`, filiation des processus) ; ou dernière marque `exec` sans écriture du journal depuis `longueCommandeMinutes` |
| | deux agents en attente jouent ensemble ; un agent seul prend un café au comptoir | |
| 🌿 **Jardin** | agent **silencieux** (on voit qui est bloqué) | aucune écriture depuis `silenceMinutes` |
| 📚 **Bibliothèque** | **diagnostic** et **analyse** en cours | rôle déduit du nom ou de la description |
| 🤝 **Salle de revue** | le **producteur** rejoint le relecteur de son lot | une revue de son lot est en cours et il n'a pas d'autre travail |
| 🎉 **Place des fêtes** | confettis à une **approbation** (`P0=0 P1=0`), feu d'artifice à une **intégration qualifiée** | événements calculés par `monde.mjs` |
| 🏠 **Maisons** | personnages **sans travail en cours** : ils bricolent le jour, dorment la nuit, au lieu de disparaître | dernier travail terminé dans les 24 h (`maisonsMax` personnages au plus) |

Un personnage qui reprend du travail quitte sa maison et marche jusqu'à son poste ; à la fin, il passe à l'imprimante puis rentre chez lui. Les nouveaux venus arrivent par le portail du campus.

### Humeur, événements, chronique

- **Moral** (calculé sur les verdicts) : ☁️ petit nuage pour un producteur dont les deux dernières revues ont relevé des points, ou dont le dernier travail s'est arrêté avant la fin ; ✨ entrain (étincelle, petits sauts) après une approbation ou une intégration qualifiée (6 h).
- **Fatigue** : quota Codex sous `quotaBas` % → les agents Codex bâillent 🥱 ; charge machine au-dessus de `chaleur` × nombre de cœurs → la baie de serveurs rougit et dégage de la chaleur.
- **Réunion du matin** à l'heure `reunion` (jours ouvrés, `reunionMinutes`) : les personnages sans travail se retrouvent sur la place, autour du **compteur d'assemblage** (pilotes qualifiés, lots approuvés de la semaine). Ceux qui travaillent continuent.
- **Fête de fin de semaine** (`fete` : jour, heure, durée, `lotsMin`) si au moins `lotsMin` lots ont été approuvés depuis lundi : lampions et danse sur la place.
- **Chronique du jour** en langage simple (« Chloé a fait approuver hub-ui-mobile après deux tours. ») : bouton 📜 ou touche `C`, clic sur le compteur d'assemblage, ou **`/api/chronique`** (texte brut, à recopier ailleurs ; `?jour=AAAA-MM-JJ`, `?format=json`).

### Ambiance

- **Météo réelle** (par défaut Kinshasa) lue par le serveur sur [Open-Meteo](https://open-meteo.com) (gratuit, sans clé), toutes les 15 minutes, en arrière-plan : température et ciel dans le bandeau, pluie, nuages, éclairs d'orage dans la scène. Hors ligne, rien ne bloque (dernière météo connue, ou pas de météo). `"meteo": false` supprime tout appel réseau ; `meteoLieu` change de ville.
- **Son** discret, **coupé par défaut** (bouton 🔇/🔊 ou touche `S`) : vent, pluie s'il pleut, oiseaux le jour, grillons la nuit ; carillon à chaque approbation, fanfare à chaque intégration qualifiée. Tout est synthétisé dans la page (aucun fichier audio).
- **Le propriétaire** (« Vous », chapeau) se tient près de la supervision ; il marche jusqu'à l'agent quand on lui pose une question, lui confie une suite ou l'arrête, et jusqu'au portail quand on lance une mission (seulement après une action réussie).
- **Caméra** : menu 📍 *Lieux* ou touches `0` à `9` pour aller d'un lieu à l'autre ; **mode visite** (🧭 ou touche `V`) : la caméra passe de lieu en lieu et se porte sur chaque événement réel (arrivée, fin de travail, pause café, fête). Toucher la scène reprend la main pendant 20 s.

Pour vérifier le monde sans attendre un vrai événement ni écrire de faux fichiers : dans la console, `__bureau.figer = true`, puis rejouer un état modifié avec `__bureau.appliquer(...)` (ex. un travail passé à `termine`), ou `__bureau.celebrer({ type: 'approbation', texte: '…' })`.

## Commandes du bureau 3D

Glisser : tourner · molette : zoom · double-clic : recentrer · clic sur un robot : consigne, rapport, journal, questions et actions · `M` : nouvelle mission · `L` : tâches affichées ou non · `R` : mur des trophées · `C` : chronique · `V` : visite · `0`–`9` : lieux · `S` : son · `T` : caméra automatique · `N` : jour / nuit · `Échap` : fermer.

## Confidentialité

Le serveur écoute sur `127.0.0.1` par défaut : journaux et transcripts restent sur le poste. Ne l'exposer sur le réseau (`"hote": "0.0.0.0"`) que sur un réseau de confiance, **et alors avec `"actions": false`** : la page embarque le jeton, donc toute personne qui l'ouvre pourrait lancer ou arrêter des agents.
