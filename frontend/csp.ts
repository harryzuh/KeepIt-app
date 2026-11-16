/** Política de segurança de conteúdo (ACH-04), injetada no build por vite.config.ts. */
/**
 * `s3Url` (opcional, produção): URL ou domínio público do bucket de fotos (mesmo valor de `S3_PUBLIC_ENDPOINT` do back-end).
 * Entra em `connect-src` (PUT assinado) e `img-src` (leitura). Em dev as fotos passam pelo proxy `/s3` ('self').
 */
export function montarCsp(apiUrl: string, s3Url = ''): string {
  // URL relativa (ex.: /api pelo proxy do Vite) já é coberta por 'self'.
  const api = apiUrl.startsWith('/') ? '' : new URL(apiUrl).origin;
  const s3 = s3Url ? new URL(s3Url).origin : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    `img-src 'self' data: blob:${s3 ? ` ${s3}` : ''}`,
    `connect-src 'self'${api ? ` ${api}` : ''}${s3 ? ` ${s3}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}
