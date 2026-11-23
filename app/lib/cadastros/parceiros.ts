// app/lib/cadastros/parceiros.ts
// Cadastro PRÓPRIO de clientes e fornecedores (2026-11-23). Só servidor, SEM
// checagem de acesso (quem chama valida rota). Decisões do usuário:
//   * a origem do cadastro passa a ser o sistema quando a ÚLTIMA empresa ativa
//     congelar o P2S (os cadastros são um só para Rentech e Alfa Light);
//   * antes disso o sistema já cadastra (origem SISTEMA) e, quando o mesmo
//     CPF/CNPJ chega do P2S, o cadastro daqui é ADOTADO (ganha o p2s_oid e
//     passa a seguir o P2S, que ainda é o oficial) — sem duplicar;
//   * cliente vindo do P2S é só leitura aqui até a virada; a carteira do
//     vendedor (tabela própria) pode mudar sempre;
//   * ajudas: dados pelo CNPJ (BrasilAPI, consulta pública) e endereço pelo CEP
//     (ViaCEP). Só o CNPJ/CEP sai do sistema.
import type { supabaseAdmin } from '../supabase';
import { empresasCongeladas } from '../virada/estado';

type Db = ReturnType<typeof supabaseAdmin>;

export const dig = (s: unknown) => String(s ?? '').replace(/\D/g, '');

export function cpfValido(c: string): boolean {
  const d = dig(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (k: number) => { let s = 0; for (let i = 0; i < k; i++) s += Number(d[i]) * (k + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(c: string): boolean {
  const d = dig(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (k: number) => {
    const pesos = k === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((acc, p, i) => acc + Number(d[i]) * p, 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

export const formatarCnpj = (c: string) => dig(c).replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
export const formatarCpf = (c: string) => dig(c).replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
export const formatarCep = (c: string) => dig(c).replace(/^(\d{5})(\d{3})$/, '$1-$2');

/** true = todas as empresas ativas já congelaram o P2S: o cadastro é do sistema. */
export async function cadastrosNoSistema(db: Db): Promise<boolean> {
  const [congeladas, { data, error }] = await Promise.all([
    empresasCongeladas(db),
    db.from('empresas').select('id').eq('ativo', true),
  ]);
  if (error) return false;
  const ativas = ((data || []) as { id: number }[]).map(e => e.id);
  return ativas.length > 0 && ativas.every(id => congeladas.has(id));
}

// ============================================================================
// SINCRONIZAÇÃO DO P2S: adoção pelo documento e respeito à origem
// ============================================================================
type RegistroP2s = { p2s_oid: string; cnpj: string | null; cpf: string | null } & Record<string, unknown>;

/**
 * Recebe as linhas convertidas do P2S e devolve o que ainda deve ir para o
 * upsert por p2s_oid. Antes da virada: adota (por CPF/CNPJ) o cadastro feito
 * aqui sem p2s_oid — a linha do P2S sobrescreve o cadastro, que mantém o id.
 * Depois da virada: só entra parceiro que ainda não existe aqui (nem por oid
 * nem por documento); nada é sobrescrito.
 */
export async function prepararGravacaoP2s<T extends RegistroP2s>(db: Db, registros: T[]): Promise<{ paraUpsert: T[]; adotados: number; ignorados: number }> {
  if (!registros.length) return { paraUpsert: [], adotados: 0, ignorados: 0 };
  const sistema = await cadastrosNoSistema(db);
  const existentes = new Set<string>();
  const oids = registros.map(r => r.p2s_oid);
  for (let i = 0; i < oids.length; i += 300) {
    const { data, error } = await db.from('parceiros').select('p2s_oid').in('p2s_oid', oids.slice(i, i + 300));
    if (error) throw new Error(error.message);
    for (const r of (data || []) as { p2s_oid: string }[]) existentes.add(r.p2s_oid);
  }
  const novos = registros.filter(r => !existentes.has(r.p2s_oid));
  const docDe = (r: RegistroP2s) => { const c = dig(r.cnpj), p = dig(r.cpf); return c.length === 14 ? c : p.length === 11 ? p : ''; };
  const docs = [...new Set(novos.map(docDe).filter(Boolean))];
  const locais = new Map<string, number>();
  for (let i = 0; i < docs.length; i += 200) {
    const lote = docs.slice(i, i + 200);
    const { data, error } = await db.from('parceiros').select('id, cnpj_digitos, cpf_digitos').is('p2s_oid', null)
      .or(`cnpj_digitos.in.(${lote.join(',')}),cpf_digitos.in.(${lote.join(',')})`);
    if (error) throw new Error(error.message);
    for (const r of (data || []) as { id: number; cnpj_digitos: string | null; cpf_digitos: string | null }[]) for (const d of [r.cnpj_digitos, r.cpf_digitos]) if (d && !locais.has(d)) locais.set(d, r.id);
  }
  const paraUpsert: T[] = [];
  let adotados = 0, ignorados = 0;
  for (const r of registros) {
    const jaExiste = existentes.has(r.p2s_oid);
    const doc = jaExiste ? '' : docDe(r);
    const localId = doc ? locais.get(doc) : undefined;
    if (sistema) {
      if (jaExiste || localId) { ignorados++; continue; }
      paraUpsert.push(r);
      continue;
    }
    if (localId) {
      locais.delete(doc); // dois do P2S com o mesmo documento: só o primeiro adota
      const { error } = await db.from('parceiros').update({ ...r, origem: 'P2S' }).eq('id', localId);
      if (error) throw new Error(error.message);
      adotados++;
      continue;
    }
    paraUpsert.push(r);
  }
  return { paraUpsert, adotados, ignorados };
}

// ============================================================================
// CADASTRO
// ============================================================================
export interface ContatoParceiro { nome: string | null; cargo: string | null; departamento: string | null; telefone: string | null; email: string | null; principal: boolean }
export interface EnderecoParceiro { tipo: string | null; endereco_completo: string | null; cidade: string | null; estado: string | null; cep: string | null; observacoes: string | null }

export interface DadosParceiro {
  id?: number | null;
  natureza: 'J' | 'F';
  documento: string;
  nome_completo: string;
  nome_exibicao?: string | null;
  inscricao_estadual?: string | null;
  inscricao_municipal?: string | null;
  flag_cliente: boolean;
  flag_fornecedor: boolean;
  flag_transportadora: boolean;
  status_parceiro: string; // A = ativo, B = bloqueado (outros códigos do P2S são mantidos)
  motivo_bloqueio?: string | null;
  cep1?: string | null; endereco1?: string | null; numero1?: string | null; complemento1?: string | null;
  bairro1?: string | null; cidade1?: string | null; estado1?: string | null;
  telefone1?: string | null; telefone2?: string | null;
  email1?: string | null; email2?: string | null; site?: string | null;
  observacoes?: string | null;
  contatos: ContatoParceiro[];
  enderecos: EnderecoParceiro[];
}

const txt = (v: unknown, max = 300) => { const s = String(v ?? '').trim().replace(/\s+/g, ' '); return s ? s.slice(0, max) : null; };
const emailOk = (e: string) => e.split(/\s*[;,]\s*/).filter(Boolean).every(x => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x));

/** Pode editar os dados do cadastro? (a carteira pode sempre) */
export async function cadastroEditavel(db: Db, parceiro: { origem?: string | null; p2s_oid?: string | null }): Promise<{ editavel: boolean; motivo: string | null }> {
  if (parceiro.origem === 'SISTEMA' && !parceiro.p2s_oid) return { editavel: true, motivo: null };
  if (await cadastrosNoSistema(db)) return { editavel: true, motivo: null };
  return { editavel: false, motivo: 'Cadastro do P2S: enquanto o P2S for oficial, altere lá; a mudança chega aqui na sincronização (11h e 17h). Aqui dá para mudar a carteira do vendedor.' };
}

/** Outro parceiro com o mesmo CPF/CNPJ (para não duplicar). */
export async function parceiroComDocumento(db: Db, documento: string, exceto?: number | null) {
  const d = dig(documento);
  if (d.length !== 11 && d.length !== 14) return null;
  let q = db.from('parceiros').select('id, codigo_parceiro, nome_exibicao, nome_completo').eq(d.length === 14 ? 'cnpj_digitos' : 'cpf_digitos', d).limit(1);
  if (exceto) q = q.neq('id', exceto);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data?.[0] as { id: number; codigo_parceiro: number | null; nome_exibicao: string | null; nome_completo: string | null } | undefined) || null;
}

export async function salvarParceiro(db: Db, d: DadosParceiro, usuario: string): Promise<{ id: number; codigo: number | null; novo: boolean }> {
  const natureza = d.natureza === 'F' ? 'F' : 'J';
  const doc = dig(d.documento);
  if (natureza === 'J' && !cnpjValido(doc)) throw new Error('CNPJ inválido. Confira os 14 dígitos.');
  if (natureza === 'F' && !cpfValido(doc)) throw new Error('CPF inválido. Confira os 11 dígitos.');
  const nome = txt(d.nome_completo, 200);
  if (!nome) throw new Error(natureza === 'J' ? 'Informe a razão social.' : 'Informe o nome completo.');
  if (!d.flag_cliente && !d.flag_fornecedor && !d.flag_transportadora) throw new Error('Marque se é cliente, fornecedor ou transportadora.');
  const cep = dig(d.cep1);
  if (cep && cep.length !== 8) throw new Error('CEP com 8 dígitos.');
  const uf = txt(d.estado1, 2)?.toUpperCase() || null;
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new Error('UF com 2 letras (ex.: SP).');
  for (const e of [d.email1, d.email2]) if (txt(e) && !emailOk(String(e))) throw new Error(`E-mail inválido: ${e}`);
  const status = txt(d.status_parceiro, 2) || 'A';
  if (status === 'B' && !txt(d.motivo_bloqueio)) throw new Error('Informe o motivo do bloqueio.');

  let atual: { id: number; origem: string | null; p2s_oid: string | null; codigo_parceiro: number | null } | null = null;
  if (d.id) {
    const { data, error } = await db.from('parceiros').select('id, origem, p2s_oid, codigo_parceiro').eq('id', d.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Parceiro não encontrado.');
    const e = await cadastroEditavel(db, data);
    if (!e.editavel) throw new Error(e.motivo || 'Cadastro só para leitura.');
    atual = data;
  }
  const dup = await parceiroComDocumento(db, doc, d.id || null);
  if (dup) throw new Error(`Já existe um cadastro com este ${natureza === 'J' ? 'CNPJ' : 'CPF'}: ${dup.nome_exibicao || dup.nome_completo} (código ${dup.codigo_parceiro ?? dup.id}).`);

  const contatos = (d.contatos || []).map(c => ({
    nome: txt(c.nome, 120), cargo: txt(c.cargo, 80), departamento: txt(c.departamento, 80), telefone: txt(c.telefone, 40), email: txt(c.email, 120), principal: !!c.principal,
  })).filter(c => c.nome || c.telefone || c.email);
  for (const c of contatos) if (c.email && !emailOk(c.email)) throw new Error(`E-mail inválido no contato ${c.nome || ''}: ${c.email}`);
  const enderecos = (d.enderecos || []).map(e => ({
    tipo: txt(e.tipo, 40), endereco_completo: txt(e.endereco_completo, 300), cidade: txt(e.cidade, 80), estado: txt(e.estado, 2)?.toUpperCase() || null, cep: dig(e.cep) ? formatarCep(dig(e.cep)) : null, observacoes: txt(e.observacoes, 300),
  })).filter(e => e.endereco_completo || e.cidade);

  const agora = new Date().toISOString();
  const linha: Record<string, unknown> = {
    natureza,
    cnpj: natureza === 'J' ? formatarCnpj(doc) : null,
    cpf: natureza === 'F' ? formatarCpf(doc) : null,
    nome_completo: nome.toUpperCase(),
    nome_exibicao: (txt(d.nome_exibicao, 120) || nome).toUpperCase(),
    inscricao_estadual: txt(d.inscricao_estadual, 30),
    inscricao_municipal: txt(d.inscricao_municipal, 30),
    flag_cliente: !!d.flag_cliente, flag_fornecedor: !!d.flag_fornecedor, flag_transportadora: !!d.flag_transportadora,
    status_parceiro: status,
    motivo_bloqueio: status === 'B' ? txt(d.motivo_bloqueio, 300) : null,
    cep1: cep ? formatarCep(cep) : null,
    endereco1: txt(d.endereco1, 200)?.toUpperCase() || null, numero1: txt(d.numero1, 20), complemento1: txt(d.complemento1, 80)?.toUpperCase() || null,
    bairro1: txt(d.bairro1, 80)?.toUpperCase() || null, cidade1: txt(d.cidade1, 80)?.toUpperCase() || null, estado1: uf, pais1: 'BRASIL',
    telefone1: txt(d.telefone1, 40), telefone2: txt(d.telefone2, 40),
    email1: txt(d.email1, 200)?.toLowerCase() || null, email2: txt(d.email2, 200)?.toLowerCase() || null, site: txt(d.site, 200),
    observacoes: txt(d.observacoes, 2000),
    contatos: contatos.length ? contatos : null,
    enderecos: enderecos.length ? enderecos : null,
    data_ultima_alteracao_cadastro: agora.slice(0, 10),
    atualizado_por: usuario,
    updated_at: agora,
  };

  if (atual) {
    const { error } = await db.from('parceiros').update(linha).eq('id', atual.id);
    if (error) throw new Error(error.message);
    return { id: atual.id, codigo: atual.codigo_parceiro ?? null, novo: false };
  }
  const { data: cod, error: eCod } = await db.rpc('proximo_codigo_parceiro_sistema');
  if (eCod) throw new Error(/function|does not exist/i.test(eCod.message) ? 'Falta rodar o SQL do cadastro de parceiros (.sql/Pendentes/parceiros_cadastro_proprio.sql).' : eCod.message);
  const { data: novo, error } = await db.from('parceiros').insert({
    ...linha, origem: 'SISTEMA', p2s_oid: null, codigo_parceiro: Number(cod),
    data_cadastro: agora.slice(0, 10), login_cadastro: usuario, criado_por: usuario,
  }).select('id, codigo_parceiro').single();
  if (error) throw new Error(error.message);
  return { id: novo.id as number, codigo: (novo.codigo_parceiro as number) ?? null, novo: true };
}

// ============================================================================
// AJUDAS DE PREENCHIMENTO (consultas públicas)
// ============================================================================
const CABECALHOS = { Accept: 'application/json', 'User-Agent': 'rentech-web-cadastro' };

export interface DadosCnpj {
  razao_social: string | null; nome_fantasia: string | null; situacao: string | null;
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null;
  bairro: string | null; cidade: string | null; uf: string | null; telefone: string | null; email: string | null;
}

export async function consultarCnpj(cnpj: string): Promise<DadosCnpj> {
  const d = dig(cnpj);
  if (!cnpjValido(d)) throw new Error('CNPJ inválido.');
  const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { headers: CABECALHOS, signal: AbortSignal.timeout(12000), cache: 'no-store' });
  if (r.status === 404) throw new Error('CNPJ não encontrado na Receita.');
  if (!r.ok) throw new Error(`Consulta do CNPJ indisponível agora (HTTP ${r.status}). Preencha à mão.`);
  const j = (await r.json()) as Record<string, unknown>;
  const logradouro = [j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' ').trim();
  const tel = dig(j.ddd_telefone_1);
  return {
    razao_social: txt(j.razao_social), nome_fantasia: txt(j.nome_fantasia), situacao: txt(j.descricao_situacao_cadastral),
    cep: dig(j.cep) ? formatarCep(dig(j.cep)) : null, logradouro: txt(logradouro), numero: txt(j.numero), complemento: txt(j.complemento),
    bairro: txt(j.bairro), cidade: txt(j.municipio), uf: txt(j.uf, 2),
    telefone: tel.length >= 10 ? `(${tel.slice(0, 2)}) ${tel.slice(2, -4)}-${tel.slice(-4)}` : null,
    email: txt(j.email)?.toLowerCase() || null,
  };
}

export interface DadosCep { logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null }

export async function consultarCep(cep: string): Promise<DadosCep> {
  const d = dig(cep);
  if (d.length !== 8) throw new Error('CEP com 8 dígitos.');
  const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { headers: CABECALHOS, signal: AbortSignal.timeout(10000), cache: 'no-store' });
  if (!r.ok) throw new Error(`Consulta do CEP indisponível agora (HTTP ${r.status}). Preencha à mão.`);
  const j = (await r.json()) as Record<string, unknown>;
  if (j.erro) throw new Error('CEP não encontrado.');
  return { logradouro: txt(j.logradouro), bairro: txt(j.bairro), cidade: txt(j.localidade), uf: txt(j.uf, 2) };
}
