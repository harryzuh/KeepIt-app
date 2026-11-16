// Gera as imagens de teste do M3 (rode: docker compose --profile e2e run --rm --no-deps e2e node fixtures/gerar.mjs).
// Nada é baixado: o JPEG e o PNG saem de um canvas do Chromium da imagem do Playwright.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const navegador = await chromium.launch();
const pagina = await navegador.newPage();
const [jpeg, png] = await pagina.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#2f6fed';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f5b82e';
  g.fillRect(16, 16, 32, 32);
  return [c.toDataURL('image/jpeg', 0.8), c.toDataURL('image/png')];
});
await navegador.close();
const bytes = (url) => Buffer.from(url.split(',')[1], 'base64');
writeFileSync(join(dir, 'foto-valida.jpg'), bytes(jpeg));
writeFileSync(join(dir, 'foto-valida.png'), bytes(png));
// PNG verdadeiro com extensão .jpg (o tipo real vale, não a extensão: aceito como PNG)
writeFileSync(join(dir, 'png-renomeado.jpg'), bytes(png));
// Texto com extensão .jpg (deve ser recusado: ARQUIVO_INVALIDO)
writeFileSync(join(dir, 'texto.jpg'), 'Isto não é uma imagem, apenas texto com extensão .jpg.\n');
// JPEG válido (cabeçalho real) com mais de 5 MB: 5 MB + 1 KB (recusado por tamanho)
const grande = Buffer.concat([bytes(jpeg), Buffer.alloc(5 * 1024 * 1024 + 1024, 0)]);
writeFileSync(join(dir, 'foto-maior-que-5mb.jpg'), grande);
console.log('fixtures geradas em', dir);
