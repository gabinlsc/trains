/**
 * Catalogue des sources ouvertes. Chaque entrée est reprise telle quelle dans
 * le manifeste et dans docs/DONNEES.md. Une `sha256` n'est renseignée que
 * pour les fichiers amont immuables (les API renvoient un contenu qui évolue).
 */
export interface SourceDefinition {
  id: string;
  title: string;
  producer: string;
  license: string;
  url: string;
  sha256?: string;
}
