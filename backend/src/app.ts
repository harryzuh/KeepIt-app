import { createHash, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import './config/zod.js';
import { apagarContasExcluidas, expirarAssinaturas, limparFotosOrfas } from './jobs/index.js';
import { CODIGOS_ERRO } from './lib/http-error.js';
import { errorHandler, rotaNaoEncontrada } from './middlewares/error.js';
import { semCache } from './middlewares/sem-cache.js';
import { limitar } from './middlewares/limitar.js';
import { assinaturaRoutes, pagamentoRoutes, planosRoutes } from './modules/assinatura/assinatura.routes.js';
import { authRoutes, meRoutes } from './modules/auth/auth.routes.js';
import { casaRoutes } from './modules/casa/casa.routes.js';
import { estatisticasRoutes } from './modules/estatisticas/estatisticas.routes.js';
import { produtosRoutes } from './modules/produtos/produtos.routes.js';
import { tagsRoutes } from './modules/tags/tags.routes.js';

export const app = express();

// Atrás do proxy da hospedagem (Render), o IP real vem de X-Forwarded-For (rate limit por IP).
if (env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.use(helmet());
// A API usa Bearer no cabeçalho (sem cookies): `credentials` fica desligado. CORS_ORIGIN aceita lista por vírgula.
app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean) }));
app.use(express.json({ limit: '1mb' }));
// RNF14: limite global; os limites específicos de /auth e /me ficam em middlewares/limitar.ts
app.use(limitar({ janelaMin: 1, max: 120 }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Respostas com dados pessoais ou token nunca ficam em cache (AppSec F15).
app.use(['/auth', '/me'], semCache);
app.use('/auth', authRoutes);
app.use('/me', meRoutes);
app.use('/casa', casaRoutes);
app.use('/produtos', produtosRoutes);
app.use('/tags', tagsRoutes);
app.use('/estatisticas', estatisticasRoutes);
// Contrato m5-assinatura.md: /planos, /pagamento e /assinaturas.
app.use('/planos', planosRoutes);
app.use('/pagamento', pagamentoRoutes);
app.use('/assinaturas', assinaturaRoutes);

/** Compara a chave interna em tempo constante (hash SHA-256 de ambos: buffers de mesmo tamanho). */
function chaveInternaValida(recebida: string | undefined): boolean {
  const hash = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(hash(recebida ?? ''), hash(env.JOBS_TOKEN));
}

// Rotina agendada (GitHub Actions, de hora em hora).
app.post('/internal/jobs', async (req, res) => {
  if (!chaveInternaValida(req.header('x-jobs-token'))) {
    res.status(401).json({ error: CODIGOS_ERRO.NAO_AUTENTICADO, message: 'Chave interna inválida' });
    return;
  }
  // Em ordem (ADR 0002 D6): primeiro expira e renova assinaturas, depois apaga contas.
  const { expiradas, renovadas, falhas } = await expirarAssinaturas();
  const apagadas = await apagarContasExcluidas();
  const { apagadas: fotosOrfasApagadas, pendentes: fotosOrfasPendentes } = await limparFotosOrfas();
  res.json({ expiradas, renovadas, apagadas, falhas, fotosOrfasApagadas, fotosOrfasPendentes });
});

app.use(rotaNaoEncontrada);
app.use(errorHandler);
