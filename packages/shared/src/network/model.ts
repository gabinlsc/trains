import { z } from 'zod';
import { TrackSpecSchema } from '../infrastructure.ts';

/**
 * Modèle de l'infrastructure : un graphe dont les nœuds sont des points
 * remarquables (gares, bifurcations, points de passage) et les arêtes des
 * tronçons de voie. Ce format est persisté (sauvegardes, partage) et validé
 * côté serveur : toute évolution passe par une migration de schéma.
 */

export const LngLatSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
export type Position = z.infer<typeof LngLatSchema>;

/** Identifiants courts, préfixés par le type d'objet (n_…, s_…, l_…). */
export const IdSchema = z.string().regex(/^[a-z]_[0-9a-z]{6,20}$/);
export type Id = z.infer<typeof IdSchema>;

export const StationTypeSchema = z.enum(['halte', 'gare', 'correspondance', 'tgv']);
export type StationType = z.infer<typeof StationTypeSchema>;

export const StationSchema = z.object({
  type: StationTypeSchema,
  platforms: z.number().int().min(1).max(40),
  /** Gare réelle réutilisée (code UIC), sinon gare nouvelle. */
  existingUic: z
    .string()
    .regex(/^\d{8}$/)
    .optional(),
  /** Bâtiment voyageurs en impasse (terminus) plutôt que passant. */
  terminus: z.boolean().default(false),
});
export type Station = z.infer<typeof StationSchema>;

/**
 * waypoint : simple point de passage du tracé ; station : gare ; junction :
 * bifurcation ou raccordement (au moins trois tronçons s'y rejoignent).
 */
export const NodeKindSchema = z.enum(['waypoint', 'station', 'junction']);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const NodeSchema = z.object({
  id: IdSchema,
  kind: NodeKindSchema,
  position: LngLatSchema,
  name: z.string().trim().min(1).max(80).optional(),
  station: StationSchema.optional(),
  /** Saut-de-mouton : croisement dénivelé, sans conflit de circulation. */
  flyover: z.boolean().optional(),
});
export type NetworkNode = z.infer<typeof NodeSchema>;

export const StructureKindSchema = z.enum(['tunnel', 'viaduct', 'bridge']);
export const StructureSchema = z.object({
  kind: StructureKindSchema,
  /** Abscisses curvilignes (m) depuis le nœud de départ. */
  from: z.number().nonnegative(),
  to: z.number().nonnegative(),
  /** Imposé par le joueur plutôt que proposé par le moteur. */
  forced: z.boolean(),
});
export type Structure = z.infer<typeof StructureSchema>;

export const SegmentSchema = z.object({
  id: IdSchema,
  from: IdSchema,
  to: IdSchema,
  /** Points intermédiaires du tracé, extrémités exclues (ce sont les nœuds). */
  via: z.array(LngLatSchema).max(5000),
  spec: TrackSpecSchema,
  structures: z.array(StructureSchema).max(500).default([]),
});
export type Segment = z.infer<typeof SegmentSchema>;

export const NetworkSchema = z
  .object({
    nodes: z.record(IdSchema, NodeSchema),
    segments: z.record(IdSchema, SegmentSchema),
  })
  .superRefine((network, ctx) => {
    for (const [key, node] of Object.entries(network.nodes)) {
      if (node.id !== key)
        ctx.addIssue({ code: 'custom', path: ['nodes', key], message: 'identifiant incohérent' });
      if (node.kind === 'station' && !node.station) {
        ctx.addIssue({
          code: 'custom',
          path: ['nodes', key],
          message: 'gare sans caractéristiques',
        });
      }
    }
    for (const [key, segment] of Object.entries(network.segments)) {
      if (segment.id !== key) {
        ctx.addIssue({
          code: 'custom',
          path: ['segments', key],
          message: 'identifiant incohérent',
        });
      }
      for (const end of ['from', 'to'] as const) {
        if (!network.nodes[segment[end]]) {
          ctx.addIssue({
            code: 'custom',
            path: ['segments', key, end],
            message: 'nœud inexistant',
          });
        }
      }
      if (segment.from === segment.to) {
        ctx.addIssue({
          code: 'custom',
          path: ['segments', key],
          message: 'boucle sur un même nœud',
        });
      }
    }
  });
export type Network = z.infer<typeof NetworkSchema>;

export const EMPTY_NETWORK: Network = { nodes: {}, segments: {} };
