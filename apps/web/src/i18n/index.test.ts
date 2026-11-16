import { describe, expect, it } from 'vitest';
import { interpolate, setLocale, t, type MessageKey } from './index.ts';

describe('t', () => {
  it('traduit une clé imbriquée', () => {
    setLocale('fr');
    expect(t('landing.status')).toBe('Bientôt disponible');
    expect(t('landing.features.build.title')).toBe('Infrastructure');
  });

  it('renvoie la clé si elle est inconnue', () => {
    expect(t('landing.inconnue' as MessageKey)).toBe('landing.inconnue');
    expect(t('app.name.trop.profond' as MessageKey)).toBe('app.name.trop.profond');
  });

  it('ignore les paramètres d’une chaîne qui n’en attend pas', () => {
    expect(t('app.name', { x: 1 })).toBe('Rails de France');
  });
});

describe('interpolate', () => {
  it('substitue les paramètres connus et laisse les autres intacts', () => {
    expect(interpolate('{a} → {b} en {min} min', { a: 'Brest', min: 42 })).toBe(
      'Brest → {b} en 42 min',
    );
  });
});
