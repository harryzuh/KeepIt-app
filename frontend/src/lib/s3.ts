/**
 * URLs assinadas do S3 em dev (docs/api/m3-produtos.md, seção 6): a assinatura inclui o host, e o navegador não alcança `s3:9000`.
 * Com `VITE_S3_PROXY` definida (ex.: "/s3"), a origem da URL é trocada pelo prefixo do proxy do Vite. Em produção não se define.
 */
export function urlDoS3(url: string): string {
  const proxy = import.meta.env.VITE_S3_PROXY;
  if (!proxy) return url;
  try {
    const u = new URL(url);
    return `${proxy}${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}
