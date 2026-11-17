// app/lib/locacao/contatoVendedor.ts
// Contato do(a) vendedor(a) SEMPRE pela Ficha do Funcionário (folha_funcionarios),
// pedido do usuário 2026-11-17 — o telefone do cadastro de vendedor do P2S
// (colaboradores.telefone1) está desatualizado. Como achar a ficha:
//   1) usuário do sistema ligado a este vendedor (Permissões → Locação) que
//      tenha colaborador vinculado (perfis_usuarios.funcionario_id);
//   2) mesmo CPF do cadastro do P2S;
//   3) mesmo nome completo.
// Sem ficha: sem telefone (não usa o do P2S) e e-mail do cadastro do P2S.
// SEM checagem de acesso — quem chama já validou.
import type { supabaseAdmin } from '../supabase';

type Db = ReturnType<typeof supabaseAdmin>;
const dig = (s?: string | null) => (s || '').replace(/\D/g, '');

/** "11999357530" / "11 99935-7530" → "(11) 99935-7530" */
export function formatarCelular(t?: string | null): string | null {
  let d = dig(t);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t ? t.trim() : null;
}

export interface ContatoVendedor { nome: string; celular: string | null; email: string | null; daFicha: boolean }

export async function contatoVendedor(db: Db, vendedorId: number | null | undefined, nomeReserva?: string | null): Promise<ContatoVendedor | null> {
  if (!vendedorId) return nomeReserva ? { nome: nomeReserva, celular: null, email: null, daFicha: false } : null;
  const { data: c } = await db.from('colaboradores').select('nome_exibicao, nome_completo, cpf, cpf_digitos, email1').eq('id', vendedorId).maybeSingle();
  const nome = String(c?.nome_exibicao || c?.nome_completo || nomeReserva || '').trim();

  let ficha: any = null;
  // 1) usuário ligado ao vendedor → colaborador vinculado
  const { data: acessos } = await db.from('locacao_acesso_usuarios').select('perfil:perfis_usuarios(funcionario_id, ativo)').eq('vendedor_id', vendedorId);
  const fid = ((acessos || []) as any[]).map(a => a.perfil).find(pf => pf?.funcionario_id && pf.ativo !== false)?.funcionario_id;
  if (fid) ficha = (await db.from('folha_funcionarios').select('nome_completo, celular, email, ativo').eq('id', fid).maybeSingle()).data;
  // 2) CPF / 3) nome
  if (!ficha && c) {
    const cpf = c.cpf_digitos || dig(c.cpf);
    const { data: lista } = await db.from('folha_funcionarios').select('nome_completo, cpf, celular, email, ativo');
    const todas = (lista || []) as any[];
    const ordenar = (xs: any[]) => xs.sort((a, b) => Number(!!b.ativo) - Number(!!a.ativo));
    ficha = (cpf ? ordenar(todas.filter(f => dig(f.cpf) === cpf))[0] : null)
      || ordenar(todas.filter(f => String(f.nome_completo || '').trim().toUpperCase() === String(c.nome_completo || c.nome_exibicao || '').trim().toUpperCase()))[0]
      || null;
  }
  if (ficha) return { nome, celular: formatarCelular(ficha.celular), email: (ficha.email || '').trim().toLowerCase() || c?.email1 || null, daFicha: true };
  return { nome, celular: null, email: c?.email1 || null, daFicha: false };
}
