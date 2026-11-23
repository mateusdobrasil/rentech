// app/lib/cadastros/papeisRh.ts
// Vendedor, cliente e fornecedor marcados na Ficha do RH (2026-11-23). Só
// servidor, SEM checagem de acesso. Decisão do usuário: "vendedor vem da ficha
// do RH, e o funcionário também pode ser cliente ou fornecedor".
//   * VENDEDOR: continua sendo um registro de `colaboradores` (o id está na
//     carteira, comissões, fichas e acesso usuário→vendedor), agora LIGADO ao
//     funcionário (colaboradores.funcionario_id). Marcar liga pelo CPF (ou nome)
//     ao colaborador do P2S, ou cria um (origem SISTEMA). O RH manda: depois de
//     cada sync de colaboradores do P2S, aplicarVendedoresDoRh reaplica a marcação
//     e a situação (funcionário desligado = vendedor inativo).
//   * CLIENTE / FORNECEDOR: cadastro de parceiro pelo CPF (folha_funcionarios.
//     parceiro_id). Sem cadastro, cria um (origem SISTEMA) com os dados da ficha.
//     Parceiro do P2S só muda lá enquanto o P2S for oficial (cadastroEditavel).
import type { supabaseAdmin } from '../supabase';
import { cadastroEditavel, salvarParceiro, cpfValido, formatarCpf } from './parceiros';

type Db = ReturnType<typeof supabaseAdmin>;
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
// a ficha guarda só os dígitos do celular; o cadastro de parceiro mostra formatado
const formatarFone = (v: unknown) => {
  const d = dig(v);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d || null;
};
const norm = (v: unknown) => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

interface Funcionario { id: string; nome_completo: string; cpf: string | null; celular: string | null; email: string | null; ativo: boolean; eh_vendedor: boolean; parceiro_id: number | null; cep: string | null; cidade: string | null; endereco: string | null; numero: string | null; complemento: string | null; bairro: string | null }

async function funcionario(db: Db, id: string): Promise<Funcionario> {
  const { data, error } = await db.from('folha_funcionarios').select('id, nome_completo, cpf, celular, email, ativo, eh_vendedor, parceiro_id, cep, cidade, endereco, numero, complemento, bairro').eq('id', id).maybeSingle();
  if (error) throw new Error(/eh_vendedor|parceiro_id/.test(error.message) ? 'Falta rodar o SQL dos papéis comerciais (.sql/Pendentes/rh_papeis_comerciais.sql).' : error.message);
  if (!data) throw new Error('Funcionário não encontrado.');
  return data as Funcionario;
}

export async function papeisDoFuncionario(db: Db, funcionarioId: string) {
  const f = await funcionario(db, funcionarioId);
  const { data: col } = await db.from('colaboradores').select('id, nome_exibicao, origem, flag_vendedor_rep, status_colaborador').eq('funcionario_id', f.id).maybeSingle();
  let parceiro: { id: number; nome: string; origem: string; codigo: number | null; flag_cliente: boolean; flag_fornecedor: boolean; editavel: boolean } | null = null;
  // o CPF atual da ficha é a chave; sem CPF válido não há cadastro de parceiro ligado
  const cpf = dig(f.cpf);
  if (cpfValido(cpf)) {
    const { data: p } = await db.from('parceiros').select('id, nome_exibicao, nome_completo, origem, p2s_oid, codigo_parceiro, flag_cliente, flag_fornecedor').eq('cpf_digitos', cpf).order('id').limit(1).maybeSingle();
    if (p) parceiro = { id: p.id, nome: p.nome_exibicao || p.nome_completo, origem: p.origem, codigo: p.codigo_parceiro, flag_cliente: !!p.flag_cliente, flag_fornecedor: !!p.flag_fornecedor, editavel: (await cadastroEditavel(db, p)).editavel };
  }
  return { vendedor: !!f.eh_vendedor, colaborador: col || null, parceiro, temCpf: cpfValido(dig(f.cpf)) };
}

/** Marca/desmarca VENDEDOR: liga (ou cria) o colaborador do funcionário. */
export async function definirVendedor(db: Db, funcionarioId: string, vendedor: boolean) {
  const f = await funcionario(db, funcionarioId);
  let { data: col } = await db.from('colaboradores').select('id').eq('funcionario_id', f.id).maybeSingle();
  if (!col && vendedor) {
    // liga ao colaborador do P2S pelo CPF; sem CPF, pelo nome (só se for único)
    const cpf = dig(f.cpf);
    if (cpf.length === 11) {
      // CPF repetido no P2S (readmissão): o vendedor, depois o ativo, depois o mais recente
      const { data } = await db.from('colaboradores').select('id, flag_vendedor_rep, status_colaborador').eq('cpf_digitos', cpf).is('funcionario_id', null);
      const ordem = (c: { id: number; flag_vendedor_rep: boolean | null; status_colaborador: string | null }) => [c.flag_vendedor_rep ? 1 : 0, c.status_colaborador === 'A' ? 1 : 0, c.id];
      const melhor = (data || []).sort((a, b) => { const x = ordem(a), y = ordem(b); return y[0] - x[0] || y[1] - x[1] || y[2] - x[2]; })[0];
      col = melhor ? { id: melhor.id } : null;
    }
    if (!col) {
      const { data } = await db.from('colaboradores').select('id, nome_completo').is('funcionario_id', null).ilike('nome_completo', f.nome_completo.trim());
      const mesmos = (data || []).filter(c => norm(c.nome_completo) === norm(f.nome_completo));
      if (mesmos.length === 1) col = { id: mesmos[0].id };
    }
    if (col) {
      const { error } = await db.from('colaboradores').update({ funcionario_id: f.id }).eq('id', col.id);
      if (error) throw new Error(error.message);
    } else {
      const { data: novo, error } = await db.from('colaboradores').insert({
        p2s_oid: null, origem: 'SISTEMA', funcionario_id: f.id, natureza: 'F',
        nome_completo: f.nome_completo.toUpperCase(), nome_exibicao: f.nome_completo.toUpperCase(),
        cpf: cpf.length === 11 ? formatarCpf(cpf) : null, telefone1: formatarFone(f.celular), email1: f.email,
        status_colaborador: f.ativo ? 'A' : 'I', flag_vendedor_rep: true, updated_at: new Date().toISOString(),
      }).select('id').single();
      if (error) throw new Error(error.message);
      col = novo;
    }
  }
  if (col) {
    const { error } = await db.from('colaboradores').update({ flag_vendedor_rep: vendedor, status_colaborador: f.ativo ? 'A' : 'I', updated_at: new Date().toISOString() }).eq('id', col.id);
    if (error) throw new Error(error.message);
  }
  const { error } = await db.from('folha_funcionarios').update({ eh_vendedor: vendedor }).eq('id', f.id);
  if (error) throw new Error(error.message);
}

/** Marca/desmarca CLIENTE ou FORNECEDOR: liga (ou cria) o parceiro do CPF do funcionário. */
export async function definirPapelParceiro(db: Db, funcionarioId: string, papel: 'cliente' | 'fornecedor', valor: boolean, usuario: string) {
  const f = await funcionario(db, funcionarioId);
  const cpf = dig(f.cpf);
  const flag = papel === 'cliente' ? 'flag_cliente' : 'flag_fornecedor';
  // O CPF é a CHAVE (pedido do usuário: nunca duplicar cadastro). A ligação sempre
  // segue o CPF atual da ficha — nunca uma ligação antiga nem o nome.
  if (!cpfValido(cpf)) throw new Error('Preencha um CPF válido na ficha (e salve) antes de marcar como cliente ou fornecedor: o CPF é a chave do cadastro.');
  const { data: doCpf } = await db.from('parceiros').select('id').eq('cpf_digitos', cpf).order('id').limit(1);
  let parceiroId: number | null = doCpf?.[0]?.id ?? null;
  if (!parceiroId) {
    if (!valor) {
      if (f.parceiro_id) await db.from('folha_funcionarios').update({ parceiro_id: null }).eq('id', f.id);
      return;
    }
    const r = await salvarParceiro(db, {
      natureza: 'F', documento: cpf, nome_completo: f.nome_completo, nome_exibicao: f.nome_completo,
      flag_cliente: papel === 'cliente', flag_fornecedor: papel === 'fornecedor', flag_transportadora: false, status_parceiro: 'A',
      cep1: f.cep, endereco1: f.endereco, numero1: f.numero, complemento1: f.complemento, bairro1: f.bairro, cidade1: f.cidade,
      telefone1: formatarFone(f.celular), email1: f.email, contatos: [], enderecos: [],
      observacoes: 'Cadastro criado a partir da Ficha do RH.',
    }, usuario);
    parceiroId = r.id;
  } else {
    const { data: p, error } = await db.from('parceiros').select('id, origem, p2s_oid, codigo_parceiro, flag_cliente, flag_fornecedor').eq('id', parceiroId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!p) throw new Error('Parceiro ligado não encontrado.');
    if (Boolean(p[flag]) !== valor) {
      const e = await cadastroEditavel(db, p);
      if (!e.editavel) throw new Error(`Este CPF já é parceiro no P2S (código ${p.codigo_parceiro ?? p.id}). Enquanto o P2S for oficial, marque ${papel} lá; a mudança chega aqui na sincronização.`);
      const { error: eU } = await db.from('parceiros').update({ [flag]: valor, updated_at: new Date().toISOString(), atualizado_por: usuario }).eq('id', p.id);
      if (eU) throw new Error(eU.message);
    }
  }
  if (parceiroId !== f.parceiro_id) {
    const { error } = await db.from('folha_funcionarios').update({ parceiro_id: parceiroId }).eq('id', f.id);
    if (error) throw new Error(error.message);
  }
}

/** Depois de salvar a ficha: situação do vendedor e parceiro pelo CPF atual. Nunca falha o salvar. */
export async function alinharPapeisDaFicha(db: Db, funcionarioId: string): Promise<void> {
  try {
    const f = await funcionario(db, funcionarioId);
    await db.from('colaboradores').update({ status_colaborador: f.ativo ? 'A' : 'I' }).eq('funcionario_id', f.id);
    const cpf = dig(f.cpf);
    let parceiroId: number | null = null;
    if (cpfValido(cpf)) {
      const { data } = await db.from('parceiros').select('id').eq('cpf_digitos', cpf).order('id').limit(1);
      parceiroId = data?.[0]?.id ?? null;
    }
    if (parceiroId !== f.parceiro_id) await db.from('folha_funcionarios').update({ parceiro_id: parceiroId }).eq('id', f.id);
  } catch { /* sem o SQL ainda, ou falha pontual: o painel recalcula ao abrir */ }
}

/** Depois de cada sync de colaboradores do P2S: o RH manda na marcação de vendedor e na situação. */
export async function aplicarVendedoresDoRh(db: Db): Promise<number> {
  const { data, error } = await db.from('colaboradores').select('id, flag_vendedor_rep, status_colaborador, funcionario:folha_funcionarios(eh_vendedor, ativo)').not('funcionario_id', 'is', null);
  if (error) return 0; // sem o SQL ainda: nada a reaplicar
  let n = 0;
  for (const c of (data || []) as unknown as { id: number; flag_vendedor_rep: boolean; status_colaborador: string | null; funcionario: { eh_vendedor: boolean; ativo: boolean } | null }[]) {
    if (!c.funcionario) continue;
    const status = c.funcionario.ativo ? 'A' : 'I';
    if (c.flag_vendedor_rep === c.funcionario.eh_vendedor && c.status_colaborador === status) continue;
    await db.from('colaboradores').update({ flag_vendedor_rep: c.funcionario.eh_vendedor, status_colaborador: status }).eq('id', c.id);
    n++;
  }
  return n;
}
