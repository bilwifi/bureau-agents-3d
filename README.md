# Bureau des agents 3D

Vue en direct, dans un bureau 3D, des agents qui travaillent sur ce poste :

- **agents Codex** lancés par `codex-run.sh` (production, correction, revue, intégration, diagnostic) ;
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

Node 20 ou plus. Aucune autre dépendance.

## Configuration

Les valeurs par défaut conviennent à un poste qui utilise le kit superviseur J-napps. Pour un autre poste, copier `config.example.json` en `config.json` (ignoré par git) et ajuster :

| Clé | Rôle | Défaut |
|---|---|---|
| `port`, `hote` | adresse d'écoute | `4317`, `127.0.0.1` |
| `codexOut` | dossiers des journaux `<nom>.log` / `<nom>.last.md` de `codex-run.sh` (motifs `*` et `~` acceptés) | `/private/tmp/claude-*/*/*/scratchpad/codex` |
| `consignes` | dossiers où chercher les consignes `<nom>.prompt` ou `<nom>.md` | scratchpads Claude |
| `claudeProjects` | dossiers de projets Claude Code | `~/.claude/projects/*` |
| `claudeProjectFilter` | expression régulière pour ne garder que certains projets | aucun filtre |
| `campaignLock` | préfixe des verrous de campagne (bancs d'essais) | `/tmp/jnapps-campaign.lock` |
| `placesMax` | nombre de places d'essais | `6` |
| `silenceMinutes` | délai sans écriture avant « silencieux » | `15` |
| `fenetreHeures` | historique affiché | `48` |

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

## Commandes du bureau 3D

Glisser : tourner · molette : zoom · double-clic : recentrer · clic sur un robot : consigne, rapport, journal, questions et actions · `M` : nouvelle mission · `L` : tâches affichées ou non · `T` : caméra automatique · `N` : jour / nuit · `Échap` : fermer.

## Confidentialité

Le serveur écoute sur `127.0.0.1` par défaut : journaux et transcripts restent sur le poste. Ne l'exposer sur le réseau (`"hote": "0.0.0.0"`) que sur un réseau de confiance, **et alors avec `"actions": false`** : la page embarque le jeton, donc toute personne qui l'ouvre pourrait lancer ou arrêter des agents.
