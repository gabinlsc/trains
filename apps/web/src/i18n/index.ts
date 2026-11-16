import { fr, type Messages } from './fr.ts';

/** Chemins pointés (« landing.status ») vers chaque chaîne du catalogue. */
type Paths<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Paths<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Messages>;
export type Params = Readonly<Record<string, string | number>>;

const catalogs = { fr } as const satisfies Record<string, Messages>;
export type Locale = keyof typeof catalogs;

let current: Messages = catalogs.fr;

export function setLocale(locale: Locale): void {
  current = catalogs[locale];
}

/**
 * Traduit une clé. Les paramètres « {nom} » sont substitués ; une clé
 * absente renvoie la clé elle-même, ce qui la rend visible en recette
 * plutôt que de faire planter l'interface.
 */
export function t(key: MessageKey, params?: Params): string {
  let node: unknown = current;
  for (const part of key.split('.')) {
    node =
      typeof node === 'object' && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== 'string') return key;
  return params ? interpolate(node, params) : node;
}

/** Remplace les « {nom} » connus ; les inconnus restent tels quels. */
export function interpolate(template: string, params: Params): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}
