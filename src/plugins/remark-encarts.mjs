/**
 * Encarts à la manière des « callouts » d'Obsidian :
 *
 *   > [!definition] Occasion
 *   > Le cadre pratique qui fixe ce qui compte comme vrai, réussi ou pertinent.
 *
 * devient <aside class="encart encart--definition"> avec un titre.
 * Le même texte s'affiche donc comme un encart dans Obsidian et sur le site.
 * Types prévus : definition, objection, aparte, these, note, exemple.
 */

const TITRES = {
  definition: 'Définition',
  objection: 'Objection',
  aparte: 'Aparté',
  these: 'Thèse',
  note: 'Note',
  exemple: 'Exemple',
};

const MARQUEUR = /^\[!([\p{L}-]+)\][+-]?[ \t]*([^\n]*)\n?/u;

function sansAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function transformer(citation) {
  const premier = citation.children[0];
  if (!premier || premier.type !== 'paragraph') return;

  // Le marqueur peut être découpé en plusieurs nœuds texte : on les recolle.
  let n = 0;
  let texte = '';
  while (n < premier.children.length && premier.children[n].type === 'text') {
    texte += premier.children[n].value;
    n += 1;
  }
  const m = texte.match(MARQUEUR);
  if (!m) return;

  const type = sansAccents(m[1]);
  const titre = m[2].trim() || TITRES[type] || type.charAt(0).toUpperCase() + type.slice(1);
  const reste = texte.slice(m[0].length);

  premier.children.splice(0, n, ...(reste ? [{ type: 'text', value: reste }] : []));
  if (premier.children.length === 0) citation.children.shift();

  citation.data = {
    hName: 'aside',
    hProperties: { className: ['encart', `encart--${type}`] },
  };
  citation.children.unshift({
    type: 'paragraph',
    data: { hProperties: { className: ['encart__titre'] } },
    children: [{ type: 'text', value: titre }],
  });
}

function parcourir(noeud) {
  if (!noeud.children) return;
  for (const enfant of noeud.children) {
    if (enfant.type === 'blockquote') transformer(enfant);
    parcourir(enfant);
  }
}

export function remarkEncarts() {
  return (arbre) => parcourir(arbre);
}
