-- ADR 0002 (D8): no máximo um ADMIN por Casa (o ADMIN é o titular da assinatura; "Casa nunca fica sem ADMIN"
-- é garantido pelas transações do service, e este índice impede dois ADMIN).
CREATE UNIQUE INDEX "membro_casa_id_admin_key" ON "membro" ("casa_id") WHERE "papel" = 'ADMIN';
