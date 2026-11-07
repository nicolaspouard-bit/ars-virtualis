/**
 * Notes de marge à la Tufte, en amélioration progressive.
 * On écrit des notes de bas de page markdown ordinaires ([^1]) dans Obsidian ;
 * sur grand écran, chaque note est recopiée dans la marge, à hauteur de son appel,
 * et la liste en bas de page est masquée (le CSS décide selon la largeur d'écran).
 */
function construireNotesMarge(): void {
  const prose = document.querySelector<HTMLElement>('.prose');
  if (!prose) return;

  const appels = prose.querySelectorAll<HTMLAnchorElement>('a[data-footnote-ref]');
  if (appels.length === 0) return;

  appels.forEach((appel) => {
    const id = decodeURIComponent(appel.hash.slice(1));
    const note = document.getElementById(id);
    if (!note) return;

    const marge = document.createElement('span');
    marge.className = 'note-marge';
    marge.setAttribute('role', 'note');

    const numero = document.createElement('span');
    numero.className = 'note-marge__numero';
    numero.textContent = appel.textContent ?? '';

    const contenu = note.cloneNode(true) as HTMLElement;
    contenu.querySelectorAll('[data-footnote-backref]').forEach((retour) => retour.remove());
    contenu.removeAttribute('id');

    // Le numéro se place au début du premier paragraphe de la note.
    const premier = contenu.querySelector('p');
    if (premier) premier.prepend(numero);
    else contenu.prepend(numero);
    marge.append(...Array.from(contenu.childNodes));

    const sup = appel.closest('sup') ?? appel;
    sup.after(marge);
  });

  document.body.classList.add('avec-notes-marge');
}

construireNotesMarge();
