/*
 * Ars Virtualis : publier
 * Extension Obsidian (ordinateur uniquement) écrite pour ce site.
 *
 * Commande « Publier l'essai ouvert » :
 *   1. vérifie les propriétés de l'essai (mêmes règles que src/content.config.ts) ;
 *   2. demande confirmation ;
 *   3. passe « statut » à « publie » (et, au choix, « date » à aujourd'hui) ;
 *   4. git add + commit + push des fichiers du coffre. Vercel republie le site.
 *
 * Commande « Envoyer les corrections » : commit + push de toutes les
 * modifications du coffre, sans toucher aux propriétés.
 *
 * Fichier JavaScript simple, sans étape de compilation : on peut le modifier directement.
 */

const { Plugin, Modal, Notice, PluginSettingTab, Setting, FileSystemAdapter, TFile } = require('obsidian');
const { execFile } = require('child_process');
const path = require('path');

const DEFAUTS = {
  site: 'https://ars-virtualis.vercel.app',
  dateDuJour: true,
};

const REGISTRES = ['these', 'pont', 'atelier'];
const DOSSIER_ESSAIS = 'essais';
const DOSSIER_SERIES = 'series';

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

/** Traduit les erreurs Git courantes en consignes compréhensibles. */
function expliquerErreurGit(sortie) {
  const s = sortie.toLowerCase();
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
    return "Ce coffre n'est pas dans un dépôt Git. Ouvre bien le dossier ars-virtualis/src/content comme coffre.";
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
   * options : { titre, intro, listes: [{ titre, elements, classe }], fichiers, case, champ, bouton, auConfirmer }
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
      else new Notice(`Ouvre d'abord un essai du dossier « ${DOSSIER_ESSAIS} ».`);
    });

    this.addSettingTab(new OngletReglages(this.app, this));
  }

  essaiOuvert() {
    const f = this.app.workspace.getActiveFile();
    return f instanceof TFile && f.extension === 'md' && f.path.startsWith(`${DOSSIER_ESSAIS}/`) ? f : null;
  }

  dossierCoffre() {
    const adaptateur = this.app.vault.adapter;
    return adaptateur instanceof FileSystemAdapter ? adaptateur.getBasePath() : null;
  }

  /** Racine du dépôt et chemin du coffre relatif à cette racine. */
  async depot() {
    const coffre = this.dossierCoffre();
    if (!coffre) throw Object.assign(new Error('coffre'), { sortie: 'not a git repository' });
    const { stdout } = await git(['rev-parse', '--show-toplevel'], coffre);
    const racine = stdout.trim();
    return { racine, relatif: path.relative(racine, coffre) || '.' };
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
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${DOSSIER_SERIES}/`))
      .map((f) => f.basename);
  }

  async publier(fichier) {
    if (this.enCours) return new Notice('Un envoi est déjà en cours.');

    const fm = this.app.metadataCache.getFileCache(fichier)?.frontmatter ?? {};
    const dejaPublie = fm.statut === 'publie';
    const proposerDate = this.reglages.dateDuJour && !dejaPublie;

    const { erreurs, avertissements } = verifierEssai(fm, {
      series: this.seriesConnues(),
      nomFichier: fichier.name,
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
    try {
      depot = await this.depot();
      autres = (await this.fichiersModifies(depot)).filter((l) => !l.startsWith(`${fichier.path} `));
    } catch (e) {
      return new Notice(`Publication impossible : ${expliquerErreurGit(e.sortie ?? String(e))}`, 0);
    }

    const titre = String(fm.titre).trim();
    const adresse = adresseEssai(this.reglages.site, fichier.path);

    new ModaleConfirmation(this.app, {
      titre: dejaPublie ? 'Mettre à jour cet essai en ligne ?' : 'Publier cet essai ?',
      intro: `« ${titre} » sera ${dejaPublie ? 'mis à jour' : 'publié'} à l'adresse ${adresse}, environ une minute après l'envoi.`,
      listes: [
        { titre: 'À noter', elements: avertissements },
        { titre: 'Autres fichiers modifiés, envoyés aussi', elements: autres },
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
          const { erreurs: e2 } = verifierEssai(relu, { series: this.seriesConnues(), nomFichier: fichier.name, dateRemplacee: false });
          if (e2.length) return new Notice(`Publication annulée : ${e2.join(' ')}`, 0);
        }
        await this.envoyer(depot, `${dejaPublie ? 'Mise à jour' : 'Publication'} : ${titre}`, adresse);
      },
    }).open();
  }

  async envoyerCorrections() {
    if (this.enCours) return new Notice('Un envoi est déjà en cours.');
    let depot;
    let fichiers;
    try {
      depot = await this.depot();
      fichiers = await this.fichiersModifies(depot);
    } catch (e) {
      return new Notice(`Envoi impossible : ${expliquerErreurGit(e.sortie ?? String(e))}`, 0);
    }

    if (!fichiers.length) {
      // Rien de neuf, mais un envoi précédent a pu échouer : on retente le push.
      return this.envoyer(depot, null, this.reglages.site);
    }

    new ModaleConfirmation(this.app, {
      titre: 'Envoyer les corrections ?',
      intro: 'Ces fichiers partiront sur GitHub, puis le site sera regénéré. Les brouillons restent invisibles en ligne.',
      listes: [{ titre: 'Fichiers modifiés', elements: fichiers }],
      champ: { libelle: 'Description', valeur: 'Corrections' },
      bouton: 'Envoyer',
      auConfirmer: ({ texte }) => this.envoyer(depot, texte.trim() || 'Corrections', this.reglages.site),
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

    new Setting(containerEl)
      .setName('Adresse du site')
      .setDesc('Sert à afficher le lien de l’essai publié. À changer si vous prenez un nom de domaine.')
      .addText((t) =>
        t.setValue(this.extension.reglages.site).onChange(async (v) => {
          this.extension.reglages.site = v.trim() || DEFAUTS.site;
          await this.extension.sauver();
        }),
      );

    new Setting(containerEl)
      .setName('Proposer la date du jour')
      .setDesc('À la première publication, propose de remplacer « date » par la date du jour.')
      .addToggle((t) =>
        t.setValue(this.extension.reglages.dateDuJour).onChange(async (v) => {
          this.extension.reglages.dateDuJour = v;
          await this.extension.sauver();
        }),
      );
  }
}

// Exposé pour les tests hors Obsidian.
module.exports.outils = { verifierEssai, adresseEssai, slugifier, expliquerErreurGit, git };
