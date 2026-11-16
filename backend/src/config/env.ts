import 'dotenv/config';
import { z } from 'zod';

/** Prefixo dos valores de exemplo do `.env.example` (nunca podem ir para produção). */
const PREFIXO_VALOR_DE_EXEMPLO = 'troque';
const segredoSchema = z.string().min(32, 'Use um segredo com no mínimo 32 caracteres');

export const envSchema = z
  .object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3333),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: segredoSchema,
  /** Chave dedicada do HMAC dos códigos de verificação (em dev, derivada do JWT_SECRET se ausente). */
  CODIGO_SECRET: segredoSchema.optional(),
  JWT_EXPIRES_IN: z.string().default('8h'),
  /** Origens permitidas no CORS, separadas por vírgula. */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** Desliga os limites de requisição (E2E/dev). Recusado em produção. */
  RATE_LIMIT_DESLIGADO: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /**
   * Gateway de pagamento SIMULADO (ADR 0002 D5): aprova por padrão e só aceita cartões de teste.
   * Recusado em produção (use `false` quando houver gateway real; sem ele, as cobranças respondem 503).
   */
  PAGAMENTO_SIMULADO: z
    .enum(['true', 'false', '1', '0'])
    .default('true')
    .transform((v) => v === 'true' || v === '1'),
  JOBS_TOKEN: segredoSchema,
  S3_ENDPOINT: z.string().url().optional(),
  /**
   * Endpoint usado SÓ para assinar as URLs entregues ao navegador (ADR 0003 D3). Se ausente, assina para o
   * `S3_ENDPOINT`. Em dev fica ausente (o proxy /s3 do Vite chega ao host interno `s3:9000`); em produção (R2)
   * pode ser o domínio público do bucket. Operações do backend (HEAD, GET, DELETE) sempre usam `S3_ENDPOINT`.
   */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  /** Validade das URLs assinadas de ENVIO, em segundos (padrão 300 = 5 minutos, Figura 26). */
  S3_UPLOAD_URL_TTL_S: z.coerce.number().int().min(30).max(900).default(300),
  /**
   * Validade das URLs assinadas de LEITURA das fotos, em segundos (padrão 900 = 15 min; AppSec FD6). Valores maiores
   * (ex.: 3600 de um .env antigo) são reduzidos a 900.
   */
  S3_READ_URL_TTL_S: z.coerce
    .number()
    .int()
    .min(60)
    .default(900)
    .transform((v) => Math.min(v, 900)),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string(),
  S3_ACCESS_KEY_ID: z.string(),
  S3_SECRET_ACCESS_KEY: z.string(),
  MAIL_FROM: z.string().default('KeepIT <no-reply@keepit.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  RESEND_API_KEY: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV !== 'production') return;
    const erro = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    for (const campo of ['JWT_SECRET', 'JOBS_TOKEN', 'CODIGO_SECRET'] as const) {
      if (v[campo]?.toLowerCase().startsWith(PREFIXO_VALOR_DE_EXEMPLO)) {
        erro(campo, 'Em produção não use o valor de exemplo do .env.example');
      }
    }
    if (!v.CODIGO_SECRET) erro('CODIGO_SECRET', 'Obrigatório em produção (chave própria dos códigos)');
    else if (v.CODIGO_SECRET === v.JWT_SECRET) erro('CODIGO_SECRET', 'Deve ser diferente do JWT_SECRET');
    if (v.PAGAMENTO_SIMULADO) {
      erro('PAGAMENTO_SIMULADO', 'O gateway simulado não pode ser usado em produção (defina PAGAMENTO_SIMULADO=false)');
    }
    if (v.RATE_LIMIT_DESLIGADO) erro('RATE_LIMIT_DESLIGADO', 'Não pode ser desligado em produção');
  });

export const env = envSchema.parse(process.env);
