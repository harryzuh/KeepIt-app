import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../config/env.js';
import { CODIGO_VALIDADE_MINUTOS } from './codigo.js';

export interface Email {
  para: string;
  assunto: string;
  texto: string;
  html?: string;
}

/** Caixa de saída em memória, usada apenas quando NODE_ENV=test (nada é enviado de verdade). */
export const caixaDeSaida: Email[] = [];

let transporte: Transporter | undefined;
let resend: Resend | undefined;

/**
 * Envia um e-mail: Resend se `RESEND_API_KEY` estiver definida; senão SMTP (Mailpit em dev,
 * UI em http://localhost:8025). Em teste, apenas guarda em `caixaDeSaida`.
 * Lança erro se o envio falhar (o chamador decide se aborta a operação).
 */
export async function enviarEmail(email: Email): Promise<void> {
  if (env.NODE_ENV === 'test') {
    caixaDeSaida.push(email);
    return;
  }
  if (env.RESEND_API_KEY) {
    resend ??= new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: env.MAIL_FROM,
      to: email.para,
      subject: email.assunto,
      text: email.texto,
      html: email.html,
    });
    if (error) throw new Error(`Falha ao enviar e-mail (Resend): ${error.message}`);
    return;
  }
  if (!env.SMTP_HOST) {
    throw new Error('E-mail não configurado: defina SMTP_HOST (dev) ou RESEND_API_KEY (prod)');
  }
  transporte ??= nodemailer.createTransport({ host: env.SMTP_HOST, port: env.SMTP_PORT ?? 1025, secure: false });
  await transporte.sendMail({
    from: env.MAIL_FROM,
    to: email.para,
    subject: email.assunto,
    text: email.texto,
    html: email.html,
  });
}

export type FinalidadeEmailCodigo = 'RECUPERAR_SENHA' | 'ALTERAR_EMAIL';

const ASSUNTOS: Record<FinalidadeEmailCodigo, string> = {
  RECUPERAR_SENHA: 'Seu código para redefinir a senha do KeepIT',
  ALTERAR_EMAIL: 'Confirme seu novo e-mail no KeepIT',
};

const MOTIVOS: Record<FinalidadeEmailCodigo, string> = {
  RECUPERAR_SENHA: 'redefinir a senha da sua conta',
  ALTERAR_EMAIL: 'confirmar o novo e-mail da sua conta',
};

function escaparHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Envia o e-mail com o código de 6 dígitos (sem link com token), válido por 15 minutos.
 * Nunca registre o código em log.
 */
export async function enviarEmailCodigo(args: {
  para: string;
  nome?: string;
  codigo: string;
  finalidade: FinalidadeEmailCodigo;
}): Promise<void> {
  // O e-mail de troca vai a um endereço arbitrário: nunca inclui o nome livre (phishing).
  const saudacao = args.nome && args.finalidade === 'RECUPERAR_SENHA' ? `Olá, ${args.nome}!` : 'Olá!';
  const texto = [
    saudacao,
    '',
    `Use o código abaixo para ${MOTIVOS[args.finalidade]}:`,
    '',
    `    ${args.codigo}`,
    '',
    `O código vale por ${CODIGO_VALIDADE_MINUTOS} minutos e só pode ser usado uma vez.`,
    'Se você não pediu isso, ignore este e-mail: nada será alterado.',
    '',
    'Equipe KeepIT',
  ].join('\n');
  const html = `<p>${escaparHtml(saudacao)}</p>
<p>Use o código abaixo para ${MOTIVOS[args.finalidade]}:</p>
<p style="font-size:28px;letter-spacing:6px;font-weight:700;color:#0F5C4D">${escaparHtml(args.codigo)}</p>
<p>O código vale por ${CODIGO_VALIDADE_MINUTOS} minutos e só pode ser usado uma vez.<br>Se você não pediu isso, ignore este e-mail: nada será alterado.</p>
<p>Equipe KeepIT</p>`;
  await enviarEmail({ para: args.para, assunto: ASSUNTOS[args.finalidade], texto, html });
}

/** Mascara o e-mail para avisos de segurança (ex.: `no***@exemplo.com`). */
export function mascararEmail(email: string): string {
  const [local = '', dominio = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${dominio}`;
}

/**
 * Aviso de segurança ao e-mail ATUAL (antigo) da conta durante a troca de e-mail:
 * `pedido` quando alguém pede a troca, `confirmado` quando a troca é efetivada.
 * Não inclui o nome do usuário nem códigos.
 */
export async function enviarAvisoTrocaDeEmail(args: {
  para: string;
  novoEmail: string;
  etapa: 'pedido' | 'confirmado';
}): Promise<void> {
  const novo = mascararEmail(args.novoEmail);
  const texto =
    args.etapa === 'pedido'
      ? [
          'Olá!',
          '',
          `Foi pedida a troca do e-mail da sua conta KeepIT para ${novo}.`,
          'A troca só acontece se o código enviado ao novo endereço for confirmado.',
          'Se não foi você, altere sua senha agora e ignore o pedido.',
          '',
          'Equipe KeepIT',
        ].join('\n')
      : [
          'Olá!',
          '',
          `O e-mail da sua conta KeepIT foi alterado para ${novo}. Este endereço não receberá mais mensagens da conta.`,
          'Todas as sessões foram encerradas. Se não foi você, use "Esqueci minha senha" com o novo e-mail ou procure o suporte.',
          '',
          'Equipe KeepIT',
        ].join('\n');
  const assunto =
    args.etapa === 'pedido' ? 'Pedido de troca de e-mail na sua conta KeepIT' : 'O e-mail da sua conta KeepIT foi alterado';
  await enviarEmail({ para: args.para, assunto, texto, html: texto.split('\n').map((l) => `<p>${escaparHtml(l)}</p>`).join('') });
}
