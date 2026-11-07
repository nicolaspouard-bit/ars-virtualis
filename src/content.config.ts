import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Une série = un fichier dans src/content/series/.
 * Le nom du fichier (sans .md) sert d'identifiant, à reprendre
 * dans le champ « serie » des essais.
 */
const series = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/series' }),
  schema: z.object({
    titre: z.string(),
    resume: z.string(),
    ordre: z.number().default(0),
  }),
});

/**
 * Un essai = un fichier dans src/content/essais/.
 * Les fichiers dont le nom commence par « _ » sont ignorés (modèles, brouillons privés).
 */
const essais = defineCollection({
  loader: glob({ pattern: '**/[^_]*.md', base: './src/content/essais' }),
  schema: z.object({
    titre: z.string(),
    date: z.coerce.date(),
    resume: z.string(),
    registre: z.enum(['these', 'pont', 'atelier']),
    statut: z.enum(['brouillon', 'publie']).default('brouillon'),
    serie: reference('series').nullish(),
    partie: z.number().int().positive().nullish(),
    tags: z.array(z.string()).default([]),
    enAvant: z.boolean().default(false),
  }),
});

export const collections = { series, essais };
