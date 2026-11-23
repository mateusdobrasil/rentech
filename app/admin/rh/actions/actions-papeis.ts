'use server';

// app/admin/rh/actions/actions-papeis.ts
// Vendedor / cliente / fornecedor marcados na Ficha do RH (2026-11-23).
// Regras (o CPF é a chave do parceiro) em app/lib/cadastros/papeisRh.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { papeisDoFuncionario, definirVendedor, definirPapelParceiro } from '../../../lib/cadastros/papeisRh';

type Papeis = Awaited<ReturnType<typeof papeisDoFuncionario>>;
type Resultado<T = Papeis> = { ok: true; info: T } | { ok: false; erro: string };

const ROTAS = ['/admin/rh/funcionario'];

async function validar(accessToken: string, funcionarioId: string) {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS);
  if (!acesso.ok) return { ok: false as const, erro: acesso.message };
  const db = supabaseAdmin();
  const { data: f } = await db.from('folha_funcionarios').select('id, nome_completo, empresa_id').eq('id', funcionarioId).maybeSingle();
  if (!f) return { ok: false as const, erro: 'Funcionário não encontrado. Salve a ficha primeiro.' };
  const empresas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
  if (!empresaPermitida(empresas, f.empresa_id)) return { ok: false as const, erro: 'Você não tem permissão para este funcionário.' };
  return { ok: true as const, db, perfil: acesso.perfil, nome: f.nome_completo as string };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function papeisFuncionarioAction(funcionarioId: string, accessToken: string): Promise<Resultado> {
  const v = await validar(accessToken, funcionarioId);
  if (!v.ok) return v;
  try { return { ok: true, info: await papeisDoFuncionario(v.db, funcionarioId) }; }
  catch (e) { return { ok: false, erro: msg(e) }; }
}

export async function definirPapelFuncionarioAction(
  funcionarioId: string, papel: 'vendedor' | 'cliente' | 'fornecedor', valor: boolean, accessToken: string,
): Promise<Resultado> {
  const v = await validar(accessToken, funcionarioId);
  if (!v.ok) return v;
  if (!['vendedor', 'cliente', 'fornecedor'].includes(papel)) return { ok: false, erro: 'Papel inválido.' };
  try {
    if (papel === 'vendedor') await definirVendedor(v.db, funcionarioId, !!valor);
    else await definirPapelParceiro(v.db, funcionarioId, papel, !!valor, v.perfil.nome);
    await registrarLogAuditoria({
      usuario_nome: v.perfil.nome,
      acao: `${valor ? 'MARCOU' : 'DESMARCOU'} ${papel.toUpperCase()} NA FICHA: ${v.nome}`,
      setor: 'RECURSOS HUMANOS',
    });
    return { ok: true, info: await papeisDoFuncionario(v.db, funcionarioId) };
  } catch (e) { return { ok: false, erro: msg(e) }; }
}
