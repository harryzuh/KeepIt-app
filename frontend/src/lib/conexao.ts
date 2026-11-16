import { useSyncExternalStore } from 'react';

/**
 * Estado de conexão (RNF24): combina o navigator.onLine com falhas de rede
 * observadas pelo cliente HTTP.
 */
let falhaDeRede = false;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export function registrarFalhaDeRede(falhou: boolean) {
  if (falhaDeRede === falhou) return;
  falhaDeRede = falhou;
  avisar();
}

function assinar(f: () => void) {
  ouvintes.add(f);
  window.addEventListener('online', f);
  window.addEventListener('offline', f);
  return () => {
    ouvintes.delete(f);
    window.removeEventListener('online', f);
    window.removeEventListener('offline', f);
  };
}

const semConexao = () => falhaDeRede || !navigator.onLine;

export function useSemConexao() {
  return useSyncExternalStore(assinar, semConexao);
}
