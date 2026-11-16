import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3070),
    PUBLIC_URL: z.url().default('http://localhost:5173'),
    SESSION_SECRET: z.string().default(''),
    DATABASE_PATH: z.string().min(1).default('./.local/trains.sqlite'),
    DATA_DIR: z.string().min(1).default('./.local/data'),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  })
  .superRefine((env, ctx) => {
    // En production, un secret faible rendrait les sessions falsifiables :
    // mieux vaut refuser de démarrer.
    if (env.NODE_ENV === 'production' && env.SESSION_SECRET.length < 32) {
      ctx.addIssue({
        code: 'custom',
        path: ['SESSION_SECRET'],
        message: 'SESSION_SECRET doit faire au moins 32 caractères en production',
      });
    }
  });

export type Config = z.infer<typeof EnvSchema>;

/** Lit et valide la configuration ; lève une erreur lisible si elle est invalide. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide :\n${details}`);
  }
  return parsed.data;
}
