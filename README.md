# Ars Virtualis

Site d'essais statique : rédaction dans Obsidian, génération avec Astro, code sur GitHub, hébergement sur Vercel. Chaque `git push` republie le site automatiquement.

## Ce qui est déjà en place

- Accueil (manifeste, essais mis en avant, derniers essais), index des essais filtrable par registre, séries avec sommaire, gabarit d'article, page Travaux, page Newsletter, 404, flux RSS.
- Trois registres : `these` (pièce-thèse), `pont` (essai-pont), `atelier` (note d'atelier). La pièce-thèse s'ouvre sur une lettrine.
- Notes de bas de page markdown (`[^1]`) affichées en marge sur grand écran, en bas de page sur mobile.
- Encarts au format des callouts Obsidian : `> [!definition]`, `> [!objection]`, `> [!aparte]`, `> [!these]`, `> [!note]`, `> [!exemple]`.
- Typographie française automatique (espaces fines avant ; ! ? et dans les guillemets « »).
- Thème clair et sombre, mise en page imprimable, navigation au clavier.
- Les brouillons (`statut: brouillon`) sont visibles en local et absents du site publié.

## Réglages à faire avant de publier

Tout est dans `src/config.ts` : titre, sous-titre, baseline, description, adresse de contact, lien de newsletter.
À relire et réécrire avec vos mots : le manifeste (`src/pages/index.astro`), la page `src/pages/travaux.astro`, l'essai `pourquoi-ars-virtualis.md`. Supprimez `les-feuilles-peintes.md` quand vous n'en aurez plus besoin comme démonstration.

## 1. Lancer le site sur votre ordinateur

Prérequis : Node.js 20 ou plus (version LTS sur nodejs.org) et Git.

```bash
cd ars-virtualis
npm install
npm run dev
```

Ouvrez http://localhost:4321. Chaque modification d'un fichier s'affiche immédiatement.
Pour vérifier la version publiée (sans les brouillons) : `npm run build` puis `npm run preview`.

## 2. Écrire dans Obsidian

1. Dans Obsidian, « Ouvrir un dossier comme coffre » et choisissez `ars-virtualis/src/content` (pas la racine du projet, qui contient `node_modules`).
2. Réglages > Fichiers et liens :
   - désactivez « Utiliser les [[Wikiliens]] » (le site lit les liens markdown classiques) ;
   - « Format du nouveau lien » : chemin relatif au fichier ;
   - « Emplacement par défaut des pièces jointes » : `essais/images`.
3. Réglages > Modèles : dossier des modèles `_modeles`. Le modèle `essai.md` remplit les propriétés d'un nouvel essai.
4. Nommez les fichiers en minuscules, sans accents ni espaces (`les-feuilles-peintes.md`) : le nom devient l'adresse de la page.

Propriétés d'un essai :

| Propriété | Valeurs |
| --- | --- |
| `titre` | texte |
| `date` | AAAA-MM-JJ |
| `resume` | une ou deux phrases, affichées sous le titre |
| `registre` | `these`, `pont` ou `atelier` |
| `statut` | `brouillon` ou `publie` |
| `serie` | nom du fichier de la série, sans `.md` (facultatif) |
| `partie` | numéro dans la série (facultatif) |
| `tags` | liste, sert aux suggestions « Dans le même esprit » |
| `enAvant` | `true` pour figurer dans « À lire d'abord » |

Une série est un fichier dans `series/` avec `titre`, `resume` et `ordre`.

## 3. Mettre le code sur GitHub

1. Créez un compte sur github.com si besoin, puis un dépôt vide nommé `ars-virtualis` (public ou privé).
2. Dans le dossier du projet :

```bash
git init
git add .
git commit -m "Première version"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/ars-virtualis.git
git push -u origin main
```

GitHub Desktop fait la même chose sans ligne de commande.

## 4. Publier sur Vercel

1. Sur vercel.com, connectez-vous avec votre compte GitHub.
2. « Add New… > Project », importez le dépôt `ars-virtualis`.
3. Vercel reconnaît Astro tout seul (commande `npm run build`, dossier `dist`). Cliquez sur « Deploy ».
4. Le site est en ligne à une adresse en `.vercel.app`. Reportez-la dans `site` (fichier `astro.config.mjs`), puis poussez la modification.

Ensuite, chaque `git push` sur `main` republie le site en une minute environ.

## 5. Nom de domaine (facultatif)

Achetez le domaine chez un registraire (Gandi, OVH…), puis dans Vercel : Project > Settings > Domains > Add, et suivez les indications DNS. Mettez à jour `site` dans `astro.config.mjs`.

## 6. Publier un essai au quotidien

1. Écrivez dans Obsidian avec `statut: brouillon`, relisez avec `npm run dev`.
2. Passez à `statut: publie`.
3. Poussez : `git add . && git commit -m "Nouvel essai" && git push`. Le module communautaire Obsidian Git permet de le faire depuis Obsidian.

## Notes techniques

- Le projet cible Astro 5. Pour passer plus tard à une version plus récente : `npx @astrojs/upgrade`, puis vérifier le site en local.
- Les polices (Spectral, Spectral SC, Instrument Sans) sont chargées depuis Google Fonts. Pour ne dépendre d'aucun service tiers, on peut les héberger dans `public/` : à faire avant d'ajouter une mesure d'audience ou une bannière de consentement.
