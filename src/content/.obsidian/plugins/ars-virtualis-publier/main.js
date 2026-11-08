/*
 * Ars Virtualis : publier
 * Extension Obsidian (ordinateur uniquement) écrite pour ce site.
 *
 * Deux façons de l'utiliser :
 *
 *  - Mode « coffre du site » (réglage « Dossier du projet » vide) : le coffre EST
 *    le dossier src/content du site. Les essais sont dans essais/.
 *
 *  - Mode « copie vers le site » (réglage « Dossier du projet » rempli) : le coffre
 *    est un coffre ordinaire (Second Cerveau…). Les essais sont rangés dans un dossier
 *    du coffre ; à la publication, la note est copiée dans le projet du site,
 *    avec ses images, et les liens Obsidian sont convertis.
 *
 * Commande « Publier l'essai ouvert » :
 *   1. vérifie les propriétés de l'essai (mêmes règles que src/content.config.ts) ;
 *   2. demande confirmation ;
 *   3. passe « statut » à « publie » (et, au choix, « date » à aujourd'hui) ;
 *   4. (mode copie) copie la note et ses images dans le projet ;
 *   5. git add + commit + push du dossier src/content. Vercel republie le site.
 *
 * Commande « Envoyer les corrections » : envoie toutes les retouches, sans toucher
 * aux propriétés (en mode copie, recopie d'abord les essais du dossier).
 *
 * Fichier JavaScript simple, sans étape de compilation : on peut le modifier directement.
 */

const { Plugin, Modal, Notice, PluginSettingTab, Setting, FileSystemAdapter, TFile } = require('obsidian');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const DEFAUTS = {
  site: 'https://ars-virtualis.vercel.app',
  dateDuJour: true,
  projet: '', // vide = le coffre est src/content ; sinon chemin du projet du site
  dossierSource: 'Ars Virtualis', // mode copie : dossier des essais dans le coffre
};

const REGISTRES = ['these', 'pont', 'atelier'];
const DOSSIER_ESSAIS = 'essais';
const DOSSIER_SERIES = 'series';
const DOSSIER_IMAGES = 'images'; // dans essais/
const EXT_IMAGES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif'];

/* ---------- Outils ---------- */

function aujourdhui() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function slugifier(texte) {
  return texte
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const vide = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Adresse de la page publiée, calculée comme le fait Astro à partir du chemin du fichier. */
function adresseEssai(site, cheminFichier) {
  const relatif = cheminFichier.slice(DOSSIER_ESSAIS.length + 1).replace(/\.md$/, '');
  const slug = relatif.split('/').map(slugifier).join('/');
  return `${site.replace(/\/+$/, '')}/essais/${slug}/`;
}

/** Nom du fichier dans essais/ en mode copie : « Les feuilles peintes » → les-feuilles-peintes.md */
function nomPublie(basename) {
  return `${slugifier(basename) || 'essai'}.md`;
}

/**
 * Vérifie les propriétés d'un essai avec les règles du schéma Astro.
 * Renvoie des erreurs (bloquantes : le build échouerait) et des avertissements.
 */
function verifierEssai(fm, { series, nomFichier, dateRemplacee }) {
  const erreurs = [];
  const avertissements = [];

  if (nomFichier.startsWith('_')) {
    erreurs.push('Le nom du fichier commence par « _ » : le site ignore ce fichier.');
  }
  if (vide(fm.titre) || typeof fm.titre !== 'string') erreurs.push('« titre » est vide.');
  if (vide(fm.resume) || typeof fm.resume !== 'string') erreurs.push('« resume » est vide.');

  if (!dateRemplacee) {
    const brute = fm.date;
    const date = brute instanceof Date ? brute : new Date(String(brute ?? ''));
    if (vide(brute) || String(brute).includes('{{') || Number.isNaN(date.valueOf())) {
      erreurs.push('« date » est absente ou invalide (format attendu : AAAA-MM-JJ).');
    }
  }

  if (!REGISTRES.includes(fm.registre)) {
    erreurs.push(`« registre » doit valoir ${REGISTRES.join(', ')} (valeur actuelle : ${vide(fm.registre) ? 'vide' : fm.registre}).`);
  }

  if (!vide(fm.serie)) {
    if (typeof fm.serie !== 'string' || !series.includes(fm.serie)) {
      erreurs.push(`La série « ${fm.serie} » n'existe pas dans ${DOSSIER_SERIES}/ (séries connues : ${series.join(', ') || 'aucune'}).`);
    }
  }

  if (!vide(fm.partie) && !(Number.isInteger(fm.partie) && fm.partie > 0)) {
    erreurs.push('« partie » doit être un nombre entier positif, ou rester vide.');
  }

  if (fm.tags === null || (fm.tags !== undefined && !(Array.isArray(fm.tags) && fm.tags.every((t) => typeof t === 'string')))) {
    erreurs.push('« tags » doit être une liste (mettre [] s\'il n\'y en a pas).');
  }

  if (fm.enAvant !== undefined && fm.enAvant !== null && typeof fm.enAvant !== 'boolean') {
    erreurs.push('« enAvant » doit valoir true ou false.');
  }

  const base = nomFichier.replace(/\.md$/, '');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(base)) {
    avertissements.push(
      `Le nom du fichier devient l'adresse de la page. Nom conseillé : « ${slugifier(base) || 'essai'}.md » (minuscules, sans accents ni espaces).`,
    );
  }
  if (!vide(fm.partie) && vide(fm.serie)) {
    avertissements.push('« partie » est renseignée sans « serie » : elle ne sera pas affichée.');
  }

  return { erreurs, avertissements };
}

/**
 * Mode copie : transforme le texte d'une note Obsidian en texte lisible par le site.
 *  - images intégrées (![[x.png]] ou ![](x.png)) → ![](images/x.png), fichier à copier ;
 *  - liens vers un autre essai du dossier → lien vers sa page ;
 *  - autres liens internes → simple texte ;
 *  - commentaires %% … %% → retirés (ils sont privés dans Obsidian).
 *
 * liens : [{ original, estIntegre, texte, cible }] où cible vaut
 *   { type: 'image', chemin, nom } | { type: 'essai', slug } | null (introuvable / non publiable).
 */
function convertirNote(contenu, liens) {
  const images = new Map(); // nom → chemin dans le coffre
  const convertis = [];
  let texte = contenu.replace(/%%[\s\S]*?%%/g, '');

  for (const l of liens) {
    let remplacement;
    if (l.cible?.type === 'image') {
      images.set(l.cible.nom, l.cible.chemin);
      remplacement = `![${l.texte}](${DOSSIER_IMAGES}/${l.cible.nom})`;
    } else if (l.cible?.type === 'essai' && !l.estIntegre) {
      remplacement = `[${l.texte}](/essais/${l.cible.slug}/)`;
    } else {
      remplacement = l.texte;
      convertis.push(`${l.original} → « ${l.texte} » (texte simple)`);
    }
    texte = texte.split(l.original).join(remplacement);
  }
  return { texte, images, convertis };
}

/** Traduit les erreurs Git courantes en consignes compréhensibles. */
function expliquerErreurGit(sortie) {
  const s = sortie.toLowerCase();
  if (s.includes('projet introuvable')) {
    return "Le dossier du projet du site est introuvable. Vérifie le réglage « Dossier du projet » de l'extension.";
  }
  if (s.includes('could not read username') || s.includes('authentication failed') || s.includes('terminal prompts disabled') || s.includes('403')) {
    return "GitHub refuse l'accès : le jeton a probablement expiré. Crée un nouveau jeton sur GitHub, puis lance « git push » dans le Terminal pour l'enregistrer. Le commit est fait en local, il partira au prochain envoi.";
  }
  if (s.includes('fetch first') || s.includes('non-fast-forward') || s.includes('rejected')) {
    return "GitHub contient des changements absents de cet ordinateur. Dans le Terminal, lance « git pull --rebase » dans le dossier du projet, puis recommence.";
  }
  if (s.includes('could not resolve host') || s.includes('unable to access')) {
    return 'GitHub est injoignable : vérifie la connexion internet. Le commit est fait en local, il partira au prochain envoi.';
  }
  if (s.includes('not a git repository')) {
    return "Ce dossier n'est pas dans un dépôt Git. Ouvre bien ars-virtualis/src/content comme coffre, ou renseigne le réglage « Dossier du projet ».";
  }
  if (s.includes('enoent')) {
    return 'Git est introuvable sur cet ordinateur.';
  }
  return sortie.trim().split('\n').slice(-3).join(' ') || 'Erreur Git inconnue.';
}

function git(args, cwd) {
  return new Promise((resoudre, rejeter) => {
    execFile(
      'git',
      args,
      {
        cwd,
        timeout: 90000,
        env: {
          ...process.env,
          // Obsidian lancé depuis le Dock n'hérite pas toujours du PATH du Terminal.
          PATH: [process.env.PATH, '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'].filter(Boolean).join(':'),
          // Jamais de question interactive : si le jeton manque, on échoue proprement.
          GIT_TERMINAL_PROMPT: '0',
        },
      },
      (erreur, stdout, stderr) => {
        if (erreur) {
          erreur.sortie = `${stderr || ''}\n${stdout || ''}\n${erreur.code === 'ENOENT' ? 'ENOENT' : ''}`;
          rejeter(erreur);
        } else {
          resoudre({ stdout: stdout || '', stderr: stderr || '' });
        }
      },
    );
  });
}

/* ---------- Fenêtres ---------- */

class ModaleConfirmation extends Modal {
  /**
   * options : { titre, intro, listes: [{ titre, elements, classe }], case, champ, bouton, auConfirmer }
   */
  constructor(app, options) {
    super(app);
    this.options = options;
  }

  onOpen() {
    const { contentEl, options } = this;
    contentEl.addClass('av-publier');
    contentEl.createEl('h2', { text: options.titre });
    if (options.intro) contentEl.createEl('p', { text: options.intro });

    for (const liste of options.listes ?? []) {
      if (!liste.elements.length) continue;
      contentEl.createEl('h4', { text: liste.titre });
      const ul = contentEl.createEl('ul', { cls: liste.classe });
      liste.elements.forEach((t) => ul.createEl('li', { text: t }));
    }

    const etat = { coche: options.case?.valeur ?? false, texte: options.champ?.valeur ?? '' };

    if (options.case) {
      new Setting(contentEl).setName(options.case.libelle).addToggle((t) =>
        t.setValue(etat.coche).onChange((v) => (etat.coche = v)),
      );
    }
    if (options.champ) {
      new Setting(contentEl).setName(options.champ.libelle).addText((t) => {
        t.setValue(etat.texte).onChange((v) => (etat.texte = v));
        t.inputEl.style.width = '100%';
      });
    }

    const actions = new Setting(contentEl);
    actions.addButton((b) => b.setButtonText('Annuler').onClick(() => this.close()));
    if (options.bouton) {
      actions.addButton((b) =>
        b
          .setButtonText(options.bouton)
          .setCta()
          .onClick(() => {
            this.close();
            options.auConfirmer(etat);
          }),
      );
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ---------- Extension ---------- */

module.exports = class ArsVirtualisPublier extends Plugin {
  async onload() {
    this.reglages = Object.assign({}, DEFAUTS, await this.loadData());
    this.enCours = false;

    this.addCommand({
      id: 'publier-essai',
      name: "Publier l'essai ouvert",
      checkCallback: (verification) => {
        const fichier = this.essaiOuvert();
        if (!fichier) return false;
        if (!verification) this.publier(fichier);
        return true;
      },
    });

    this.addCommand({
      id: 'envoyer-corrections',
      name: 'Envoyer les corrections (toutes les modifications)',
      callback: () => this.envoyerCorrections(),
    });

    this.addRibbonIcon('send', "Ars Virtualis : publier l'essai ouvert", () => {
      const fichier = this.essaiOuvert();
      if (fichier) this.publier(fichier);
      else new Notice(`Ouvre d'abord un essai du dossier « ${this.dossierEssais()} ».`);
    });

    this.addSettingTab(new OngletReglages(this.app, this));
  }

  /* --- Où sont les choses --- */

  modeCopie() {
    return !vide(this.reglages.projet);
  }

  /** Dossier des essais dans le coffre. */
  dossierEssais() {
    return this.modeCopie() ? this.reglages.dossierSource.replace(/^\/+|\/+$/g, '') : DOSSIER_ESSAIS;
  }

  /** Dossier src/content du site sur le disque. */
  dossierContenu() {
    if (this.modeCopie()) return path.join(this.reglages.projet.replace(/^~(?=\/|$)/, require('os').homedir()), 'src', 'content');
    const adaptateur = this.app.vault.adapter;
    return adaptateur instanceof FileSystemAdapter ? adaptateur.getBasePath() : null;
  }

  estEssai(f) {
    return (
      f instanceof TFile &&
      f.extension === 'md' &&
      f.path.startsWith(`${this.dossierEssais()}/`) &&
      !(this.modeCopie() && f.basename.startsWith('_'))
    );
  }

  essaiOuvert() {
    const f = this.app.workspace.getActiveFile();
    return this.estEssai(f) ? f : null;
  }

  /** Chemin de l'essai tel qu'il sera dans src/content (essais/xxx.md). */
  cheminPublie(fichier) {
    return this.modeCopie() ? `${DOSSIER_ESSAIS}/${nomPublie(fichier.basename)}` : fichier.path;
  }

  /** Racine du dépôt et chemin de src/content relatif à cette racine. */
  async depot() {
    const contenu = this.dossierContenu();
    if (!contenu || !fs.existsSync(contenu)) throw Object.assign(new Error('projet'), { sortie: 'projet introuvable' });
    const { stdout } = await git(['rev-parse', '--show-toplevel'], contenu);
    const racine = stdout.trim();
    return { racine, relatif: path.relative(racine, contenu) || '.' };
  }

  async fichiersModifies({ racine, relatif }) {
    const { stdout } = await git(['status', '--porcelain', '--untracked-files=all', '--', relatif], racine);
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((ligne) => {
        const code = ligne.slice(0, 2).trim();
        const chemin = ligne.slice(3).replace(/^"|"$/g, '');
        const nature = code === '??' || code === 'A' ? 'nouveau' : code === 'D' ? 'supprimé' : 'modifié';
        return `${path.relative(relatif === '.' ? '' : relatif, chemin) || chemin} (${nature})`;
      });
  }

  seriesConnues() {
    if (this.modeCopie()) {
      try {
        return fs
          .readdirSync(path.join(this.dossierContenu(), DOSSIER_SERIES))
          .filter((n) => n.endsWith('.md') && !n.startsWith('_'))
          .map((n) => n.replace(/\.md$/, ''));
      } catch {
        return [];
      }
    }
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${DOSSIER_SERIES}/`))
      .map((f) => f.basename);
  }

  /* --- Mode copie : préparation de la version du site --- */

  /** Liste les liens et images de la note, résolus comme Obsidian le fait. */
  liensDe(fichier) {
    const cache = this.app.metadataCache.getFileCache(fichier) ?? {};
    const tous = [...(cache.embeds ?? []).map((e) => ({ ...e, estIntegre: true })), ...(cache.links ?? []).map((e) => ({ ...e, estIntegre: false }))];
    const vus = new Set();
    const liens = [];
    for (const l of tous) {
      if (vus.has(l.original)) continue;
      vus.add(l.original);
      let chemin = String(l.link).split('#')[0];
      try {
        chemin = decodeURI(chemin);
      } catch {}
      const dest = chemin ? this.app.metadataCache.getFirstLinkpathDest(chemin, fichier.path) : null;
      let texte = l.displayText && l.displayText !== l.link ? l.displayText : '';
      if (l.estIntegre && /^\d+(x\d+)?$/.test(texte)) texte = ''; // ![[x.png|300]] : taille, pas texte
      let cible = null;
      if (dest && EXT_IMAGES.includes(dest.extension.toLowerCase())) {
        cible = { type: 'image', chemin: dest.path, nom: `${slugifier(dest.basename) || 'image'}.${dest.extension.toLowerCase()}` };
      } else if (dest && this.estEssai(dest)) {
        cible = { type: 'essai', slug: nomPublie(dest.basename).replace(/\.md$/, '') };
        texte = texte || dest.basename;
      } else {
        texte = texte || (dest ? dest.basename : chemin.split('/').pop().replace(/\.md$/, ''));
      }
      liens.push({ original: l.original, estIntegre: l.estIntegre, texte, cible });
    }
    return liens;
  }

  /** Prépare la version du site : texte converti, images à copier, liens convertis. */
  async preparerCopie(fichier) {
    const contenu = await this.app.vault.read(fichier);
    const { texte, images, convertis } = convertirNote(contenu, this.liensDe(fichier));
    const destination = path.join(this.dossierContenu(), this.cheminPublie(fichier));
    let actuel = null;
    try {
      actuel = fs.readFileSync(destination, 'utf8');
    } catch {}
    return { fichier, texte, images, convertis, destination, existe: actuel !== null, change: actuel !== texte };
  }

  /** Écrit la version du site (note + images) dans le projet. */
  async ecrireCopie({ texte, images, destination }) {
    const dossierImages = path.join(this.dossierContenu(), DOSSIER_ESSAIS, DOSSIER_IMAGES);
    for (const [nom, chemin] of images) {
      const source = this.app.vault.getAbstractFileByPath(chemin);
      if (!(source instanceof TFile)) continue;
      fs.mkdirSync(dossierImages, { recursive: true });
      fs.writeFileSync(path.join(dossierImages, nom), Buffer.from(await this.app.vault.readBinary(source)));
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, texte, 'utf8');
  }

  /* --- Commandes --- */

  async publier(fichier) {
    if (this.enCours) return new Notice('Un envoi est déjà en cours.');

    const copie = this.modeCopie();
    const fm = this.app.metadataCache.getFileCache(fichier)?.frontmatter ?? {};
    const dejaPublie = fm.statut === 'publie';
    const proposerDate = this.reglages.dateDuJour && !dejaPublie;
    const chemin = this.cheminPublie(fichier);
    const nomFichier = path.basename(chemin);

    const { erreurs, avertissements } = verifierEssai(fm, {
      series: this.seriesConnues(),
      nomFichier,
      dateRemplacee: proposerDate,
    });

    if (erreurs.length) {
      new ModaleConfirmation(this.app, {
        titre: 'Impossible de publier cet essai',
        intro: 'Le site ne pourrait pas être généré. Corrige ces propriétés, puis recommence :',
        listes: [
          { titre: 'À corriger', elements: erreurs, classe: 'av-erreurs' },
          { titre: 'À noter', elements: avertissements },
        ],
      }).open();
      return;
    }

    let depot;
    let autres = [];
    let apercu = null;
    try {
      depot = await this.depot();
      autres = (await this.fichiersModifies(depot)).filter((l) => !l.startsWith(`${chemin} `));
      if (copie) apercu = await this.preparerCopie(fichier);
    } catch (e) {
      return new Notice(`Publication impossible : ${expliquerErreurGit(e.sortie ?? String(e))}`, 0);
    }

    const notes = [...avertissements];
    if (copie) {
      notes.push(`Copié dans le site sous ${chemin}${apercu.images.size ? `, avec ${apercu.images.size} image(s)` : ''}.`);
      if (apercu.existe && !dejaPublie) notes.push('Un essai du même nom existe déjà sur le site : il sera remplacé.');
    }

    const titre = String(fm.titre).trim();
    const adresse = adresseEssai(this.reglages.site, chemin);

    new ModaleConfirmation(this.app, {
      titre: dejaPublie ? 'Mettre à jour cet essai en ligne ?' : 'Publier cet essai ?',
      intro: `« ${titre} » sera ${dejaPublie ? 'mis à jour' : 'publié'} à l'adresse ${adresse}, environ une minute après l'envoi.`,
      listes: [
        { titre: 'À noter', elements: notes },
        { titre: 'Liens Obsidian sans équivalent sur le site', elements: apercu?.convertis ?? [] },
        { titre: 'Autres fichiers modifiés du site, envoyés aussi', elements: autres },
      ],
      case: proposerDate ? { libelle: `Mettre la date d'aujourd'hui (${aujourdhui()})`, valeur: true } : undefined,
      bouton: dejaPublie ? 'Mettre à jour' : 'Publier',
      auConfirmer: async ({ coche }) => {
        try {
          await this.app.fileManager.processFrontMatter(fichier, (p) => {
            p.statut = 'publie';
            if (proposerDate && coche) p.date = aujourdhui();
          });
        } catch (e) {
          return new Notice(`Impossible de modifier les propriétés : ${e.message}`, 0);
        }
        if (proposerDate && !coche) {
          // La date n'a pas été vérifiée plus haut : on le fait maintenant.
          const relu = this.app.metadataCache.getFileCache(fichier)?.frontmatter ?? fm;
          const { erreurs: e2 } = verifierEssai(relu, { series: this.seriesConnues(), nomFichier, dateRemplacee: false });
          if (e2.length) return new Notice(`Publication annulée : ${e2.join(' ')}`, 0);
        }
        if (copie) {
          try {
            await this.ecrireCopie(await this.preparerCopie(fichier));
          } catch (e) {
            return new Notice(`Impossible de copier l'essai dans le projet : ${e.message}`, 0);
          }
        }
        await this.envoyer(depot, `${dejaPublie ? 'Mise à jour' : 'Publication'} : ${titre}`, adresse);
      },
    }).open();
  }

  async envoyerCorrections() {
    if (this.enCours) return new Notice('Un envoi est déjà en cours.');
    let depot;
    let fichiers;
    const copies = [];
    const ignores = [];
    const convertis = [];
    try {
      depot = await this.depot();
      if (this.modeCopie()) {
        // Recopie les essais du dossier dont les propriétés sont valides.
        const series = this.seriesConnues();
        const notes = this.app.vault.getMarkdownFiles().filter((f) => this.estEssai(f));
        for (const f of notes) {
          const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
          const { erreurs } = verifierEssai(fm, { series, nomFichier: nomPublie(f.basename), dateRemplacee: false });
          if (erreurs.length) {
            ignores.push(`${f.basename} : ${erreurs[0]}`);
            continue;
          }
          const apercu = await this.preparerCopie(f);
          if (apercu.change || apercu.images.size) copies.push(apercu);
          if (apercu.change) convertis.push(...apercu.convertis.map((c) => `${f.basename} : ${c}`));
        }
      }
      fichiers = await this.fichiersModifies(depot);
    } catch (e) {
      return new Notice(`Envoi impossible : ${expliquerErreurGit(e.sortie ?? String(e))}`, 0);
    }

    const aCopier = copies.filter((c) => c.change).map((c) => `${c.fichier.basename} → ${this.cheminPublie(c.fichier)}`);

    if (!fichiers.length && !aCopier.length) {
      if (ignores.length) {
        new ModaleConfirmation(this.app, {
          titre: 'Rien à envoyer',
          intro: 'Aucun essai valide n’a changé. Ces notes ne sont pas envoyées car leurs propriétés sont incomplètes :',
          listes: [{ titre: 'Non envoyées', elements: ignores }],
        }).open();
        return;
      }
      // Rien de neuf, mais un envoi précédent a pu échouer : on retente le push.
      return this.envoyer(depot, null, this.reglages.site);
    }

    new ModaleConfirmation(this.app, {
      titre: 'Envoyer les corrections ?',
      intro: 'Ces changements partiront sur GitHub, puis le site sera regénéré. Les brouillons restent invisibles en ligne.',
      listes: [
        { titre: 'Essais recopiés dans le site', elements: aCopier },
        { titre: 'Fichiers modifiés du site', elements: fichiers },
        { titre: 'Liens Obsidian sans équivalent sur le site', elements: convertis },
        { titre: 'Non envoyées (propriétés incomplètes)', elements: ignores },
      ],
      champ: { libelle: 'Description', valeur: 'Corrections' },
      bouton: 'Envoyer',
      auConfirmer: async ({ texte }) => {
        try {
          for (const c of copies) await this.ecrireCopie(c);
        } catch (e) {
          return new Notice(`Impossible de copier les essais dans le projet : ${e.message}`, 0);
        }
        await this.envoyer(depot, texte.trim() || 'Corrections', this.reglages.site);
      },
    }).open();
  }

  /** git add + commit (si besoin) + push, avec un message d'état pendant l'envoi. */
  async envoyer({ racine, relatif }, message, adresse) {
    this.enCours = true;
    const etat = new Notice('Envoi vers GitHub…', 0);
    try {
      if (message) {
        await git(['add', '--all', '--', relatif], racine);
        let aCommiter = false;
        try {
          await git(['diff', '--cached', '--quiet', '--', relatif], racine);
        } catch {
          aCommiter = true; // code de sortie 1 : il y a des changements indexés
        }
        if (aCommiter) await git(['commit', '-m', message, '--', relatif], racine);
      }
      const { stderr } = await git(['push'], racine);
      etat.hide();
      if (/everything up-to-date/i.test(stderr) && !message) {
        new Notice('Rien de nouveau à envoyer : tout est déjà sur GitHub.');
      } else {
        new Notice(`Envoyé. Le site sera à jour dans une minute environ :\n${adresse}`, 12000);
      }
    } catch (e) {
      etat.hide();
      new Notice(`Échec de l'envoi : ${expliquerErreurGit(e.sortie ?? String(e))}`, 0);
      console.error('[ars-virtualis-publier]', e);
    } finally {
      this.enCours = false;
    }
  }

  async sauver() {
    await this.saveData(this.reglages);
  }
};

class OngletReglages extends PluginSettingTab {
  constructor(app, extension) {
    super(app, extension);
    this.extension = extension;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    const r = this.extension.reglages;
    const sauver = async () => {
      await this.extension.sauver();
    };

    new Setting(containerEl)
      .setName('Dossier du projet du site')
      .setDesc(
        'Laisser vide si ce coffre est le dossier src/content du site. Sinon, chemin du projet sur cet ordinateur (ex. ~/Claude/Projects/ArsVirtualis) : les essais seront copiés dedans à la publication.',
      )
      .addText((t) =>
        t.setPlaceholder('~/Claude/Projects/ArsVirtualis').setValue(r.projet).onChange(async (v) => {
          r.projet = v.trim();
          await sauver();
        }),
      );

    new Setting(containerEl)
      .setName('Dossier des essais dans ce coffre')
      .setDesc('Utilisé seulement si le dossier du projet est renseigné. Les notes dont le nom commence par « _ » sont ignorées.')
      .addText((t) =>
        t.setValue(r.dossierSource).onChange(async (v) => {
          r.dossierSource = v.trim() || DEFAUTS.dossierSource;
          await sauver();
        }),
      );

    new Setting(containerEl)
      .setName('Adresse du site')
      .setDesc('Sert à afficher le lien de l’essai publié. À changer si vous prenez un nom de domaine.')
      .addText((t) =>
        t.setValue(r.site).onChange(async (v) => {
          r.site = v.trim() || DEFAUTS.site;
          await sauver();
        }),
      );

    new Setting(containerEl)
      .setName('Proposer la date du jour')
      .setDesc('À la première publication, propose de remplacer « date » par la date du jour.')
      .addToggle((t) =>
        t.setValue(r.dateDuJour).onChange(async (v) => {
          r.dateDuJour = v;
          await sauver();
        }),
      );
  }
}

// Exposé pour les tests hors Obsidian.
module.exports.outils = { verifierEssai, adresseEssai, slugifier, nomPublie, convertirNote, expliquerErreurGit, git };
