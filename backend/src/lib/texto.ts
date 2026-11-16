/**
 * Higiene de texto de entrada (AppSec FD9/FD13): recusa caracteres de controle (\p{Cc}) e de formatação invisíveis
 * (\p{Cf}: U+200B espaço de largura zero, U+202E inversão de direção etc.), que permitem imitar nomes e burlar a
 * verificação de duplicidade. U+200D (juntor) e U+FE0F (seletor de emoji) ficam liberados porque compõem emojis.
 */

const TEM_CONTROLE = /\p{Cc}/u;
const FORMATACAO = /\p{Cf}/u;
const LIBERADOS = new Set(['\u200D', '\uFE0F']);
const temFormatacaoProibida = (s: string): boolean => [...s].some((c) => FORMATACAO.test(c) && !LIBERADOS.has(c));
/** Controles proibidos exceto quebra de linha, retorno e tabulação (descrição). */
const TEM_CONTROLE_FORA_DE_QUEBRA = /[^\P{Cc}\n\r\t]/u;

export const temControleOuFormatacao = (s: string): boolean => TEM_CONTROLE.test(s) || temFormatacaoProibida(s);
export const temControleOuFormatacaoExcetoQuebras = (s: string): boolean =>
  TEM_CONTROLE_FORA_DE_QUEBRA.test(s) || temFormatacaoProibida(s);

/** NFC e espaços internos (inclusive NBSP e outros) reduzidos a um só espaço; o `trim` fica a cargo do schema. */
export const normalizarLinha = (s: string): string => s.normalize('NFC').replace(/\s+/gu, ' ');
/** NFC apenas (descrição: preserva as quebras de linha). */
export const normalizarTexto = (s: string): string => s.normalize('NFC');
