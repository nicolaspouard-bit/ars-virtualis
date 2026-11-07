import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../config';
import { essaisVisibles } from '../lib/contenu';

export async function GET(context: APIContext) {
  const essais = (await essaisVisibles()).filter((e) => e.data.statut === 'publie');
  return rss({
    title: `${SITE.sousTitre} | ${SITE.titre}`,
    description: SITE.description,
    site: context.site ?? 'https://ars-virtualis.vercel.app',
    customData: '<language>fr-fr</language>',
    items: essais.map((e) => ({
      title: e.data.titre,
      pubDate: e.data.date,
      description: e.data.resume,
      link: `/essais/${e.id}/`,
    })),
  });
}
