/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { montarCsp } from './csp';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Injeta a CSP (ACH-04) só no build: o dev server do Vite precisa de script inline (React Refresh).
 * Scripts só do próprio domínio (sem unsafe-inline/unsafe-eval); connect-src só para a API.
 */

export function cspPlugin(apiUrl: string, s3Url = ''): Plugin {
  const politica = montarCsp(apiUrl, s3Url);
  return {
    name: 'keepit-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: politica }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiUrl = env.VITE_API_URL || 'http://localhost:3333';
  return {
  plugins: [react(), tailwindcss(), cspPlugin(apiUrl, env.VITE_S3_PUBLIC_URL)],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    watch: { usePolling: true },
    // Em dev o front chama /api no próprio Vite, que repassa à API (sem CORS e funcionando
    // tanto no navegador do host quanto no container e2e). Ver SETUP.md.
    proxy: {
      '/api': {
        target: env.VITE_PROXY_TARGET || 'http://localhost:3333',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
      // URLs assinadas do S3 (ADR 0003 D3): a assinatura inclui o Host, e o backend assina para `s3:9000`.
      // O front troca a origem da URL por `/s3` e o Vite repassa ao S3 com o Host reescrito (changeOrigin),
      // o que funciona no navegador do host (localhost:5173) e no do container e2e (frontend:5173).
      '/s3': {
        target: env.VITE_S3_PROXY_TARGET || 'http://localhost:9000',
        changeOrigin: true,
        rewrite: (caminho) => caminho.replace(/^\/s3/, ''),
        // Objeto enviado pelo usuário nunca pode ser reinterpretado pelo navegador (FD6/FD8): força nosniff na borda.
        // Em produção o mesmo cabeçalho vem do domínio do bucket (SETUP.md, seção 9).
        configure: (proxy) => {
          proxy.on('proxyRes', (resposta) => {
            resposta.headers['x-content-type-options'] = 'nosniff';
          });
        },
      },
    },
  },
  test: { globals: true, environment: 'jsdom', setupFiles: ['./src/test/setup.ts'] },
  };
});
