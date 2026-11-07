// @ts-check
import { defineConfig } from 'astro/config';
import { remarkEncarts } from './src/plugins/remark-encarts.mjs';
import { remarkTypoFr } from './src/plugins/remark-typo-fr.mjs';

export default defineConfig({
  // À remplacer par votre nom de domaine définitif (sert au flux RSS et aux liens canoniques).
  site: 'https://ars-virtualis.vercel.app',
  trailingSlash: 'ignore',
  markdown: {
    remarkPlugins: [remarkEncarts, remarkTypoFr],
    remarkRehype: {
      footnoteLabel: 'Notes',
      footnoteBackLabel: 'Retour au texte',
    },
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
    },
  },
});
