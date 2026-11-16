/** Identité publique de l'application, utilisée par le front, l'API et les images OG. */
export const APP_NAME = 'Rails de France';
export const APP_SLUG = 'trains';
export const DEFAULT_PUBLIC_URL = 'https://trains.glsc.fr';

/** Langue par défaut ; l'architecture i18n accepte d'autres locales plus tard. */
export const DEFAULT_LOCALE = 'fr';
export const SUPPORTED_LOCALES = ['fr'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
