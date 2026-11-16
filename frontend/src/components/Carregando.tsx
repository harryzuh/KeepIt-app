export function Carregando() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center" role="status">
      <span className="size-8 animate-spin rounded-full border-4 border-primary-claro border-t-primary" aria-hidden="true" />
      <span className="sr-only">Carregando...</span>
    </div>
  );
}
