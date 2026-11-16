import { execSync } from 'node:child_process';

/** Aplica as migrations no schema de teste antes da suíte (prisma migrate deploy, não interativo). */
export default function setup(): void {
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
  });
}
