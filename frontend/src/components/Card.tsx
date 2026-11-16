import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export function Card({ className, ...resto }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-borda bg-white', className)} {...resto} />;
}
