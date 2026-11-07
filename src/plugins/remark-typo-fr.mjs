/**
 * Typographie française automatique dans le texte courant (jamais dans le code) :
 *  - espace fine insécable avant ; ! ? et à l'intérieur des guillemets « »
 *  - espace insécable avant :
 * On peut donc écrire normalement dans Obsidian.
 */

const FINE = '\u202F';
const INSECABLE = '\u00A0';

function corriger(t) {
  return t
    .replace(/[ \u00A0\u202F]+([;!?])/g, `${FINE}$1`)
    .replace(/[ \u00A0]+:/g, `${INSECABLE}:`)
    .replace(/«[ \u00A0\u202F]*/g, `«${FINE}`)
    .replace(/[ \u00A0\u202F]*»/g, `${FINE}»`);
}

function parcourir(noeud) {
  if (noeud.type === 'text') {
    noeud.value = corriger(noeud.value);
    return;
  }
  if (noeud.type === 'code' || noeud.type === 'inlineCode') return;
  if (noeud.children) noeud.children.forEach(parcourir);
}

export function remarkTypoFr() {
  return (arbre) => parcourir(arbre);
}
