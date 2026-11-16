export function Logo({ tamanho = 'md' }: { tamanho?: 'md' | 'lg' }) {
  return (
    <span className={`font-extrabold tracking-tight ${tamanho === 'lg' ? 'text-5xl' : 'text-2xl'}`}>
      Keep<span className="text-apoio">IT</span>
    </span>
  );
}
