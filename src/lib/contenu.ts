import { getCollection, type CollectionEntry } from 'astro:content';

export type Essai = CollectionEntry<'essais'>;
export type Serie = CollectionEntry<'series'>;

export const REGISTRES = {
  these: 'Pièce-thèse',
  pont: 'Essai-pont',
  atelier: 'Note d’atelier',
} as const;

/** Essais publiés, du plus récent au plus ancien. En local (npm run dev), les brouillons sont visibles aussi. */
export async function essaisVisibles(): Promise<Essai[]> {
  const tous = await getCollection(
    'essais',
    ({ data }) => import.meta.env.DEV || data.statut === 'publie',
  );
  return tous.sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** Essais d'une série, dans l'ordre des parties. */
export function essaisDeLaSerie(essais: Essai[], serieId: string): Essai[] {
  return essais
    .filter((e) => e.data.serie?.id === serieId)
    .sort((a, b) => (a.data.partie ?? 0) - (b.data.partie ?? 0) || a.data.date.valueOf() - b.data.date.valueOf());
}

/** Séries qui contiennent au moins un essai visible. */
export async function seriesVisibles(essais: Essai[]): Promise<Serie[]> {
  const series = await getCollection('series');
  return series
    .filter((s) => essais.some((e) => e.data.serie?.id === s.id))
    .sort((a, b) => a.data.ordre - b.data.ordre || a.data.titre.localeCompare(b.data.titre, 'fr'));
}

export function tempsDeLecture(texte = ''): number {
  const mots = texte
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^---[\s\S]*?---/, '')
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.round(mots / 230));
}

const formatJour = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
export const formatDate = (d: Date) => formatJour.format(d);

const ROMAINS: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
  [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];
export function romain(n: number): string {
  let r = '';
  for (const [v, s] of ROMAINS) {
    while (n >= v) {
      r += s;
      n -= v;
    }
  }
  return r;
}

/** Typographie française pour les titres et résumés saisis dans le frontmatter. */
export function typo(t = ''): string {
  return t
    .replace(/[ \u00A0\u202F]+([;!?])/g, '\u202F$1')
    .replace(/[ \u00A0]+:/g, '\u00A0:')
    .replace(/«[ \u00A0\u202F]*/g, '«\u202F')
    .replace(/[ \u00A0\u202F]*»/g, '\u202F»')
    .replace(/'/g, '’');
}
