import { describe, expect, it } from 'vitest';
import { addNode, addSegment } from './network/ops.ts';
import { EMPTY_NETWORK, type Network } from './network/model.ts';
import {
  createSave,
  parseSave,
  SAVE_FORMAT,
  SAVE_VERSION,
  SaveError,
  serializeSave,
  type SaveMigration,
} from './save.ts';

function network(): Network {
  let n = EMPTY_NETWORK;
  n = addNode(n, [2.35, 48.85], {
    id: 'n_paris1',
    name: 'Paris',
    station: { type: 'tgv', platforms: 8, terminus: true },
  }).network;
  n = addNode(n, [4.83, 45.76], { id: 'n_lyon01' }).network;
  return addSegment(n, 'n_paris1', 'n_lyon01', { id: 's_ligne1', via: [[3.5, 47.3]] }).network;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof SaveError) return error.code;
    throw error;
  }
  return undefined;
}

describe('sauvegardes', () => {
  it('relit à l’identique ce qu’elle écrit', () => {
    const save = createSave('  Ma ligne  ', network(), new Date('2026-11-17T10:00:00Z'));
    expect(save).toMatchObject({ name: 'Ma ligne', version: SAVE_VERSION, format: SAVE_FORMAT });
    expect(parseSave(serializeSave(save))).toEqual(save);
  });

  it('nomme une partie sans titre', () => {
    expect(createSave('   ', EMPTY_NETWORK).name).toBe('Sans titre');
  });

  it('refuse les fichiers illisibles, étrangers, futurs ou incohérents', () => {
    expect(codeOf(() => parseSave('{'))).toBe('json');
    expect(codeOf(() => parseSave('[]'))).toBe('format');
    expect(codeOf(() => parseSave('{"type":"FeatureCollection"}'))).toBe('format');
    const save = createSave('x', network());
    expect(codeOf(() => parseSave(JSON.stringify({ ...save, version: 99 })))).toBe('future');
    const broken = structuredClone(save);
    const segment = broken.network.segments.s_ligne1;
    if (!segment) throw new Error('tronçon attendu');
    broken.network.segments.s_ligne1 = { ...segment, to: 'n_absent1' };
    expect(codeOf(() => parseSave(JSON.stringify(broken)))).toBe('invalid');
    expect(() => parseSave(JSON.stringify(broken))).toThrow(/network\.segments/);
  });

  it('applique les migrations successives des anciennes versions', () => {
    const save = createSave('Ancienne', network(), new Date('2026-01-01T00:00:00Z'));
    // Forme imaginaire d'une version 0 : le nom s'appelait « title ».
    const { name, ...rest } = save;
    const v0 = { ...rest, version: 0, title: name };
    const migrations: Record<number, SaveMigration> = {
      0: ({ title, ...raw }) => ({ ...raw, name: title }),
    };
    expect(parseSave(JSON.stringify(v0), migrations)).toEqual(save);
    expect(codeOf(() => parseSave(JSON.stringify(v0)))).toBe('invalid');
  });
});
