import { enviarEmail } from '../../lib/mailer.js';
import { descreverErro } from '../../lib/erro-log.js';

/** VIEW (e-mails) · avisos do M5. Falha de e-mail nunca desfaz a operação: é só registrada (sem dados pessoais). */

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function dataBr(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
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
    console.error('Falha ao enviar e-mail de assinatura:', descreverErro(err));
  }
}

export function emailAssinaturaConfirmada(
  para: string,
  nome: string,
  plano: string,
  preco: string,
  renovacao: Date,
) {
  return enviarAviso(para, 'Sua assinatura do KeepIT foi confirmada', nome, [
    `Sua assinatura do plano ${plano} (R$ ${preco} por mês) está ativa.`,
    `A próxima renovação será em ${dataBr(renovacao)}. Você pode cancelar quando quiser, na tela Assinatura.`,
  ]);
}

export function emailAssinaturaCancelada(para: string, nome: string, plano: string, fim: Date) {
  return enviarAviso(para, 'Sua assinatura do KeepIT foi cancelada', nome, [
    `A assinatura do plano ${plano} foi cancelada e não será renovada.`,
    `Os benefícios do plano continuam até ${dataBr(fim)}. Até lá você pode reativar a assinatura.`,
  ]);
}

export function emailAssinaturaExpiradaAdmin(para: string, nome: string, plano: string, desvinculados: number) {
  return enviarAviso(para, 'Sua assinatura do KeepIT expirou', nome, [
    `A assinatura do plano ${plano} expirou e sua Casa voltou ao plano Individual.`,
    desvinculados > 0
      ? `${desvinculados} membro(s) foram desvinculados e agora têm uma Casa própria. Seus produtos foram mantidos.`
      : 'Seus produtos foram mantidos.',
  ]);
}

export function emailMembroDesvinculado(para: string, nome: string, casaNova: string) {
  return enviarAviso(para, 'Você agora tem uma Casa própria no KeepIT', nome, [
    'A assinatura da sua Casa anterior expirou e o plano voltou ao Individual, que comporta um membro só.',
    `Você agora é ADMIN da Casa "${casaNova}". Os produtos cadastrados na Casa anterior permanecem lá.`,
  ]);
}
