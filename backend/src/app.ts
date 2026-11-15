import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env.js';
import { apagarContasExcluidas, expirarAssinaturas } from './jobs/index.js';
import { errorHandler } from './middlewares/error.js';
import { assinaturaRoutes } from './modules/assinatura/assinatura.routes.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { casaRoutes } from './modules/casa/casa.routes.js';
import { estatisticasRoutes } from './modules/estatisticas/estatisticas.routes.js';
import { produtosRoutes } from './modules/produtos/produtos.routes.js';

export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit({ windowMs: 60_000, limit: 120 })); // RNF14

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/auth', authRoutes);
app.use('/casa', casaRoutes);
app.use('/produtos', produtosRoutes);
app.use('/estatisticas', estatisticasRoutes);
app.use('/assinatura', assinaturaRoutes);

app.post('/jobs/run', async (req, res) => {
  if (req.header('x-jobs-token') !== env.JOBS_TOKEN) {
    res.status(401).end();
    return;
  }
  const [expiradas, apagadas] = await Promise.all([expirarAssinaturas(), apagarContasExcluidas()]);
  res.json({ expiradas, apagadas });
});

app.use(errorHandler);
