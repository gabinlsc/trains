import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

async function openMap(page: Page): Promise<void> {
  await page.goto('/carte');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await page.waitForTimeout(800);
}

async function drawLine(page: Page): Promise<void> {
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('carte absente');
  await page.keyboard.press('t');
  for (const [fx, fy] of [
    [0.45, 0.4],
    [0.6, 0.45],
  ] as const) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await page.keyboard.press('Enter');
}

test('la partie est sauvegardée dans le navigateur et survit au rechargement', async ({ page }) => {
  await openMap(page);
  const panel = page.getByRole('region', { name: 'Partie' });
  await panel.getByLabel('Nom de la partie').fill('Transversale');
  await panel.getByLabel('Nom de la partie').press('Enter');
  await drawLine(page);
  await expect(panel.getByText('Enregistré dans ce navigateur')).toBeVisible();
  await page.reload();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(panel.getByLabel('Nom de la partie')).toHaveValue('Transversale');
  await expect(page.getByRole('button', { name: 'Supprimer la sélection (Suppr)' })).toBeDisabled();
  // Le réseau restauré se sélectionne : la touche Suppr devient active.
  await page.keyboard.press('v');
  const box = await page.locator('canvas.maplibregl-canvas').boundingBox();
  if (!box) throw new Error('carte absente');
  await expect(async () => {
    await page.mouse.click(box.x + box.width * 0.525, box.y + box.height * 0.425);
    await expect(page.getByRole('heading', { name: 'Tronçon' })).toBeVisible({ timeout: 500 });
  }).toPass();
});

test('exporter puis réimporter une sauvegarde, et exporter en GeoJSON', async ({ page }) => {
  await openMap(page);
  await drawLine(page);
  const panel = page.getByRole('region', { name: 'Partie' });

  const [saveDownload] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Exporter la sauvegarde (JSON)' }).click(),
  ]);
  expect(saveDownload.suggestedFilename()).toBe('mon-reseau.json');
  const saveText = await readFile(await saveDownload.path(), 'utf8');
  const save = JSON.parse(saveText) as { version: number; network: { segments: object } };
  expect(save.version).toBe(1);
  expect(Object.keys(save.network.segments)).toHaveLength(1);

  const [geoDownload] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Exporter le réseau (GeoJSON)' }).click(),
  ]);
  expect(geoDownload.suggestedFilename()).toBe('mon-reseau.geojson');
  const geo = JSON.parse(await readFile(await geoDownload.path(), 'utf8')) as {
    features: unknown[];
  };
  expect(geo.features).toHaveLength(3);

  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  await panel.getByRole('button', { name: 'Nouvelle partie' }).click();
  await expect(page.getByRole('button', { name: 'Annuler (Ctrl+Z)' })).toBeDisabled();

  const chooser = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Importer une sauvegarde' }).click();
  await (
    await chooser
  ).setFiles({ name: 'import.json', mimeType: 'application/json', buffer: Buffer.from(saveText) });
  await expect(panel.getByText('Sauvegarde « Mon réseau » importée.')).toBeVisible();

  const bad = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: 'Importer une sauvegarde' }).click();
  await (
    await bad
  ).setFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.getByRole('alert')).toContainText('n’est pas une sauvegarde');
});
