import { useState } from 'react';

const CHAVE = 'keepit.aviso-produtos-ficam';
const lerDispensado = () => {
  try {
    return localStorage.getItem(CHAVE) === '1';
  } catch {
    return false;
  }
};

/** Nota discreta ao EDITOR no cadastro (história 3.5, risco R-M2-1): os produtos pertencem à Casa. Pode ser dispensada (lembrado no navegador). */
export function AvisoProdutosFicam() {
  const [oculto, setOculto] = useState(lerDispensado);
  if (oculto) return null;
  return (
    <div role="note" className="flex items-start justify-between gap-3 rounded-campo bg-primary-claro px-4 py-3 text-sm">
      <p>Os produtos ficam na Casa, mesmo que você saia dela.</p>
      <button
        type="button"
        className="shrink-0 font-semibold text-primary underline"
        onClick={() => {
          try {
            localStorage.setItem(CHAVE, '1');
          } catch {
            /* sem armazenamento: só some nesta tela */
          }
          setOculto(true);
        }}
      >
        Entendi
      </button>
    </div>
  );
}
