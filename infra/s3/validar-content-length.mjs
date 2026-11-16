// Valida (R-M3-1) se o S3/R2 rejeita um PUT assinado cujo corpo tem tamanho diferente do assinado.
// Uso: URL_ASSINADA="<url de POST /produtos/fotos/upload-url, tamanhoBytes = N>" TAMANHO=N node infra/s3/validar-content-length.mjs
// Em dev troque a origem da URL por http://localhost:5173/s3 (ver SETUP.md). Cada URL só deve ser usada uma vez por teste:
// o script usa a URL só no PUT de tamanho errado (deve falhar). Passe URL_ASSINADA_OK para também checar o envio correto.
const { URL_ASSINADA, URL_ASSINADA_OK, TAMANHO } = process.env;
if (!URL_ASSINADA || !TAMANHO) {
  console.error('Defina URL_ASSINADA e TAMANHO.');
  process.exit(2);
}
const n = Number(TAMANHO);
const png = Buffer.alloc(n + 7, 1);
const r = await fetch(URL_ASSINADA, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: png });
const rejeitou = r.status >= 400;
console.log(`PUT com ${png.length} bytes (assinado ${n}): HTTP ${r.status} -> ${rejeitou ? 'REJEITADO (ok)' : 'ACEITO (risco R-M3-1 confirmado)'}`);
if (URL_ASSINADA_OK) {
  const ok = await fetch(URL_ASSINADA_OK, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(n, 1) });
  console.log(`PUT com ${n} bytes: HTTP ${ok.status}`);
  if (!ok.ok) process.exit(1);
}
process.exit(rejeitou ? 0 : 1);
