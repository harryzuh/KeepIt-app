import { defineConfig, devices } from '@playwright/test';

/**
 * Configuração dos testes E2E do KeepIT.
 * - Fora do compose: E2E_BASE_URL padrão http://localhost:5173.
 * - Dentro do compose (serviço "e2e"): http://frontend:5173 e API em http://backend:3333.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Desktop: todos os specs, exceto os de responsividade móvel (*.mobile.spec.ts).
    { name: 'chromium', testIgnore: /\.mobile\.spec\.ts$/, use: { ...devices['Desktop Chrome'] } },
    // Mobile 360x800 (RNF10): roda só os specs *.mobile.spec.ts, escritos pelo QA.
    {
      name: 'mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices['Pixel 7'], viewport: { width: 360, height: 800 } },
    },
  ],
});
