import { PaginaForm } from '@/components/PaginaForm';

/** Termos de uso e Política de Privacidade (UC003, RF30). Rota pública. Texto sujeito à revisão do AppSec/LGPD. */
export default function Termos() {
  return (
    <PaginaForm titulo="Termos de uso">
      <article className="space-y-6 leading-relaxed [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold [&_p]:text-suave [&_li]:text-suave">
        <header>
          <h2 className="text-3xl font-bold">Termos de uso e Privacidade</h2>
          <p className="mt-1 text-sm">Versão inicial do MVP, em revisão pela equipe de segurança e LGPD.</p>
        </header>
        <section>
          <h2>1. O que é o KeepIT</h2>
          <p>
            O KeepIT é um inventário digital de bens. Cada conta pertence a uma Casa, que pode ser compartilhada com outras pessoas
            conforme o plano contratado. Ao criar uma conta você concorda com estes termos.
          </p>
        </section>
        <section>
          <h2>2. Dados que coletamos</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Nome e e-mail, para identificar você e permitir o acesso.</li>
            <li>Senha, guardada somente de forma protegida (hash), nunca em texto.</li>
            <li>Dados dos produtos que você cadastra na sua Casa.</li>
          </ul>
        </section>
        <section>
          <h2>3. Para que usamos</h2>
          <p>
            Usamos seus dados apenas para operar o serviço: autenticar o acesso, enviar códigos de verificação por e-mail e mostrar o
            inventário aos membros da sua Casa. Não vendemos seus dados.
          </p>
        </section>
        <section>
          <h2>4. Seus direitos</h2>
          <p>
            Você pode corrigir seu nome e e-mail a qualquer momento em Conta. Pode também excluir sua conta: o acesso é bloqueado na
            hora e seus dados pessoais são apagados em até 24 horas (direito ao esquecimento).
          </p>
        </section>
        <section>
          <h2>5. Segurança</h2>
          <p>
            As sessões expiram automaticamente e a recuperação de senha usa códigos de uso único com validade de 15 minutos.
            Mantenha sua senha em sigilo.
          </p>
        </section>
        <section>
          <h2>6. Contato</h2>
          <p>Dúvidas sobre privacidade ou sobre estes termos podem ser enviadas à equipe do KeepIT pelo canal de contato do produto.</p>
        </section>
      </article>
    </PaginaForm>
  );
}
