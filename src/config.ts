/**
 * Réglages du site : c'est le seul fichier à modifier pour changer
 * le titre, le sous-titre, la baseline, le contact ou la newsletter.
 */
export const SITE = {
  titre: 'Nicolas Pouard',
  sousTitre: 'Ars Virtualis',
  baseline: 'Le virtuel n’est pas le simulé',
  description:
    'Essais sur ce que les modèles d’IA comprennent, et sur ce qu’ils ne font que simuler, à partir de la phénoménologie et du réalisme contextuel.',
  auteur: 'Nicolas Pouard',
  langue: 'fr',
  // Adresse de contact affichée sur la page Travaux (laisser vide pour la masquer).
  email: '',
  // Page d'abonnement à la newsletter, par exemple https://arsvirtualis.substack.com
  // (laisser vide tant qu'elle n'existe pas : les blocs d'inscription sont alors masqués).
  newsletter: '',
};

export const NAVIGATION = [
  { href: '/essais/', libelle: 'Essais' },
  { href: '/series/', libelle: 'Séries' },
  { href: '/travaux/', libelle: 'Travaux' },
];
