# Relatório da Sprint 2 — M5 Planos e Assinatura + M2 Casa e Membros

Data do aceite: 15/11/2026 · Responsável: PO · Fontes: QA (`docs/qa/sprint-2-m5-m2.md`, seção 7), AppSec (`docs/seguranca/m5-m2-modelo-ameacas.md`), ADR 0002, contratos `docs/api/m5-assinatura.md` e `m2-casa.md`, relatos das equipes.

## Veredito
**Sprint aceita.** 13 histórias: 7 aceitas e 6 aceitas com ressalvas, nenhuma rejeitada. QA aprovou o reteste (sem defeito crítico ou alto) e o AppSec aprovou com ressalvas. `make check` passa (back 276, front 64) e `make e2e` passa 91/91 (desktop e mobile 360 px). Vale para desenvolvimento e homologação, não para produção. Não conferi o código de novo: o aceite se apoia nos resultados do QA e do AppSec.

## 1. Entregue
- **M5:** serviço de plano vigente e cota (limites de membros e GB binário, base do RF39 para o M3); `GET /planos`; método de pagamento simulado (só marca e 4 dígitos); assinar, trocar, cancelar e reativar; assinar como membro com saída da Casa e Casa nova (RF38); rotina `expirarAssinaturas` em `POST /internal/jobs` (RF37), idempotente, com trava da Casa e retry. Telas 13, 14, 15 e 24.
- **M2:** listar membros, adicionar por e-mail com transferência, editar papel, remover com confirmação, editar nome da Casa, `POST /casa/sair`. Telas 11, 12 e 22. Limite de membros do plano (RNF13).
- **Ganchos da conta (ACH-08 fechado):** titular excluído expira a assinatura; ADMIN com membros promove o herdeiro; ADMIN solo sem herdeiro tem a Casa apagada pela rotina; aviso da tela 21 corrigido.
- **Transversal:** autorização por papel em todas as rotas novas com matriz ADMIN/EDITOR/LEITOR/outra Casa/sem token (RNF31); 16+ ações de auditoria (RNF05); 404 uniforme; rate limit por usuário; `CONFLITO_CONCORRENTE` (409) para deadlock.
- **Infra de testes:** helpers E2E (`montarCasa`, `contratarPlano`, `dispararJobs`), projeto mobile.

## 2. Resultado por história
| História | Resultado | Ressalva |
|---|---|---|
| 7.0 Cota de plano | Aceita | |
| 7.1 Visualizar planos | Aceita | |
| 7.3 Método de pagamento | Aceita com ressalvas | Front com nome/CVV, sem banner de cartão de teste, sem tratar 503 |
| 7.2 Assinar ou alterar | Aceita com ressalvas | PENDENTE não gravado (cobrança síncrona); mensagem genérica em `PLANO_NAO_COMPORTA` |
| 7.4 Cancelar e reativar | Aceita | |
| 7.5 Rotina de expiração | Aceita com ressalvas | Alerta de `falhas` só em log; fail-open |
| 7.6 Assinar como membro | Aceita | |
| 6.1 Visualizar membros | Aceita com ressalvas | `usuarioId` sequencial; `<p>` de e-mail vazio |
| 6.2 Adicionar membro | Aceita com ressalvas | Adição sem aceite (R-M2-1); oráculo residual 404 x 409 |
| 6.4 Editar papel | Aceita | |
| 6.3 Remover membro | Aceita | |
| 6.0 Editar nome da Casa | Aceita | |
| 6.6 Ganchos da exclusão | Aceita com ressalvas | Substitui o UC013 literal (promoção do herdeiro); textos do UC013 e das histórias a atualizar |

## 3. Defeitos abertos (nenhum crítico ou alto)
| Área | Sev. | Defeito |
|---|---|---|
| Front | Média | Tela 14: remover nome e CVV, banner "use cartão de teste", mensagens de `PAGAMENTO_INDISPONIVEL` e `CONFLITO_CONCORRENTE` em `lib/mensagens.ts`, texto de `PLANO_NAO_COMPORTA` com `details` |
| Front | Média | Sem tela "Sair da Casa" para `POST /casa/sair` |
| Infra | Média | `PAGAMENTO_SIMULADO` ausente de `.env.example` e compose (documentar `false` em produção); workflow que falhe quando `falhas > 0` |
| Front | Baixa | Tela 11 renderiza `<p>` vazio para EDITOR/LEITOR; `MembroDaCasa.email` deve ser opcional |
| Back | Baixa | `usuarioId` sequencial visível; oráculo residual com vaga |
| Infra | Baixa | `npm audit`: 3 altas em prisma > deepmerge-ts (exige Prisma 7) |
| QA | Baixa | `m1-conta` "troca de e-mail" falhou uma vez e passou depois (intermitente, observar o Mailpit) |

## 4. Mudanças de contrato
`Perfil.assinatura`; `/assinatura` virou `/assinaturas`; `GET /assinaturas/atual` responde 200 com `null` na Casa Individual; `PUT /pagamento/metodo` só com `numero` e `validade` (cartões de teste); job devolve `falhas`; códigos `PAGAMENTO_INDISPONIVEL` e `CONFLITO_CONCORRENTE`; `POST /casa/sair`; `email` só para ADMIN; auditoria `MEMBRO_ADICAO_NEGADA`. Todos já refletidos em `docs/api/`.

## 5. Riscos
| Risco | Sev. | Tratamento |
|---|---|---|
| R-M2-1: adição direta, sem consentimento (FP1/FP2) | Média | Aceito em dev/homologação (decisão 27). Tela "Sair da Casa" na Sprint 3; convite com aceite antes de produção pública. Registrar também o impacto LGPD (menores em Casa Família) |
| Sem pagamento real; produção recusa o gateway simulado | Alta para produção | Gateway real é pré-requisito de lançamento (decisão 29) |
| Rotina fail-open e rate limit em memória | Média | Alerta no CI; revisar ao escalar |
| `assinatura.casa_id` com cascade apaga histórico de cobrança (FP8) | Média | Decidir retenção antes de produção |
| Itens [B] do checklist de segurança ainda abertos (seção 10 do modelo de ameaças) | Média | Fechar antes de produção |
| Textos de e-mail com nome livre (FP11), `motivo` livre nos logs (FP13) | Baixa | Revisar com AppSec |
| Dívidas herdadas do M1 (CSP/ACH-04, ACH-09) | Alta para produção | Sem mudança nesta sprint |

## 6. Backlog proposto para a Sprint 3 (M3 Produtos e Tags, depois M4 Estatísticas)
**Itens 0 (fechar a Sprint 2, primeiro)**
- S2-F1 Front: tela 14 conforme contrato (sem nome/CVV, banner, 503/409, `PLANO_NAO_COMPORTA` com `details`); tela "Sair da Casa" na tela 11; `email` opcional.
- S2-D1 DevOps: `PAGAMENTO_SIMULADO` no `.env.example`/compose e alerta de `falhas > 0` no `jobs.yml`.
- S2-A1 Arquiteto/PO: atualizar UC013 e histórias 6.2/6.6; seed de Casa Família (`familia.*@keepit.local`) proposto pelo DevOps.
- S2-A2 AppSec: fechar itens [B] da seção 10 do modelo de ameaças.

**M3 — Produtos e Tags (usa `exigirCotaParaEnvio`, 409 `COTA_EXCEDIDA`)**
Cadastro de produto com foto e validação de cota (RF39); listagem, busca e filtro; detalhe e edição por papel (EDITOR/ADMIN; LEITOR só leitura); exclusão com confirmação; tags (criar, editar, atribuir); produtos de quem saiu ficam sem autor (já tratado). Telas e UCs conforme `docs/`; mesmo padrão: matriz de papéis e auditoria em toda rota.

**M4 — Estatísticas / Início**
Início (tela 05) com dados reais e avisos de renovação (visual); estatísticas por Casa e tag; só leitura para todos os papéis.

**Em paralelo, se houver capacidade:** convite com aceite (fecha R-M2-1 e FP1), foto de perfil, RF29 contato, upgrade Prisma 7, code-splitting.

## 7. Próximos passos imediatos
1. Fechar os itens 0 acima. 2. Arquiteto desenha o contrato do M3 (upload, cota, tags). 3. Decidir convite com aceite antes de produção pública.
