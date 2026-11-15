export const formatBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatData = (d: string | Date) => new Date(d).toLocaleDateString('pt-BR');
