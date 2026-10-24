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

Le serveur ne fait **que lire** : journaux, transcripts, liste des processus, verrous de campagne. Il ne lance, n'arrête et n'écrit rien.

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

## Commandes du bureau 3D

Glisser : tourner · molette : zoom · double-clic : recentrer · clic sur un robot : consigne, rapport et journal · `L` : tâches affichées ou non · `T` : caméra automatique · `N` : jour / nuit · `Échap` : fermer.

## Confidentialité

Le serveur écoute sur `127.0.0.1` par défaut : journaux et transcripts restent sur le poste. Ne l'exposer sur le réseau (`"hote": "0.0.0.0"`) que sur un réseau de confiance.
