import { useSyncExternalStore } from 'react';

const CONSULTA = '(min-width: 1024px)';

function assinar(f: () => void) {
  const m = typeof window.matchMedia === 'function' ? window.matchMedia(CONSULTA) : null;
  m?.addEventListener('change', f);
  return () => m?.removeEventListener('change', f);
}

const atual = () => (typeof window.matchMedia === 'function' ? window.matchMedia(CONSULTA).matches : false);

/** Largura de 1024 px ou mais (tela 17, Início no desktop). Sem matchMedia (testes) vale celular. */
export const useDesktop = () => useSyncExternalStore(assinar, atual, () => false);
