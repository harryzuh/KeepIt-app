import { descreverErro } from '../../lib/erro-log.js';
import { enviarEmail } from '../../lib/mailer.js';

/** VIEW (e-mails) · avisos do M2. Falha de e-mail nunca desfaz a operação: é só registrada (sem dados pessoais). */

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function enviarAviso(para: string, assunto: string, nome: string, linhas: string[]): Promise<void> {
  const corpo = [`Olá, ${nome}!`, '', ...linhas, '', 'Equipe KeepIT'];
  try {
    await enviarEmail({
      para,
      assunto,
      texto: corpo.join('\n'),
      html: corpo.map((l) => `<p>${escaparHtml(l)}</p>`).join(''),
    });
  } catch (err) {
    console.error('Falha ao enviar e-mail da Casa:', descreverErro(err));
  }
}

export function emailMembroAdicionado(para: string, nome: string, casa: string, adminNome: string, papel: string) {
  return enviarAviso(para, 'Você foi adicionado a uma Casa no KeepIT', nome, [
    `${adminNome} adicionou você à Casa "${casa}" com o papel ${papel}.`,
    'Os produtos que você cadastrou na Casa anterior continuam lá, sem o seu nome como autor.',
    'Se você não reconhece este convite, entre em contato com a pessoa que administra a Casa.',
  ]);
}

export function emailMembroRemovido(para: string, nome: string, casaAntiga: string, casaNova: string) {
  return enviarAviso(para, 'Você saiu de uma Casa no KeepIT', nome, [
    `O administrador da Casa "${casaAntiga}" removeu você da Casa.`,
    `Você agora é ADMIN da Casa "${casaNova}", no plano Individual. Os produtos que você cadastrou na Casa anterior continuam lá.`,
  ]);
}

export function emailAdminExcluiuConta(para: string, nome: string, casa: string, promovido: boolean, casaNova?: string) {
  return enviarAviso(para, 'O administrador da sua Casa excluiu a conta no KeepIT', nome, [
    promovido
      ? `A pessoa que administrava a Casa "${casa}" excluiu a conta. Você agora é o ADMIN da Casa, com todos os produtos mantidos. O plano voltou ao Individual.`
      : `A pessoa que administrava a Casa "${casa}" excluiu a conta. Você agora é ADMIN da Casa "${casaNova ?? ''}", no plano Individual.`,
    ...(promovido ? [] : ['Os produtos cadastrados na Casa anterior permanecem lá.']),
  ]);
}
