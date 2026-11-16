# KeepIT — Deploy em produção

Guia para colocar o KeepIT no ar usando os planos gratuitos. Escrito para uma pessoa seguir no navegador e para
um agente conferir. O ambiente local continua em [SETUP.md](SETUP.md).

| Peça | Serviço | Plano | Observação |
|---|---|---|---|
| Banco | Neon (PostgreSQL) | Free | — |
| Fotos | Cloudflare R2 | Free (10 GB/mês) | pede cartão cadastrado para criar o bucket |
| E-mail | Resend | Free | precisa de um **domínio próprio** para enviar a qualquer pessoa |
| API | Render | Free | dorme após 15 min sem acesso; o primeiro acesso depois leva ~1 min |
| Front | Vercel | Hobby | gratuito só para uso não comercial |
| Rotinas | GitHub Actions | Free | `.github/workflows/jobs.yml`, de hora em hora |

**Ordem:** Neon → R2 → Resend → Render → Vercel → volta ao Render (CORS) → GitHub → conferência.
Cada serviço precisa da URL do anterior, por isso a ordem importa.

> Regras: segredos só nos painéis dos serviços, nunca no repositório. Pagamento fica **desativado** em produção
> (`PAGAMENTO_SIMULADO=false`, decisão 64 do `docs/historias/STATUS.md`): a tela de planos aparece com os botões cinza.

---

## 1. Antes de começar

- Repositório no GitHub com a `main` atualizada (`git push`). Render e Vercel fazem deploy a partir dela.
- Conta no GitHub para entrar nos serviços com "Sign in with GitHub" (Render, Vercel, Neon).
- Um bloco de notas **local e privado** para guardar as URLs e chaves durante o processo. Apague ao final.

---

## 2. Neon (banco)

1. Crie a conta em neon.tech → **New project**.
   - Nome: `keepit` · Postgres 17 · região mais próxima do Render (ex.: *AWS US East* se o Render ficar em *Ohio* ou *Virginia*; *São Paulo* se disponível nos dois).
2. Em **Connection Details** (ou **Connect**):
   - Banco `neondb` (ou crie `keepit`), usuário dono do projeto.
   - **Desligue "Connection pooling"** para copiar a URL **direta** (sem `-pooler` no host). O Prisma precisa dela para rodar as migrations.
   - Copie a URL. Ela tem a forma `postgresql://usuario:senha@ep-xxxx.região.aws.neon.tech/neondb?sslmode=require`.
3. Guarde como **`DATABASE_URL`**.

As tabelas são criadas pelo próprio Render no primeiro deploy (`prisma migrate deploy`). Não rode o seed em produção:
ele cria o usuário demo de senha conhecida e se recusa a fazer isso com `NODE_ENV=production`.

Backup: o Free do Neon guarda um histórico curto de restauração (*point-in-time restore*). Para backup diário fora do
Neon (RNF23), veja a seção 9.

---

## 3. Cloudflare R2 (fotos)

1. Crie a conta em cloudflare.com → menu **R2 Object Storage**. Cadastre o cartão quando pedido (não há cobrança
   dentro do limite gratuito).
2. **Create bucket**:
   - Nome: `keepit-fotos` · Location: *Automatic* · Storage class: **Standard** (o gratuito não vale para *Infrequent Access*).
   - **Não** ative *Public access*, nem *r2.dev*, nem domínio personalizado. O bucket fica privado e todo acesso é por
     URL assinada, que no R2 **só funciona no domínio da API S3** (não em domínio próprio).
3. Na página do R2, copie o **Account ID**. O endpoint é `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
   Guarde como **`S3_ENDPOINT`**.
4. **Manage R2 API Tokens → Create API token**:
   - Permissão: **Object Read & Write** · Escopo: **apenas o bucket `keepit-fotos`** · sem expiração (ou anote a data).
   - Copie **Access Key ID** e **Secret Access Key** (o segredo só aparece uma vez).
   - Guarde como **`S3_ACCESS_KEY_ID`** e **`S3_SECRET_ACCESS_KEY`**.
5. **CORS do bucket** (bucket → *Settings* → *CORS policy* → *Edit*). Cole, trocando a origem pelo domínio da Vercel
   (você o terá na seção 6; volte aqui depois):

   ```json
   [
     {
       "AllowedOrigins": ["https://SEU-APP.vercel.app"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["content-type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   Uma única origem, sempre `https://`, nunca `*` (mesmo conteúdo de `infra/s3/cors.prod.json`).
6. **Object lifecycle rules** (*Settings*): adicione *Abort incomplete multipart uploads* após 1 dia
   (equivalente a `infra/s3/lifecycle.json`). Não crie regra que apague por idade o prefixo `casas/`.

---

## 4. Resend (e-mail)

Os e-mails do KeepIT são os códigos de verificação, recuperação de senha e troca de e-mail. Sem eles o cadastro de
novos usuários não fecha.

1. Crie a conta em resend.com.
2. **Domínio (obrigatório para enviar a qualquer pessoa):** *Domains → Add domain* (ex.: `keepit.com.br` ou
   `mail.seudominio.com`). Adicione no DNS do domínio os registros que o Resend mostrar (SPF, DKIM e, se pedido, MX)
   e espere o status **Verified**.
   - Sem domínio verificado, o Resend só entrega para o e-mail da própria conta. Serve para um teste rápido, não para usuários.
   - Se o domínio já estiver na Cloudflare, o Resend adiciona os registros automaticamente.
3. *API Keys → Create API key*: permissão **Sending access**, restrita ao domínio. Guarde como **`RESEND_API_KEY`**.
4. Defina o remetente, num endereço do domínio verificado. Guarde como **`MAIL_FROM`**, ex.: `KeepIT <no-reply@keepit.com.br>`.

---

## 5. Render (API)

O repositório já tem o [render.yaml](render.yaml) (Blueprint) e o `backend/Dockerfile`, cujo estágio final roda
`prisma migrate deploy` e depois a API.

1. Crie a conta em render.com com o GitHub e autorize o acesso ao repositório.
2. **New → Blueprint** → escolha o repositório → o Render lê o `render.yaml` e mostra o serviço `keepit-api`.
3. Preencha os valores pedidos (`sync: false`):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | URL direta do Neon (seção 2) |
   | `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
   | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | token do R2 |
   | `RESEND_API_KEY` / `MAIL_FROM` | seção 4 |
   | `CORS_ORIGIN` | por enquanto `https://example.com`; troque na seção 6.4 |

   `JWT_SECRET`, `CODIGO_SECRET` e `JOBS_TOKEN` são gerados pelo Render. **Não** defina `S3_PUBLIC_ENDPOINT`
   (no R2 a assinatura tem de ser no próprio endpoint S3) nem `SMTP_HOST`.
4. **Apply**. O primeiro build leva alguns minutos. Acompanhe em *Logs*:
   - deve aparecer `All migrations have been successfully applied` (ou equivalente) e `KeepIT API ouvindo em ...`;
   - se aparecer erro de variável, a API recusou iniciar de propósito (ex.: segredo curto ou `PAGAMENTO_SIMULADO=true`). Corrija em *Environment* e faça *Manual Deploy*.
5. Copie a URL do serviço, ex.: `https://keepit-api.onrender.com`. Guarde como **`API_URL`**.
6. Teste: abra `https://keepit-api.onrender.com/health` no navegador. Deve responder OK.
7. Em *Environment*, copie o valor de **`JOBS_TOKEN`** (usado na seção 7).

Sem Blueprint (manual): *New → Web Service* → repositório → *Language: Docker* · *Root Directory:* `backend` ·
*Dockerfile Path:* `./Dockerfile` · *Health Check Path:* `/health` · *Instance type:* Free · e as mesmas variáveis do
`render.yaml`, gerando os três segredos com `openssl rand -base64 48`.

---

## 6. Vercel (front)

1. Crie a conta em vercel.com com o GitHub → **Add New → Project** → importe o repositório.
2. Configuração:
   - **Root Directory:** `frontend` · **Framework Preset:** Vite (detectado) · Build `npm run build` · Output `dist`.
   - O `frontend/vercel.json` já faz o roteamento da SPA e envia os cabeçalhos de segurança.
3. **Environment Variables** (Production). Elas entram **no build**: mudou, tem de fazer *Redeploy*.

   | Variável | Valor |
   |---|---|
   | `VITE_API_URL` | `https://keepit-api.onrender.com` (sem barra no final) |
   | `VITE_S3_PUBLIC_URL` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` (libera as fotos na CSP) |

   **Não** defina `VITE_S3_PROXY`, `VITE_S3_PROXY_TARGET` nem `VITE_PROXY_TARGET`: são só de dev e quebrariam as URLs assinadas.
4. **Deploy** e copie o domínio, ex.: `https://keepit.vercel.app`.
5. Volte ao **Render** → *Environment* → `CORS_ORIGIN` = esse domínio (sem barra no final) → salvar (redeploy automático).
6. Volte ao **R2** e ponha o mesmo domínio no CORS do bucket (seção 3, passo 5).

Domínio próprio (opcional): *Project → Settings → Domains*. Se usar, ele passa a ser a origem em `CORS_ORIGIN` e no
CORS do R2 (pode listar os dois no `CORS_ORIGIN`, separados por vírgula; no R2, os dois em `AllowedOrigins`).

---

## 7. GitHub (rotinas de hora em hora)

O workflow `.github/workflows/jobs.yml` chama `POST /internal/jobs` a cada hora: expira e renova assinaturas, apaga
contas excluídas (prazo de 24 h, RNF16) e limpa fotos órfãs.

1. Repositório → *Settings → Secrets and variables → Actions → New repository secret*:
   - `API_URL` = `https://keepit-api.onrender.com`
   - `JOBS_TOKEN` = o valor copiado do Render
2. *Actions → Rotinas agendadas → Run workflow* para testar na hora. Deve terminar verde.

No Render Free a chamada de hora em hora também acorda a API; o workflow espera o despertar (~1 min).

---

## 8. Conferência final

Faça no domínio da Vercel, numa janela anônima:

- [ ] Cadastro com um e-mail seu → o código chega (Resend) → a Casa Individual é criada.
- [ ] Login, logout e recuperação de senha.
- [ ] Cadastrar produto com tag e **foto** → a foto aparece no detalhe (R2 + CORS + CSP).
- [ ] Produto duplicado mostra as 3 opções.
- [ ] Tela de **Planos** mostra o aviso e os botões **Assinar** cinza.
- [ ] Tela Início e Estatísticas com os números certos.
- [ ] Console do navegador sem erro de CSP ou CORS.
- [ ] `Run workflow` das rotinas termina verde.
- [ ] Teste do tamanho assinado no R2 (risco R-M3-1), rodado **dentro de um container**, nunca no host:
      gere uma URL de envio pela API e rode `URL_ASSINADA=... TAMANHO=... node infra/s3/validar-content-length.mjs`.

Problemas comuns:

| Sintoma | Causa provável |
|---|---|
| Erro de CORS ao chamar a API | `CORS_ORIGIN` diferente do domínio da Vercel (barra no final, http em vez de https) |
| Foto não sobe (erro no PUT) | CORS do bucket R2 sem o domínio, ou `S3_ENDPOINT` errado |
| Foto não aparece, erro de CSP no console | `VITE_S3_PUBLIC_URL` ausente no build; ajuste e faça *Redeploy* |
| E-mail não chega | domínio não verificado no Resend, ou `MAIL_FROM` fora do domínio |
| API não inicia | variável recusada pela validação; veja *Logs* no Render |
| Primeiro acesso demora ~1 min | Render Free acordando; é esperado |

---

## 9. Pendências conhecidas antes de abrir para o público

- **Backup diário fora do Neon** (RNF23): ainda não automatizado. Opção simples: workflow agendado com `pg_dump` para
  um bucket separado. É tarefa do DevOps.
- **Monitoramento** (RNF28): ainda não configurado. Um verificador de disponibilidade apontando para `/health` resolve.
- **`nosniff` nas fotos:** o domínio S3 do R2 não aceita regras de cabeçalho. Fica aceito porque toda foto é
  recodificada no servidor (sempre JPEG ou PNG válido).
- **Envios pendentes:** desde a correção do FD1 os envios ficam em `casas/<id>/pendentes/`. Como o prefixo varia por
  Casa, uma regra de ciclo de vida do R2 (que filtra só pelo início da chave) não consegue apagá-los; quem limpa é o
  job de órfãs. A seção 9 do SETUP.md ainda descreve o modelo antigo e precisa ser atualizada.
- Lista completa de riscos e decisões: `docs/historias/sprint-4-relatorio.md` e `docs/historias/STATUS.md`.
