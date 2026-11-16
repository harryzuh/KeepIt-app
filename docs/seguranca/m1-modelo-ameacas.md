# Modelo de ameaças — M1 Autenticação e Conta

- **Autor:** Engenheiro de Segurança e Privacidade (AppSec / LGPD)
- **Data:** 2026-11-15
- **Escopo:** cadastro, login, recuperação de senha, troca de e-mail, alteração de senha, encerramento de sessão, exclusão de conta, JWT, e-mails transacionais, rotina `/internal/jobs`.
- **Base lida:** `docs/api/m1-auth.md`, `docs/adr/0001-base-m1.md`, `AGENTS.md` (papel 7), requisitos RF01/02/17–21/30/31, RNF04/05/11/14/15/16/25.
- **Uso:** este documento é o insumo da revisão de código do M1. A seção 7 é o checklist que será marcado na próxima etapa. Status das falhas de contrato na seção 6 deve ser decidido por Arquiteto/PO antes (ou durante) a implementação.

Regra do papel: AppSec não bloqueia entrega por item de backlog; registra o risco e leva ao PO. Itens marcados **[BLOQUEANTE]** na seção 7 são os que considero inaceitáveis mesmo para MVP (tomada de conta, vazamento de credencial); os demais podem virar backlog com aceite formal do PO.

---

## 1. Ativos

| # | Ativo | Onde vive | Por que importa |
|---|---|---|---|
| A1 | Credenciais (hash bcrypt de senha) | `usuario.senha_hash` | Vazamento permite ataque offline e reuso em outros serviços |
| A2 | Sessão (JWT HS256, 8 h) | `localStorage` `keepit.token`; `JWT_SECRET` no servidor | Quem tem o token é o usuário |
| A3 | Códigos de verificação (6 dígitos) | `codigo_verificacao` (HMAC) e caixa de e-mail | Chave de redefinição de senha e de troca de e-mail = tomada de conta |
| A4 | Dados pessoais: nome, e-mail, data de cadastro, IP/UA se logados | `usuario`, logs, e-mail provider | LGPD (art. 6 minimização, art. 18 direitos do titular) |
| A5 | Vínculo Casa/papel (`casaId`, ADMIN/EDITOR/LEITOR) | `usuario_casa` | Isolamento entre Casas (RNF31) e base da autorização do M2+ |
| A6 | Segredos: `JWT_SECRET`, `JOBS_TOKEN`, `RESEND_API_KEY`, `DATABASE_URL` | env (Render, GitHub Actions) | Comprometimento = falsificar qualquer sessão ou apagar contas |
| A7 | Log de auditoria | `log_auditoria` | Evidência (RNF05); não pode virar depósito de dado pessoal |
| A8 | Disponibilidade do login e do envio de e-mail | API, Resend/SMTP | Bloqueio de conta e esgotamento de cota de e-mail |

## 2. Atores

| Ator | Capacidade assumida |
|---|---|
| Visitante anônimo | Acessa rotas públicas, pode automatizar requisições, trocar de IP |
| Atacante com lista de credenciais vazadas | Credential stuffing contra `/auth/login` |
| Atacante que conhece o e-mail da vítima | Aciona recuperação de senha, tenta adivinhar código de 6 dígitos |
| Atacante com XSS no front (ou dependência npm comprometida) | Lê `localStorage`, chama a API como o usuário |
| Atacante com token roubado (log, Wi-Fi sem TLS, malware) | Usa a sessão por até 8 h |
| Usuário autenticado malicioso (LEITOR/EDITOR) | Tenta escalar papel ou acessar outra Casa |
| Insider/operador | Acesso a logs, banco, painel do e-mail provider |
| Atacante com acesso a dump do banco | Tenta quebrar hashes de senha e de código |
| Terceiro que descobre `JOBS_TOKEN` | Dispara a rotina de exclusão |

## 3. Superfícies de ataque

| Superfície | Rotas / componentes | Entradas não confiáveis |
|---|---|---|
| Cadastro | `POST /auth/cadastro` | nome, e-mail, senha |
| Login | `POST /auth/login` | e-mail, senha |
| Recuperação de senha | `POST /auth/recuperar-senha`, `POST /auth/redefinir-senha` | e-mail, código |
| Troca de e-mail | `POST /me/email`, `POST /me/email/confirmar` | e-mail novo, código |
| Alteração de senha / exclusão | `PATCH /me/senha`, `DELETE /me` | senhas |
| JWT e sessão | `lib/jwt.ts`, `middlewares/autenticar.ts`, `localStorage` | header `Authorization` |
| E-mails | `lib/mailer.ts` (Resend/SMTP) | nome do usuário interpolado no corpo |
| Rotinas | `POST /internal/jobs` e alias `/jobs/run` | header `x-jobs-token` |
| Infra HTTP | `app.ts` (helmet, CORS, rate limit, trust proxy, body parser) | cabeçalhos, IP, JSON |
| Front | `src/lib/` cliente HTTP, guardas de rota, telas 01–05/16/18–21 | respostas da API renderizadas |

---

## 4. Ameaças STRIDE, mitigação esperada e onde no código

Convenção de local: `B:` = backend (`backend/src/...`), `F:` = frontend (`frontend/src/...`), `D:` = devops/config.

### 4.1 Cadastro (UC008, RF02, RF32)

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| C1 | S/I | Enumeração de contas via `409 EMAIL_EM_USO` | Inevitável em cadastro com e-mail único; limitar (10/h/IP) e aceitar o risco formalmente. Alternativa forte: resposta 201 genérica + e-mail "já tem conta" (fora do escopo do MVP) | B: `modules/auth/auth.service.ts`, `middlewares/limitar.ts` |
| C2 | T | Mass assignment (`papel`, `casaId`, `id` no corpo) | Zod com schema explícito e `.strict()` ou desestruturação só dos 4 campos; papel sempre `ADMIN` fixo no service | B: `auth.schema.ts`, `auth.service.ts` |
| C3 | T | Cadastro parcial (usuário sem Casa) | `prisma.$transaction` única: usuário + Casa + vínculo; falha derruba tudo | B: `auth.service.ts` |
| C4 | I | Senha > 72 **bytes** truncada pelo bcrypt (caracteres multibyte passam no limite de 72 caracteres do Zod) | Validar `Buffer.byteLength(senha) <= 72` | B: `lib/campos.ts` `senhaSchema` |
| C5 | I | Hash fraco ou custo baixo | bcrypt, custo >= 10 (ideal 12), constante nomeada; nunca logar senha | B: `lib/senha.ts` |
| C6 | T | HTML/script em `nome` (vira nome da Casa, aparece em e-mail e telas) | Rejeitar/neutralizar `<` e `>`; escapar no e-mail HTML; React escapa na tela (proibido `dangerouslySetInnerHTML`) | B: `lib/campos.ts` `nomeSchema`, `lib/mailer.ts`; F: telas |
| C7 | R | Sem prova de ciência dos termos | Registrar versão dos termos exibida no cadastro (ver LGPD, seção 5) | B/Arquiteto |
| C8 | I | Token emitido recusado no primeiro uso por relógio | `sessoesValidasDesde: new Date()` explícito (já decidido) | B: `auth.service.ts` |

### 4.2 Login (UC004, UC005, RF01)

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| L1 | S | Credential stuffing | Limite por IP+e-mail **e** limite por IP isolado (atacante testa muitos e-mails do mesmo IP); alerta/log de falhas | B: `limitar.ts` preset `login` |
| L2 | I | Enumeração por mensagem ou por tempo | Mesma resposta `CREDENCIAIS_INVALIDAS` para e-mail inexistente, senha errada e exclusão solicitada; bcrypt contra hash falso quando não há usuário (já em `conferirSenha`) | B: `auth.service.ts`, `lib/senha.ts` |
| L3 | D | Bloqueio de vítima por terceiro | Limite por IP+e-mail só afeta o IP do atacante (aceitável); não bloquear conta globalmente | B: `limitar.ts` |
| L4 | S | Limite burlado por `X-Forwarded-For` forjado | `trust proxy` = 1 apenas em produção atrás da Render; em dev/test não confiar no header | B: `app.ts` |
| L5 | I | Resposta cacheada contendo perfil/token | `Cache-Control: no-store` em `/auth/*` e `/me*` | B: `app.ts` ou router |
| L6 | R | Falhas e sucessos sem rastro | Auditar `LOGIN_FALHA` (sem senha, e-mail só se necessário, IP truncado) e `LOGIN_OK` | B: `lib/auditoria.ts` |

### 4.3 Recuperação de senha (UC006, UC007, UC009, RF17)

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| R1 | I | Enumeração de contas: `404 CONTA_NAO_ENCONTRADA` (contrato 3.3) | Recomendado: 200 idêntico exista ou não a conta (decisão PO, ver falha F1). Se mantido o 404: limite por IP agressivo + alerta | B: `auth.service.ts` |
| R2 | E | **Força bruta do código de 6 dígitos**: limite é "10 falhas/15 min por IP+e-mail"; botnet com N IPs testa 10N códigos por janela (1.000 IPs = 1% por janela, e a janela se repete a cada 15 min enquanto o código vive) | Contador de falhas **por usuário/código independente do IP**; invalidar o código após 5 tentativas erradas. Exige coluna `tentativas` (ver F2) ou contador persistente | B: `auth.service.ts`, `limitar.ts`; Arquiteto: schema |
| R3 | I | Código em texto claro no banco | HMAC-SHA256 com chave própria (ver R8), comparação com `timingSafeEqual` | B: `lib/codigo.ts` |
| R4 | D | Mail bombing: atacante rotaciona IP e enche a caixa da vítima / esgota cota do Resend | Limite por e-mail **independente do IP** (ex.: 3 por 15 min por conta), e cota global de envio por hora | B: `limitar.ts` `pedirCodigo` |
| R5 | E | Código reutilizável / múltiplos códigos válidos | Uso único (`usadoEm`), pedidos anteriores invalidados ao gerar novo, expiração 15 min verificada no servidor | B: `auth.service.ts` |
| R6 | E | Sessões roubadas sobrevivem à redefinição | `sessoesValidasDesde = new Date()` na redefinição (já decidido). Também invalidar códigos `ALTERAR_EMAIL` pendentes | B: `auth.service.ts` |
| R7 | I | Diferença de tempo e de efeito colateral entre e-mail existente e inexistente (com e sem envio de e-mail síncrono) | Envio assíncrono (não aguardar o provedor) e mesmo caminho de custo | B: `auth.service.ts`, `lib/mailer.ts` |
| R8 | I | Mesma chave (`JWT_SECRET`) para JWT e para HMAC dos códigos: vazar/rotacionar um afeta o outro | Derivar chave separada (`CODIGO_HMAC_SECRET` ou HKDF com rótulo) | B: `lib/codigo.ts`, `config/env.ts` |
| R9 | I | Link/código vaza por e-mail com `nome` não escapado ou por log | E-mail só com código, validade e aviso "não foi você"; nunca logar o código (nem `caixaDeSaida` em produção) | B: `lib/mailer.ts` |
| R10 | S | Redefinição seguida de login automático | Contrato já proíbe (204, sem token). Manter | B |

### 4.4 Troca de e-mail (RF19), alteração de senha (RF31) e exclusão (RF20)

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| E1 | E | **Tomada de conta com token roubado**: `POST /me/email` não pede senha; atacante troca o e-mail para o dele, confirma o código e usa "recuperar senha". Persistência total | Exigir `senhaAtual` em `POST /me/email` (re-autenticação); notificar o e-mail antigo da troca (ver F3) | B: `me.schema.ts`, `me.service.ts` |
| E2 | S | Confirmar troca para e-mail que não pertence ao usuário | Código enviado só ao **novo** endereço (já); hash do código inclui `novoEmail` no contexto | B: `lib/codigo.ts` uso em `me.service.ts` |
| E3 | T | Corrida: dois usuários confirmam o mesmo e-mail | Unicidade do banco (`P2002` -> 409) dentro da transação (já decidido) | B: `me.service.ts` |
| E4 | E | Força bruta de `POST /me/email/confirmar` limitada só por IP | Limite por `usuarioId`, e invalidar o pedido após 5 erros | B: `limitar.ts` |
| E5 | E | Brute force da senha atual via `PATCH /me/senha` e `DELETE /me` com token roubado, limite só por IP | Limite por `usuarioId` nas falhas de `SENHA_INCORRETA` | B: `limitar.ts` |
| E6 | R/I | Sem notificação ao titular em troca de senha/e-mail/exclusão | E-mail de aviso ao endereço anterior ("Sua senha/e-mail foi alterado") | B: `lib/mailer.ts` |
| E7 | T | Exclusão irreversível sem janela de arrependimento e disparada por token roubado + senha | Confirmação com senha (já); aviso por e-mail; decidir com o PO se haverá janela de cancelamento antes do apagamento | PO/B |
| E8 | D | ADMIN único com outros membros se exclui: Casa sem ADMIN | Gancho M2: bloquear ou promover antes do apagamento definitivo; registrar como pendência rastreada | B: `me.service.ts`, rotina |
| E9 | T | Nova senha igual à atual / fraca | `SENHA_IGUAL_ATUAL`; política RNF15; considerar lista de senhas comuns (desejável) | B |

### 4.5 JWT e sessão

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| J1 | S | Algoritmo `none`/confusão de algoritmo | `jwt.verify(token, secret, { algorithms: ['HS256'] })` | B: `lib/jwt.ts` |
| J2 | S | `JWT_SECRET` fraco/padrão | `env.ts` exige >= 32 caracteres e **falha a subida em produção** se igual ao valor do `.env.example` | B: `config/env.ts` |
| J3 | I | Roubo do token por XSS (`localStorage`) | CSP restritiva no front (Vercel `headers`), sem `dangerouslySetInnerHTML`, sem scripts de terceiros, `npm audit`, token de 8 h; risco aceito pela decisão do Arquiteto, registrado | F/D: `vercel.json`, `src/lib/api.ts` |
| J4 | E | Token continua válido após logout/troca/exclusão | `iat < sessoesValidasDesde` e `exclusaoSolicitadaEm` checados **a cada requisição** (já decidido). Testar os 4 gatilhos | B: `middlewares/autenticar.ts` |
| J5 | E | Claims confiáveis (papel/casa no token) | Token só com `sub`+`iat`; papel e `casaId` vêm do banco a cada requisição (já decidido). Nunca aceitar `casaId` do corpo/params sem filtrar por `req.usuario.casaId` | B: `autenticar.ts`, services |
| J6 | S | Janela de 1 s: token emitido no mesmo segundo do corte continua válido | Aceito pelo ADR; registrado. Se barato, comparar em ms | B: `autenticar.ts` |
| J7 | D | Token sem expiração | `expiresIn` sempre aplicado (8 h) e testado com token vencido | B: `lib/jwt.ts` |
| J8 | I | Logout só no cliente | Logout chama a API e só depois apaga o token (já no contrato) | F: `src/lib/` |

### 4.6 E-mails e rotinas

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| M1 | S | Phishing via conteúdo controlado pelo atacante (`nome`) | Escapar HTML; texto simples como principal | B: `lib/mailer.ts` |
| M2 | I | Vazamento de segredos/PII em logs de e-mail | Não logar corpo do e-mail nem o código; `RESEND_API_KEY` só em env | B/D |
| M3 | I | SPF/DKIM/DMARC ausentes no domínio remetente (e-mail de código cai em spam ou é falsificado) | Configurar no DNS do domínio de envio antes de produção | D |
| J-OB | E | Acionar `/internal/jobs` sem chave ou com comparação vulnerável a timing | `crypto.timingSafeEqual`, chave longa (>= 32 bytes) só em secret do GitHub/Render, sem logar; remover alias `/jobs/run` após migração (superfície duplicada); rate limit na rota | B: `jobs`, `app.ts`; D: `.github/workflows/jobs.yml` |
| J-24H | D | Apagamento em 24 h (RNF16) falha silenciosamente (GitHub Actions cron é "best effort" e pode atrasar ou ser desativado após 60 dias sem atividade) | Agendar a cada hora; job idempotente e que processa **tudo** com `exclusaoSolicitadaEm <= now() - 0`; alerta quando existir solicitação com mais de 20 h | B: `jobs/`; D |

### 4.7 Infra HTTP

| ID | STRIDE | Ameaça | Mitigação esperada | Onde |
|---|---|---|---|---|
| H1 | I | Cabeçalhos de segurança ausentes | `helmet()` (presente); `x-powered-by` desligado | B: `app.ts` |
| H2 | S | CORS aberto demais | `origin` fixo = `CORS_ORIGIN`; sem `*`; `credentials: true` é desnecessário com Bearer, remover | B: `app.ts` |
| H3 | D | Rate limit em memória: reinício/várias instâncias zeram contadores | Aceitável em 1 instância no MVP; para escalar, store compartilhado (Postgres/Redis). Registrar | B: `limitar.ts` |
| H4 | D | Corpo grande/JSON malicioso | `express.json({ limit: '10kb' })` nas rotas de auth | B: `app.ts` |
| H5 | I | Stack trace/SQL em resposta 500 | `errorHandler` devolve só `ERRO_INTERNO`; detalhes só no log | B: `middlewares/error.ts` |
| H6 | I | Seed com usuário demo e senha conhecida em produção | `seed.ts` aborta se `NODE_ENV=production`; usuário demo nunca no banco de produção | B: `prisma/seed.ts`, D |
| H7 | I | IDs sequenciais (`id: number`) facilitam enumeração/IDOR nos módulos futuros | Autorização por `casaId` em toda consulta (regra do papel); sem enumeração via resposta de erro (404 igual para "não existe" e "de outra Casa") | B: services |

---

## 5. Requisitos LGPD aplicáveis

| # | Requisito | Base | O que verificar no M1 |
|---|---|---|---|
| P1 | **Minimização** (art. 6, III) | Coletar só nome, e-mail e senha; nenhum dado a mais | Cadastro sem telefone/CPF/data de nascimento; `Perfil` sem hash/código; foto de perfil fora do MVP (backlog) |
| P2 | **Direito ao esquecimento / eliminação** (art. 18, VI; RNF16) | Apagar dados pessoais em até 24 h do pedido | Rotina apaga `usuario`, `codigo_verificacao`, vínculos; Casa sem membros também; `usuarioId` nulo nos logs; bloqueio imediato de login (`exclusaoSolicitadaEm`) |
| P3 | **Eliminação em backups, logs e terceiros** | Art. 16 | Documentar retenção do backup do banco, do Resend/Mailpit e de logs do Render; prazo máximo documentado (ex.: 30 dias) e informado na política de privacidade |
| P4 | **Transparência** (art. 9) e **termos/privacidade** (RF30, UC003) | Informar finalidade, base legal, compartilhamento (Resend, Render, Vercel, S3 no M3), retenção, direitos | Tela de Termos acessível sem login (tela 01 e 03) e na Conta (16); política cita operadores e prazo de eliminação |
| P5 | **Registro de ciência/consentimento** | Art. 8 §2 / prova | A decisão do PO foi "aviso com link, sem checkbox". Base legal do cadastro é execução de contrato (art. 7, V), então o checkbox não é obrigatório, mas **falta guardar a versão dos termos e data do cadastro**. Recomendação: coluna `termos_versao`/`termos_aceitos_em` (ver F8) |
| P6 | **Canal do titular / Encarregado (DPO)** (art. 18 e 41) | Titular precisa de meio para exercer direitos além da exclusão (acesso, correção, portabilidade) | RF29/UC032 (contato) foi para o backlog: sem ele **não há canal**. Mínimo: e-mail do encarregado publicado na política |
| P7 | **Direito de acesso e correção** (art. 18, II e III) | Ver e corrigir dados | Tela 16/20: `GET /me` e `PATCH /me` + troca de e-mail cobrem; portabilidade fica no backlog |
| P8 | **Logs de auditoria sem PII desnecessária** (RNF05) | Art. 6, III e X | `detalhes` sem senha, código, e-mail completo (usar id), nome; IP, se guardado, truncado; retenção definida |
| P9 | **Mascaramento** (RNF25) | Exibição | Tela 16 mascara o e-mail; mensagens de erro nunca ecoam dado pessoal de terceiros |
| P10 | **Segurança e incidente** (art. 46 e 48) | Medidas técnicas | Este checklist; procedimento de comunicação de incidente (dono: PO/DevOps) registrado em `docs/seguranca/` na próxima etapa |
| P11 | **Menores** (art. 14) | Sem verificação de idade | Termos declaram uso por maiores de 18 anos; registrar como risco aceito |

---

## 6. Falhas de design encontradas no contrato (`docs/api/m1-auth.md`) e no ADR

Severidade: A = alta (tomada de conta ou vazamento), M = média, B = baixa. "Decisor" é quem precisa agir.

| ID | Sev. | Falha | Evidência | Recomendação | Decisor |
|---|---|---|---|---|---|
| F1 | A | **Enumeração de contas** em `recuperar-senha`: 404 `CONTA_NAO_ENCONTRADA` distingue e-mail existente. Soma-se a `409 EMAIL_EM_USO` (cadastro e troca de e-mail) e ao diferencial de tempo/envio de e-mail | Contrato 3.3; ADR A5 | Responder 200 idêntico sempre (e enviar o e-mail só se houver conta); manter o 404 só com aceite formal do PO + rate limit por IP agressivo e monitoramento. O 409 de cadastro é aceitável com limite | PO + Arquiteto |
| F2 | A | **Código de 6 dígitos sem limite de tentativas por código**: limites são por IP (+ e-mail); sem contador no schema. Botnet contorna. `POST /me/email/confirmar` limita só por IP, não por usuário | Contrato 1.4, ADR "Códigos de verificação" ("o schema não tem contador") | Adicionar `tentativas` (int) em `codigo_verificacao`: invalida o código no 5º erro; ou contador por `usuarioId`/e-mail independente do IP. Efeito colateral aceitável: atacante pode forçar o usuário a pedir novo código | Arquiteto |
| F3 | A | **Troca de e-mail sem reautenticação** nem notificação ao e-mail antigo: token roubado => troca e-mail => "recuperar senha" => tomada permanente | Contrato 3.8 (corpo só `email`) | `POST /me/email` exige `senhaAtual` (401 `SENHA_INCORRETA`); e-mail de aviso ao endereço antigo na solicitação e na confirmação | Arquiteto + Back |
| F4 | A | **Token no `localStorage`** (A2): qualquer XSS exfiltra sessão de 8 h; sem refresh/rotação. Risco já reconhecido, mas sem CSP definida no contrato | Contrato 1.1, ADR "Token no front" | Manter (decisão tomada), mas exigir CSP no front (D), sem scripts de terceiros, `npm audit` no CI, nenhum `dangerouslySetInnerHTML`. Considerar reduzir para 2 h + refresh no backlog | Arquiteto + DevOps |
| F5 | M | **Mail bombing**: `pedirCodigo` é 5/15 min por IP+e-mail; atacante troca de IP e inunda a vítima / esgota cota do Resend | Contrato 1.4 | Limite por e-mail independente do IP + cota global de envios por hora | Back |
| F6 | M | **Credential stuffing**: login limitado por IP+e-mail apenas; um IP testa 10 senhas × N e-mails (teto só o global 120/min) | Contrato 1.4 | Adicionar limite por IP isolado para falhas de login (ex.: 50/15 min) | Back |
| F7 | M | **Brute force de senha atual** em `PATCH /me/senha` e `DELETE /me` limitado por IP, não por usuário (token roubado + várias IPs) | Contrato 1.4 | Limite de falhas por `usuarioId` | Back |
| F8 | M | **Sem prova de ciência dos termos** e **sem canal do titular/DPO** (RF29 no backlog) | Decisões de escopo do PO | Guardar versão/data dos termos aceitos; publicar e-mail do encarregado na política (mínimo viável) | PO |
| F9 | M | **Rate limit em memória** (zera em reinício/escala) e `trust proxy` condicional | ADR A5 | Aceitar no MVP com 1 instância; registrar; mover para Postgres/Redis antes de escalar | Arquiteto |
| F10 | M | **Mesmo segredo (`JWT_SECRET`) para JWT e HMAC dos códigos**; sem exigência de tamanho mínimo/rejeição de valor padrão | ADR "Códigos de verificação" | Chaves separadas; validar tamanho em `env.ts` | Back/Arquiteto |
| F11 | M | **Janela de 1 s** do corte de sessão (`floor` em segundos) | ADR A1 | Aceitável; documentar. Idealmente comparar em ms (o `iat` do JWT já é em segundos, então só vale para o corte da senha) | Arquiteto |
| F12 | M | **Prazo de 24 h dependente de cron do GitHub Actions** (best effort; pausa por inatividade), sem alerta | ADR "Rota de rotinas", história 8.3.2 | Cron horário + monitoramento de pendências > 20 h; plano B manual | DevOps |
| F13 | M | **Exclusão sem janela de arrependimento** e sem aviso por e-mail; ADMIN único com outros membros deixa Casa órfã | Contrato 3.11, ADR A3 | Aviso por e-mail ao pedir; decidir com PO sobre janela; bloquear exclusão de ADMIN único com membros no M2 (gancho já previsto) | PO + Arquiteto |
| F14 | B | **Limite de senha em caracteres, não em bytes** (bcrypt trunca em 72 bytes) | Contrato 3.1 (8 a 72 caracteres) | Validar bytes <= 72 | Back |
| F15 | B | **Respostas de auth/perfil sem `Cache-Control: no-store`** | Contrato (omissão) | Cabeçalho em `/auth/*` e `/me*` | Back |
| F16 | B | **`POST /internal/jobs` com alias `/jobs/run`**: dobra superfície; comparação do token pode ser vulnerável a timing | ADR "Rota de rotinas" | `timingSafeEqual`; remover alias após migrar o workflow | Back/DevOps |
| F17 | B | **`credentials: true` no CORS** sem uso (Bearer) | `app.ts` | Remover | Back |
| F18 | B | **Seed com usuário demo e senha conhecida** | ADR "Seed e planos" | Bloquear em `NODE_ENV=production` | Back/DevOps |
| F19 | B | **Códigos pendentes de outra finalidade não são invalidados** na redefinição/troca de senha | Contrato 3.4, 3.10 | Invalidar todos os códigos abertos do usuário ao trocar senha | Back |

Pontos positivos do contrato (manter): mensagem única no login, `CODIGO_INVALIDO` para e-mail sem conta em `redefinir-senha`, HMAC para códigos, uso único e expiração de 15 min, JWT de 8 h com corte `sessoesValidasDesde`, papel e `casaId` lidos do banco a cada requisição, redefinição sem login automático, `id` da Casa/usuário nunca vindo do corpo, `helmet`, rate limit global, 401 de `SENHA_INCORRETA` que não derruba a sessão.

---

## 7. Checklist de revisão do código do M1

Marcar `[x]` apenas com evidência (arquivo/linha ou teste). `[B]` = bloqueante para aceite de segurança. Cada item é verificável por leitura de código, teste automatizado ou comando.

### 7.1 Senhas e credenciais
- [x] [B] Senhas só em bcrypt (custo >= 10) via `lib/senha.ts`; `grep -rn "senha" backend/src` não mostra senha em log, auditoria ou resposta. _Evidência: bcrypt custo 12 em produção (`lib/senha.ts:5`); sem senha em log/resposta._
- [x] [B] Nenhuma resposta (`Perfil`, login, cadastro, erro) contém `senhaHash`, código ou hash de código (teste de contrato). _Evidência: `obterPerfil` auth.service.ts:73-86 não expõe hash/código._
- [ ] `senhaSchema` valida 8 a 72 **bytes** (`Buffer.byteLength`), não só caracteres. _Reprovado: F14: `campos.ts:21-24` conta caracteres, não bytes._
- [x] Login: e-mail inexistente, senha errada e conta com exclusão solicitada devolvem corpo e status idênticos; `conferirSenha(senha, null)` executa bcrypt (teste de tempo ou revisão). _Evidência: `auth.service.ts:122-128`, `senha.ts:19-22`._
- [x] `PATCH /me/senha`: `SENHA_INCORRETA` antes de `SENHA_IGUAL_ATUAL`; nova senha gera novo hash. _Evidência: `auth.service.ts:288-296`._
- [ ] Seed aborta em `NODE_ENV=production`. _Reprovado: `seed.ts` não aborta em produção._

### 7.2 JWT e sessão
- [x] [B] `jwt.verify` com `algorithms: ['HS256']`; `expiresIn` aplicado; teste com token expirado, adulterado e `alg: none`. _Evidência: `jwt.ts:13,26`; falta teste com `alg: none`._
- [ ] [B] `env.ts` falha se `JWT_SECRET` < 32 caracteres ou igual ao valor do `.env.example` em produção. _Reprovado: F10/ACH-02: `env.ts:8` aceita 16 caracteres e o valor de exemplo._
- [x] [B] `autenticar` consulta o usuário a cada requisição e rejeita: `iat` anterior a `sessoesValidasDesde`, `exclusaoSolicitadaEm` preenchido, usuário inexistente. Teste para logout, redefinição, troca de senha e exclusão. _Evidência: `autenticar.ts:51-57`._
- [x] `req.usuario` (`id`, `casaId`, `papel`) vem do banco; nenhuma rota usa `casaId`/`usuarioId` do corpo, query ou params sem filtrar por `req.usuario`. _Evidência: M1 não usa casaId do cliente._
- [x] Cadastro grava `sessoesValidasDesde: new Date()`; `PATCH /me/senha` emite token novo **depois** do corte. _Evidência: `auth.service.ts:103,299-305`._
- [x] Logout só no 204; token local removido apenas após sucesso; 401 de `SENHA_INCORRETA`/`CREDENCIAIS_INVALIDAS` **não** limpa sessão no front (teste do cliente HTTP). _Evidência: `api.ts:47-52`._
- [ ] Respostas de `/auth/*` e `/me*` com `Cache-Control: no-store`. _Reprovado: F15: sem Cache-Control._

### 7.3 Códigos de verificação
- [x] [B] Código de 6 dígitos gerado com `crypto.randomInt`; só o HMAC é gravado; comparação com `timingSafeEqual`. _Evidência: `codigo.ts:9,23,27-30`._
- [ ] [B] Limite de tentativas **por código/usuário** (independente do IP) implementado; código invalidado após N erros; teste que prova o bloqueio com IPs diferentes (ver F2). _Reprovado: F2/ACH-03: sem contador de tentativas._
- [x] Expira em 15 min (teste com relógio simulado), uso único, geração de novo código invalida os anteriores. _Evidência: `auth.service.ts:143-146,173-175,207-211`._
- [ ] Hash usa chave dedicada (não o `JWT_SECRET` puro) e contexto `usuarioId:finalidade[:novoEmail]`. _Reprovado: F10: HMAC usa JWT_SECRET puro._
- [ ] Redefinição/troca de senha invalida códigos abertos do usuário (F19). _Reprovado: F19._
- [x] `redefinir-senha`: e-mail sem conta, código errado, expirado e usado devolvem o mesmo `400 CODIGO_INVALIDO`; não há login automático; todas as sessões encerradas. _Evidência: `auth.service.ts:197-220`._
- [ ] `recuperar-senha`: resposta é a decidida pelo PO para F1; se for 404, rate limit por IP presente e risco registrado no backlog.
- [ ] Envio de e-mail não bloqueia a resposta nem muda o tempo entre conta existente/inexistente. _Reprovado: `recuperarSenha` e `emitirCodigo` aguardam o envio; tempo difere de 404._

### 7.4 Troca de e-mail, exclusão e e-mails
- [ ] [B] `POST /me/email` exige `senhaAtual` (F3) ou há aceite formal do PO registrado. _Reprovado: ACH-01: `pedirTrocaDeEmail` não pede senha._
- [x] Código vai apenas ao **novo** e-mail; e-mail atual só muda em `confirmar`, em transação; `P2002` -> 409. _Evidência: `auth.service.ts:262-285`._
- [ ] Aviso ao e-mail antigo na troca de e-mail, troca de senha e pedido de exclusão (ou risco aceito pelo PO). _Reprovado: F3: sem aviso ao e-mail antigo._
- [x] `DELETE /me`: exige senha; define `exclusaoSolicitadaEm`, corta sessões, audita; login seguinte falha com `CREDENCIAIS_INVALIDAS`. _Evidência: `auth.service.ts:313-329`._
- [ ] `nome` escapado em e-mails HTML e rejeita `<`/`>`; nenhum `dangerouslySetInnerHTML` no front (`grep`). _Reprovado: `nome` aceita `<`/`>` e quebras de linha (ACH-07)._
- [x] E-mails não incluem link com token de sessão; corpo e código nunca em log; `caixaDeSaida` só em `NODE_ENV=test`. _Evidência: `mailer.ts`, sem log do código._

### 7.5 Rate limit e infraestrutura
- [x] [B] Presets aplicados a todas as rotas do contrato 1.4, conferidos rota a rota (cadastro, login, recuperar, redefinir, `/me/email`, `/me/email/confirmar`, `/me/senha`, `DELETE /me`). _Evidência: rotas conferidas em `auth.routes.ts:24-39`._
- [ ] Limite por IP isolado no login (F6) e por `usuarioId` em rotas sensíveis (F7); limite por e-mail independente de IP em pedidos de código (F5). _Reprovado: F5/F6/F7 abertos._
- [ ] `429` com `Retry-After`; teste com `TESTAR_RATE_LIMIT=1` para cada preset. _Reprovado: só o login tem teste de 429._
- [ ] `trust proxy` = 1 só em produção; CORS com `origin` = `CORS_ORIGIN` e sem `credentials` desnecessário; `helmet()` ativo; `x-powered-by` off. _Reprovado: F17: `credentials: true` (`app.ts:22`)._
- [x] `express.json({ limit })` pequeno; JSON malformado -> `400 REQUISICAO_INVALIDA`; 500 não vaza stack nem SQL. _Evidência: `error.ts`; limite de 1 MB aceito no MVP._
- [x] Validação Zod em **toda** rota (`validar` aplicado), com campos desconhecidos descartados. _Evidência: `validar` em todas as rotas do M1._

### 7.6 Rotinas e exclusão definitiva
- [ ] [B] `/internal/jobs` compara `x-jobs-token` com `timingSafeEqual`; sem chave ou chave errada -> 401; token de usuário não vale; `JOBS_TOKEN` >= 32 bytes só em secret. _Reprovado: ACH-05: `app.ts:40` usa `!==`._
- [ ] Alias `/jobs/run` removido (ou com data de remoção) e workflow migrado. _Reprovado: `app.ts:39` mantém `/jobs/run`._
- [x] Rotina apaga usuário, códigos e vínculos; apaga a Casa sem membros; `SetNull` nos logs; é idempotente e transacional; teste cobre Casa com e sem outros membros. _Evidência: `auth.service.ts:340-370`._
- [ ] Agendamento horário e alerta para pedidos pendentes há mais de 20 h (RNF16). _Reprovado: sem alerta._
- [x] Documentado o gancho M3 (apagar objetos do S3 antes de remover a Casa). _Evidência: comentário em `auth.service.ts:338`._

### 7.7 LGPD
- [x] Cadastro coleta somente nome, e-mail e senha. _Evidência: só nome, e-mail, senha._
- [ ] Termos e política acessíveis sem login (telas 01/03) e na Conta (16); citam operadores, retenção e prazo de eliminação (inclusive backups). _Reprovado: texto-base; falta operadores e retenção._
- [ ] Versão/data dos termos registrada no cadastro (ou risco aceito pelo PO). _Reprovado: F8._
- [ ] Canal do titular/encarregado publicado (e-mail mínimo). _Reprovado: F8._
- [x] Auditoria (`registrarAuditoria`) sem senha, código, nome ou e-mail completo; IP (se houver) truncado; retenção documentada. _Evidência: `auditoria.ts`, sem PII._
- [x] Tela 16 mascara o e-mail (RNF25). _Evidência: `mascararEmail` no front._
- [x] Nenhum dado pessoal em URLs/query strings; `localStorage` guarda apenas `keepit.token`. _Evidência: só `keepit.token` (`sessao.ts`)._

### 7.8 Front-end e dependências
- [ ] [B] CSP definida no front (`vercel.json` ou meta) sem `unsafe-inline`/`unsafe-eval` em scripts. _Reprovado: ACH-04: sem CSP._
- [x] Guardas de rota: visitante -> 02; logado em 01/02/03 -> 05; sem confiar só no front (a API é a barreira). _Evidência: `guardas.tsx`._
- [x] Token lido do `localStorage` a cada requisição; 401 `NAO_AUTENTICADO`/`SESSAO_EXPIRADA` limpa token e cache do TanStack Query. _Evidência: `api.ts:47-52`, `sessao.ts:encerrar`._
- [ ] `npm audit --omit=dev` sem vulnerabilidade alta/crítica em `backend` e `frontend`; lockfiles versionados. _Reprovado: ACH-06: nodemailer 7.0.13 (high) no backend; frontend sem vulnerabilidades._
- [x] Senhas, códigos e tokens nunca em `console.log`, mensagens de erro ou analytics; inputs com `autocomplete` correto (`current-password`, `new-password`, `one-time-code`). _Evidência: sem console/innerHTML; autocomplete correto._
- [x] Segredos fora do repositório (`.env` no `.gitignore`/`.dockerignore`, `.env.example` sem valores reais). _Evidência: `.env` no `.gitignore`._

### 7.9 OWASP Top 10 (resumo por item, a marcar no PR)
- [x] A01 Controle de acesso (rotas `/me` por token, isolamento por `casaId`, 404 para recurso de outra Casa)
- [ ] A02 Falhas criptográficas (bcrypt, HMAC, TLS em produção, segredos) _Reprovado: ACH-02._
- [x] A03 Injeção (Prisma parametrizado; sem `$queryRawUnsafe`; escape de e-mail) _Evidência: sem `$queryRaw` no M1._
- [ ] A04 Design inseguro (itens F1–F19 tratados ou aceitos) _Reprovado: ver seção 9._
- [ ] A05 Configuração incorreta (helmet, CORS, seed, mensagens de erro) _Reprovado: ACH-02, ACH-04._
- [ ] A06 Componentes vulneráveis (`npm audit`) _Reprovado: ACH-06._
- [ ] A07 Falhas de identificação/autenticação (rate limit, códigos, sessão) _Reprovado: ACH-01, ACH-03._
- [ ] A08 Integridade (lockfile, pipeline, `JOBS_TOKEN`) _Reprovado: ACH-05._
- [ ] A09 Logs e monitoramento (auditoria útil e sem PII; alertas de falhas) _Reprovado: ACH-08._
- [x] A10 SSRF (sem fetch de URL do usuário no M1; confirmar)

---

## 8. Riscos aceitos até decisão formal

| Risco | Dono da decisão | Registro |
|---|---|---|
| Enumeração de contas em `recuperar-senha` (404) | PO | Pendente: aceitar formalmente ou adotar resposta uniforme (F1) |
| Token em `localStorage` | Arquiteto | Aceito no ADR; depende de CSP (F4) |
| Rate limit em memória | Arquiteto | Aceito no MVP (F9) |
| Logout em todos os dispositivos | Arquiteto | Aceito no ADR |
| Janela de 1 s no corte de sessão | Arquiteto | Aceito no ADR (F11) |
| Sem checkbox de aceite dos termos | PO | Aceito, com ressalva de registrar versão/data (F8) |

Itens acima do escopo do M1 (upload de fotos, assinatura e pagamentos, convite de membros) terão modelagem própria em `docs/seguranca/` quando seus módulos forem iniciados.


## 9. Resultado da revisão de código do M1

Revisão de `backend/src` (auth, middlewares, lib, jobs, app.ts) e `frontend/src`. `npm audit --omit=dev`: backend com 4 avisos de severidade alta (nodemailer 7.0.13 e deepmerge-ts via CLI do Prisma); frontend sem vulnerabilidades. **Parecer: reprovado para produção** por ACH-01 a ACH-03. Itens `[B]` ainda abertos: 213, 222, 231, 247, 263.

| ID | Sev. | Área | Local | Achado e correção |
|---|---|---|---|---|
| ACH-01 | Alta | backend | `auth.service.ts:241-259`, `auth.routes.ts:36` | `POST /me/email` não exige `senhaAtual` e não avisa o e-mail antigo. Com token roubado, o atacante troca o e-mail, confirma o código e usa "recuperar senha". Correção: exigir `senhaAtual` no corpo, avisar o e-mail antigo, encerrar sessões após a troca. |
| ACH-02 | Alta | backend/infra | `config/env.ts:8,11`, `.env.example` | `JWT_SECRET` e `JOBS_TOKEN` aceitam 16 caracteres e o valor de exemplo (`troque...`). Em produção com o padrão, qualquer pessoa forja tokens. Correção: mínimo de 32; em `NODE_ENV=production` recusar o valor do exemplo; usar chave própria para o HMAC dos códigos. |
| ACH-03 | Alta | backend | `auth.service.ts:168-179`, `limitar.ts:29-35` | Sem limite de tentativas por código ou usuário. O limite é por IP (ou IP+e-mail) e `keyGeneratorIpFallback: false` desliga o agrupamento de IPv6, então cada endereço /128 tem cota própria. 6 dígitos e 15 min permitem forçar o código de redefinição ou de troca de e-mail. `/me/email/confirmar` limita só por IP. Correção: coluna `tentativas` em `codigo_verificacao`, invalidar no 5º erro; agrupar IPv6 por /64; limitar por `usuarioId`. |
| ACH-04 | Média | frontend/infra | `frontend/index.html`, sem `vercel.json` | Sem CSP e token em `localStorage` (8 h). Não há sink de XSS no código, mas a fonte do Google Fonts é externa. Correção: CSP sem `unsafe-inline`/`unsafe-eval` em scripts, `connect-src` só a API, fonte local ou liberada na CSP. |
| ACH-05 | Média | backend | `app.ts:40` | `x-jobs-token` comparado com `!==`; alias `/jobs/run` ainda ativo. Correção: `timingSafeEqual`, remover o alias (workflow já migrado). |
| ACH-06 | Média | backend | `package.json` (nodemailer 7.0.13) | Avisos altos do nodemailer. A exposição é baixa: em produção o envio vai pelo Resend, e `z.email()` rejeita os formatos de ataque testados. Correção: atualizar o nodemailer e `prisma`; adicionar `npm audit` ao CI. |
| ACH-07 | Média | backend | `lib/campos.ts:32-36`, `mailer.ts:80` | `nome` aceita `<`, `>` e quebras de linha e vai no texto do e-mail enviado a qualquer endereço (troca de e-mail): vetor de phishing. Correção: rejeitar caracteres de controle e `<>`; não colocar o nome no e-mail de troca. |
| ACH-08 | Média | backend | `auth.service.ts:349-367`, `schema.prisma` (`Assinatura.titularId` sem `onDelete`) | A rotina falha para titular de assinatura e deixa dados pessoais além de 24 h (RNF16); sem alerta. No M1 ainda não há assinaturas. Correção: tratar no M5 e alertar para pedidos pendentes há mais de 20 h. |
| ACH-09 | Baixa | backend | `lib/campos.ts:21-24`, `app.ts` | Senha limitada em caracteres, não bytes (bcrypt trunca em 72 bytes); sem `Cache-Control: no-store`; `credentials: true` sem uso; seed com usuário demo sem bloqueio em produção; códigos de recuperação pendentes não invalidados na troca de senha; `console.error(err)` em `error.ts:44` pode registrar argumentos do Prisma. |
| ACH-10 | Info | backend | `auth.service.ts:182-186` | 404 em `recuperar-senha` e 409 em cadastro/troca de e-mail permitem enumerar contas. Aceito no UC006; mitigado só por rate limit. Decisão formal do PO pendente (F1). |

Confirmado correto: bcrypt com hash fantasma no login, mensagem única de credenciais, JWT HS256 com expiração e corte `sessoesValidasDesde` conferido no banco a cada requisição, código gerado com `randomInt` e guardado como HMAC com `timingSafeEqual`, uso único atômico, 15 min, redefinição sem login automático, validação Zod em todas as rotas, Prisma sem SQL cru, exclusão que apaga usuário, códigos e vínculos e remove a Casa vazia, auditoria sem PII, front sem `innerHTML` e com `localStorage` só para o token.
