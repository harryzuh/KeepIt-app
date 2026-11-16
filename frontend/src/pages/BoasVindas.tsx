import { Link, useLocation } from 'react-router';
import { Alert } from '@/components/Alert';
import { Logo } from '@/components/Logo';

const EXEMPLOS = [
  { nome: 'Notebook', preco: 'R$ 4.299,00', cor: 'bg-editor-claro', rot: '-rotate-3' },
  { nome: 'Bicicleta', preco: 'R$ 1.480,00', cor: 'bg-primary-claro', rot: 'rotate-2 translate-x-8' },
  { nome: 'Furadeira', preco: 'R$ 389,90', cor: 'bg-apoio/20', rot: '-rotate-1' },
];

/** Tela 01 — Boas-vindas (UC001). */
export default function BoasVindas() {
  const aviso = (useLocation().state as { aviso?: string } | null)?.aviso;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 pb-6 pt-16">
      {aviso && <Alert tipo="sucesso" className="mb-6">{aviso}</Alert>}
      <div className="mb-4 flex size-16 items-center justify-center rounded-2xl bg-primary text-3xl text-white" aria-hidden="true">
        ▢
      </div>
      <h1>
        <Logo tamanho="lg" />
      </h1>
      <p className="mt-4 text-lg text-suave">
        Seu inventário digital. Fotografe seus bens, saiba quanto vale o que você tem e compartilhe com a família.
      </p>
      <ul className="my-10 flex flex-col gap-3" aria-label="Exemplos de produtos">
        {EXEMPLOS.map((e) => (
          <li key={e.nome} className={`w-56 rounded-2xl bg-white p-3 shadow-md ${e.rot}`}>
            <span className={`mr-3 inline-block size-10 rounded-xl align-middle ${e.cor}`} aria-hidden="true" />
            <span className="inline-block align-middle">
              <span className="block font-semibold">{e.nome}</span>
              <span className="block text-sm text-suave">{e.preco}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-auto flex flex-col gap-3">
        <Link to="/entrar" className="flex min-h-12 items-center justify-center rounded-campo bg-primary font-semibold text-white hover:bg-primary-escuro">
          Entrar
        </Link>
        <Link to="/criar-conta" className="flex min-h-12 items-center justify-center rounded-campo border border-borda bg-white font-semibold">
          Criar conta
        </Link>
        <p className="text-center text-sm text-suave">
          Ao continuar você concorda com os{' '}
          <Link to="/termos" className="underline">
            Termos de uso e Privacidade
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
