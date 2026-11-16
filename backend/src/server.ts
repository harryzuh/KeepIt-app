import { app } from './app.js';
import { env } from './config/env.js';

const server = app.listen(env.PORT, () => {
  console.log(`KeepIT API ouvindo em http://localhost:${env.PORT}`);
});

// O padrão do Node fecha conexões ociosas em 5 s. Um cliente que reaproveita a conexão nesse instante
// (Playwright, o balanceador do Render) recebe ECONNRESET. O tempo do servidor precisa ser maior que o
// do cliente/proxy; headersTimeout tem de ficar acima de keepAliveTimeout.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
