import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/carte');
});

test('le panneau liste les calques par groupe, réseau réel et communes actifs', async ({
  page,
}) => {
  const panel = page.getByRole('region', { name: 'Calques' });
  await expect(panel.getByRole('group', { name: 'Réseau ferré' })).toBeVisible();
  await expect(panel.getByLabel('Réseau ferré actuel')).toBeChecked();
  await expect(panel.getByLabel('Communes de 2 000 habitants ou plus')).toBeChecked();
  await expect(panel.getByLabel('Gares voyageurs')).not.toBeChecked();
});

test('les données publiées se chargent par leur version', async ({ page }) => {
  const request = page.waitForRequest((r) =>
    r.url().endsWith('/data/2026.01.1/lignes-rfn.geojson'),
  );
  await page.reload();
  await request;
  await expect(page.getByText('données indisponibles')).toHaveCount(0);
});

test('un calque sans données le signale sans bloquer la carte', async ({ page }) => {
  await page.getByLabel('Gares voyageurs').check();
  await expect(page.getByText('données indisponibles')).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
});

test('les choix de calques sont mémorisés', async ({ page }) => {
  await page.getByLabel('Lignes fermées ou neutralisées').check();
  await page.getByLabel('Réseau ferré actuel').uncheck();
  await page.reload();
  await expect(page.getByLabel('Lignes fermées ou neutralisées')).toBeChecked();
  await expect(page.getByLabel('Réseau ferré actuel')).not.toBeChecked();
});

test('le panneau se replie au clavier', async ({ page }) => {
  const toggle = page.getByRole('button', { name: 'Masquer les calques' });
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Réseau ferré actuel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Afficher les calques' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('les attributions des données sont affichées en permanence', async ({ page }) => {
  const attrib = page.locator('.maplibregl-ctrl-attrib');
  await expect(attrib).toContainText('SNCF Réseau');
  await expect(attrib).toContainText('INSEE');
  await expect(attrib).toContainText('Parcs nationaux de France');
});
