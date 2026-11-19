# Frais de régie

Notes de frais par employeur pour intermittent du spectacle. Appli web installable (ordi et téléphone), données rangées dans Dropbox.

- Ouvrir : https://eddy-lav.github.io/frais-de-regie/
- Installer : sur iPhone, Partager → « Sur l’écran d’accueil ». Sur Android ou dans Chrome/Edge sur ordi, menu → « Installer l’appli ».
- Les PDF sont lus sur l’appareil, sans IA. Les photos peuvent être lues par Claude avec une clé API personnelle (Réglages).
- Fonctionne hors ligne : les tickets partent dans Dropbox dès que la connexion revient.

## Où sont les données

Dans Dropbox, dossier `Applications/<nom de l’appli Dropbox>/` :

| Chemin | Contenu |
|---|---|
| `data.json` | tickets, employeurs, nom |
| `justificatifs/AAAA/` | photos et PDF des tickets |
| `apercus/` | vignettes des PDF |
| `notes-de-frais/` | copie des notes de frais exportées |

Rien n’est stocké dans ce dépôt GitHub : il ne contient que le code.

## Brancher Dropbox (une seule fois)

1. Aller sur https://www.dropbox.com/developers/apps → **Create app**.
2. **Scoped access**, puis **App folder**, puis un nom (par ex. `Frais de regie Eddy`).
3. Onglet **Permissions** : cocher `files.metadata.read`, `files.content.write`, `files.content.read`, puis **Submit**.
4. Onglet **Settings** → **OAuth 2 / Redirect URIs** : ajouter `https://eddy-lav.github.io/frais-de-regie/`.
5. Copier l’**App key** dans `config.js` (`dropboxAppKey`).

## Mettre à jour

Pousser sur `main` : GitHub Pages republie en une minute, et l’appli prend la nouvelle version à la prochaine ouverture (bandeau « Recharger » si elle était déjà ouverte).
Pour une modification de `sw.js`, changer aussi `CACHE` (`frais-v2`, …).

## Fichiers

- `index.html`, `style.css`, `app.js` : écran et logique
- `store.js` : copie locale + synchronisation Dropbox (fusion par ticket, hors ligne)
- `readers.js` : lecture des PDF (pdf.js) et des photos (Claude, optionnel)
- `sw.js`, `manifest.webmanifest`, `icons/` : appli installable et hors ligne
- `lib/` : bibliothèques figées (pdf.js 3.11.174, jsPDF 2.5.1, JSZip 3.10.1, SDK Anthropic 1.5.0 en un seul fichier)
