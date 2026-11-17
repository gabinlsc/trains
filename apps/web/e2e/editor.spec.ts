import { expect, test, type Page } from '@playwright/test';

async function openMap(page: Page): Promise<void> {
  await page.goto('/carte');
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  // Laisse au style le temps de se charger (couches de l'éditeur installées).
  await page.waitForTimeout(800);
}

async function drawLine(page: Page): Promise<void> {
  const canvas = page.locator('canvas.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('carte absente');
  await page.keyboard.press('t');
  await expect(page.getByRole('button', { name: 'Tracer une voie (T)' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  for (const [fx, fy] of [
    [0.45, 0.4],
    [0.6, 0.45],
    [0.65, 0.65],
  ] as const) {
    await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
  }
  await page.keyboard.press('Enter');
}

test('tracer une voie puis l’annuler et la rétablir au clavier', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openMap(page);
  const undo = page.getByRole('button', { name: 'Annuler (Ctrl+Z)' });
  const redo = page.getByRole('button', { name: 'Rétablir (Ctrl+Maj+Z)' });
  await expect(undo).toBeDisabled();
  await drawLine(page);
  await expect(undo).toBeEnabled();
  await expect(undo).toHaveAttribute('title', 'Annuler : Tracer un tronçon');
  await page.keyboard.press('Control+z');
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(undo).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Échap abandonne un tracé en cours sans rien créer', async ({ page }) => {
  await openMap(page);
  const canvas = page.locator('canvas.maplibregl-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('carte absente');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.mouse.click(box.x + box.width * 0.6, box.y + box.height * 0.5);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Annuler (Ctrl+Z)' })).toBeDisabled();
});

test('le tronçon tracé est sélectionné et se supprime', async ({ page }) => {
  await openMap(page);
  await drawLine(page);
  const del = page.getByRole('button', { name: 'Supprimer la sélection (Suppr)' });
  await expect(del).toBeEnabled();
  await page.keyboard.press('v');
  await page.keyboard.press('Delete');
  await expect(del).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Annuler (Ctrl+Z)' })).toHaveAttribute(
    'title',
    'Annuler : Supprimer',
  );
});

test('le panneau de tracé indique le rayon minimal de la vitesse choisie', async ({ page }) => {
  await openMap(page);
  await page.getByRole('button', { name: 'Tracer une voie (T)' }).click();
  await expect(page.getByText('Rayon minimal : 1 000 m')).toBeVisible();
  await page.getByLabel('Vitesse de conception').selectOption('320');
  await expect(page.getByText('Rayon minimal : 7 000 m')).toBeVisible();
});

test('le profil en long s’ouvre sur le tronçon sélectionné, ou explique son absence', async ({
  page,
}) => {
  await openMap(page);
  const drawer = page.getByRole('region', { name: 'Profil en long' });
  await expect(drawer).toContainText('Sélectionnez un tronçon');
  await drawLine(page);
  // Sans serveur d'altitude (cas de l'intégration continue), le message est explicite.
  await expect(drawer).toContainText('Profil indisponible');
  await page.getByRole('button', { name: 'Masquer le profil en long' }).click();
  await expect(drawer.getByText('Profil indisponible')).toBeHidden();
});
