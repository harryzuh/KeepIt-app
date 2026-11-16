import { API_URL, bearer, criarProduto, criarUsuario, expect, FOTOS, test } from './helpers';
import { sql } from './m3-db';

// Reteste 2 do M3: troca de foto com a cota exatamente cheia (substituiFotoIds) e contratos aditivos.

test.describe('Reteste 2', () => {
  test('upload-url com a cota cheia: troca da própria foto passa; sem substituiFotoIds, 409; id de outra Casa não libera', async ({ request }) => {
    const u = await criarUsuario(request, 'm3r2.troca');
    const { produto } = await criarProduto(request, u, { fotos: [FOTOS.png] });
    const foto = produto.fotos[0];
    const [{ tamanho_bytes }] = await sql<{ tamanho_bytes: string }>('select tamanho_bytes from foto where id = $1', [foto.id]);
    const tam = Number(tam_(tamanho_bytes));
    // deixa a cota exatamente cheia: ocupa o resto com uma foto fantasma
    const limite = 1_073_741_824;
    await sql(`insert into foto (produto_id, chave, tipo, tamanho_bytes, ordem) values ($1, $2, 'PNG', $3, 1)`, [produto.id, `casas/0/fotos/qa-r2-${Date.now()}.png`, limite - tam]);

    const pedir = (data: object) => request.post(`${API_URL}/produtos/fotos/upload-url`, { headers: bearer(u.token), data });
    expect((await pedir({ tipo: 'image/png', tamanhoBytes: tam })).status()).toBe(409);
    expect((await pedir({ tipo: 'image/png', tamanhoBytes: tam, substituiFotoIds: [foto.id] })).status()).toBe(200);
    expect((await pedir({ tipo: 'image/png', tamanhoBytes: tam + 1, substituiFotoIds: [foto.id] })).status()).toBe(409);

    const outra = await criarUsuario(request, 'm3r2.outra');
    const { produto: alheio } = await criarProduto(request, outra, { fotos: [FOTOS.png] });
    expect((await pedir({ tipo: 'image/png', tamanhoBytes: tam, substituiFotoIds: [alheio.fotos[0].id] })).status()).toBe(409);
    expect((await pedir({ tipo: 'image/png', tamanhoBytes: tam, substituiFotoIds: ['x'] })).status()).toBe(422);

  });
});
function tam_(v: string) { return v; }
