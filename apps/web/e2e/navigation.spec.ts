import { expect, test, type Page } from '@playwright/test';

/** Échoue sur toute erreur JavaScript non interceptée. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('l’accueil présente le jeu et mène à la carte', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page).toHaveTitle('Rails de France');
  await expect(page.getByRole('heading', { level: 1, name: 'Rails de France' })).toBeVisible();
  await page.getByRole('link', { name: 'Ouvrir la carte' }).click();
  await expect(page).toHaveURL(/\/carte$/);
  await expect(page).toHaveTitle('Carte · Rails de France');
  expect(errors).toEqual([]);
});

test('la carte s’affiche avec ses contrôles et ses attributions', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/carte');
  await expect(page.getByRole('region', { name: 'Carte de la France' })).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: /zoom/i }).first()).toBeVisible();
  await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText(
    'contributeurs OpenStreetMap',
  );
  expect(errors).toEqual([]);
});

test('sans fond de carte, un message explique la situation', async ({ page }) => {
  await page.goto('/carte');
  await expect(page.getByRole('status')).toContainText('Fond de carte indisponible');
});

test('le thème se bascule et reste mémorisé', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/carte');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Passer au thème sombre' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Passer au thème clair' })).toBeVisible();
});

test('une adresse inconnue affiche une page dédiée', async ({ page }) => {
  await page.goto('/ligne/inexistante');
  await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
  await page.getByRole('link', { name: 'Retour à l’accueil' }).click();
  await expect(page).toHaveURL(/\/$/);
});

test('les boutons précédent et suivant du navigateur fonctionnent', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Ouvrir la carte' }).click();
  await expect(page).toHaveURL(/\/carte$/);
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Rails de France' })).toBeVisible();
});
