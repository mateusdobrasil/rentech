'use server';

// app/admin/parametros/empresas/actions.ts
// Cadastro das empresas (ficha em abas) e o cofre de credenciais.
//  * Cadastro: quem tem acesso à rota /admin/parametros/empresas. Antes a tela
//    gravava direto do navegador; agora tudo passa por aqui (lista branca de
//    colunas, auditoria).
//  * Credenciais: SÓ Administrador (ehAdministradorGlobal) com 2FA confirmado
//    na sessão — mesmo que a rota não exija 2FA. Nenhum valor volta para o
//    navegador: só "configurado", o final do valor (dica) e quem trocou.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, sessaoCumpre2fa, type PerfilValidado } from '../../../lib/serverAuth';
import { ehAdministradorGlobal } from '../../../lib/permissoes';
import { registrarLogAuditoria } from '../../../actions';
import { SERVICOS_COFRE, CAMPOS_COFRE } from '../../../lib/cofre/catalogo';
import { cofreDisponivel, gravarNoCofre, removerDoCofre, situacaoCofre, resolverSegredo } from '../../../lib/cofre/segredos';
import { infoCertificado } from '../../../lib/ponto/assinaturaCades';

type Resultado<T = unknown> = { ok: boolean; erro?: string; info?: T };
const ROTA = '/admin/parametros/empresas';
const SETOR = 'PARÂMETROS / EMPRESAS';
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const txt = (v: unknown, max = 500) => { const t = String(v ?? '').trim(); return t ? t.slice(0, max) : null; };

// ============================================================================
// CADASTRO
// ============================================================================
export interface EmpresaCadastro {
  id: number; nome: string; ativo: boolean;
  [coluna: string]: unknown;
}

export interface DadosTelaEmpresas {
  empresas: EmpresaCadastro[];
  funcionarios: Record<number, number>;
  podeCredenciais: boolean;   // é Administrador (o 2FA é pedido ao abrir a aba)
  cofreAtivo: boolean;        // COFRE_CHAVE_MESTRA presente no servidor
  sqlCadastro: boolean;       // colunas novas existem
}

export async function dadosEmpresasAction(accessToken: string): Promise<Resultado<DadosTelaEmpresas>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const db = supabaseAdmin();
  const [emp, func] = await Promise.all([
    db.from('empresas').select('*').order('nome'),
    db.from('folha_funcionarios').select('empresa_id'),
  ]);
  if (emp.error) return { ok: false, erro: emp.error.message };
  const funcionarios: Record<number, number> = {};
  for (const f of (func.data || []) as { empresa_id: number | null }[]) if (f.empresa_id) funcionarios[f.empresa_id] = (funcionarios[f.empresa_id] || 0) + 1;
  const empresas = (emp.data || []) as EmpresaCadastro[];
  return {
    ok: true,
    info: {
      empresas, funcionarios,
      podeCredenciais: ehAdministradorGlobal(acesso.perfil.permissaoBruta),
      cofreAtivo: cofreDisponivel(),
      sqlCadastro: empresas.length === 0 || empresas.some(e => 'logradouro' in e),
    },
  };
}

// Colunas que a tela pode gravar (lista branca) e como limpar cada uma.
const TEXTO: Record<string, number> = {
  nome_curto: 40, razao_social: 200, nome_fantasia: 200, cnae_principal: 10, cnae_descricao: 200, cno_caepf: 20,
  inscricao_estadual: 30, inscricao_municipal: 30, logradouro: 200, numero: 20, complemento: 100, bairro: 100, cidade: 100,
  codigo_ibge: 7, telefone: 30, email_contato: 120, email_financeiro: 120, email_fiscal: 120, site: 200,
  responsavel_nome: 120, responsavel_cargo: 60, contador_nome: 120, contador_crc: 30, contador_email: 120, contador_telefone: 30,
  banco_codigo: 3, banco_agencia: 10, banco_conta: 20, pix_chave: 120,
  contrato_representante_nome: 120, contrato_representante_email: 120, contrato_representante_celular: 30,
  proposta_condicoes: 20000, proposta_extras: 20000, contrato_clausulas: 100000, observacoes: 4000,
};
const NOVAS = new Set(['nome_fantasia', 'regime_tributario', 'cnae_principal', 'cnae_descricao', 'data_abertura', 'cno_caepf', 'cep', 'logradouro', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'codigo_ibge', 'email_financeiro', 'email_fiscal', 'responsavel_nome', 'responsavel_cpf', 'responsavel_cargo', 'contador_nome', 'contador_crc', 'contador_email', 'contador_telefone', 'banco_codigo', 'banco_agencia', 'banco_conta', 'pix_chave', 'observacoes']);

/** "Rua X, 100 - Sala 2 - Bairro - Cidade/UF - CEP 00000-000" (o texto que proposta e contrato já usam). */
function enderecoTexto(f: Record<string, unknown>): string | null {
  const rua = [txt(f.logradouro), txt(f.numero)].filter(Boolean).join(', ');
  const cidadeUf = [txt(f.cidade), txt(f.uf)].filter(Boolean).join('/');
  const cep = dig(f.cep).length === 8 ? `CEP ${dig(f.cep).replace(/(\d{5})(\d{3})/, '$1-$2')}` : null;
  const partes = [rua, txt(f.complemento), txt(f.bairro), cidadeUf, cep].filter(Boolean);
  return partes.length ? partes.join(' - ') : null;
}

export async function salvarEmpresaAction(payload: { id: number | null; dados: Record<string, unknown> }, accessToken: string): Promise<Resultado<{ id: number }>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const d = payload.dados || {};
  const nome = String(d.nome || '').trim().toUpperCase();
  if (!nome) return { ok: false, erro: 'Informe o nome da empresa.' };
  const cnpj = dig(d.cnpj);
  if (cnpj && cnpj.length !== 14) return { ok: false, erro: 'CNPJ com 14 dígitos.' };
  const respCpf = dig(d.responsavel_cpf);
  if (respCpf && respCpf.length !== 11) return { ok: false, erro: 'CPF do responsável com 11 dígitos.' };
  const uf = String(d.uf || '').trim().toUpperCase();
  if (uf && !/^[A-Z]{2}$/.test(uf)) return { ok: false, erro: 'UF com 2 letras.' };
  const regime = String(d.regime_tributario || '');
  if (regime && !['MEI', 'SIMPLES', 'PRESUMIDO', 'REAL'].includes(regime)) return { ok: false, erro: 'Regime tributário inválido.' };
  const abertura = String(d.data_abertura || '');
  if (abertura && !/^\d{4}-\d{2}-\d{2}$/.test(abertura)) return { ok: false, erro: 'Data de abertura inválida.' };

  const db = supabaseAdmin();
  // só grava as colunas que já existem (o SQL novo pode não ter rodado ainda)
  const { data: amostra } = await db.from('empresas').select('*').limit(1);
  const existe = (c: string) => !amostra?.length || c in amostra[0] || !NOVAS.has(c);

  const linha: Record<string, unknown> = { nome, cnpj: cnpj || null, ativo: d.ativo !== false };
  for (const [col, max] of Object.entries(TEXTO)) if (col in d && existe(col)) linha[col] = txt(d[col], max);
  if (existe('cep')) linha.cep = dig(d.cep) || null;
  if (existe('uf')) linha.uf = uf || null;
  if (existe('regime_tributario')) linha.regime_tributario = regime || null;
  if (existe('data_abertura')) linha.data_abertura = abertura || null;
  if (existe('responsavel_cpf')) linha.responsavel_cpf = respCpf || null;
  if ('fonte_recebimentos' in d) linha.fonte_recebimentos = d.fonte_recebimentos === 'EXTERNA' ? 'EXTERNA' : 'P2S';
  if ('cnpjs_p2s' in d) linha.cnpjs_p2s = [...new Set(String(d.cnpjs_p2s || '').split(/[,;\n]+/).map(dig).filter(c => c.length === 14))];
  if ('proposta_validade_dias' in d) linha.proposta_validade_dias = Math.max(1, Math.min(90, Number(d.proposta_validade_dias) || 7));
  // endereço estruturado preenchido → o texto único acompanha (proposta/contrato)
  if (existe('logradouro') && txt(d.logradouro)) linha.endereco = enderecoTexto(d);
  else if ('endereco' in d) linha.endereco = txt(d.endereco, 400);

  const { data, error } = payload.id
    ? await db.from('empresas').update(linha).eq('id', payload.id).select('id').single()
    : await db.from('empresas').insert(linha).select('id').single();
  if (error) return { ok: false, erro: error.code === '23505' ? 'Já existe uma empresa com este nome ou CNPJ.' : error.message };
  await registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: payload.id ? 'ATUALIZOU EMPRESA' : 'CADASTROU EMPRESA', setor: SETOR, equipamento_nome: nome });
  return { ok: true, info: { id: data.id } };
}

export async function excluirEmpresaAction(id: number, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const db = supabaseAdmin();
  const { data: e } = await db.from('empresas').select('nome').eq('id', id).maybeSingle();
  if (!e) return { ok: false, erro: 'Empresa não encontrada.' };
  const { error } = await db.from('empresas').delete().eq('id', id);
  if (error) return { ok: false, erro: /foreign key|violates/i.test(error.message) ? 'A empresa tem registros ligados a ela (fichas, títulos, notas…). Desative em vez de excluir.' : error.message };
  await registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: 'REMOVEU EMPRESA', setor: SETOR, equipamento_nome: e.nome });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Ajudas de preenchimento (consultas públicas)
// ---------------------------------------------------------------------------
export interface DadosReceita {
  razao_social: string | null; nome_fantasia: string | null; situacao: string | null; data_abertura: string | null;
  cnae_principal: string | null; cnae_descricao: string | null; regime_tributario: 'SIMPLES' | 'MEI' | null;
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null;
  cidade: string | null; uf: string | null; codigo_ibge: string | null; telefone: string | null; email: string | null;
}

export async function consultarCnpjEmpresaAction(cnpj: string, accessToken: string): Promise<Resultado<DadosReceita>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const d = dig(cnpj);
  if (d.length !== 14) return { ok: false, erro: 'CNPJ com 14 dígitos.' };
  try {
    const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`, { headers: { Accept: 'application/json', 'User-Agent': 'rentech-web-cadastro' }, signal: AbortSignal.timeout(12000), cache: 'no-store' });
    if (r.status === 404) return { ok: false, erro: 'CNPJ não encontrado na Receita.' };
    if (!r.ok) return { ok: false, erro: `Consulta indisponível agora (HTTP ${r.status}). Preencha à mão.` };
    const j = (await r.json()) as Record<string, unknown>;
    const tel = dig(j.ddd_telefone_1);
    const cnae = dig(j.cnae_fiscal);
    return {
      ok: true,
      info: {
        razao_social: txt(j.razao_social), nome_fantasia: txt(j.nome_fantasia), situacao: txt(j.descricao_situacao_cadastral),
        data_abertura: /^\d{4}-\d{2}-\d{2}$/.test(String(j.data_inicio_atividade || '')) ? String(j.data_inicio_atividade) : null,
        cnae_principal: cnae ? cnae.replace(/^(\d{4})(\d)(\d{2})$/, '$1-$2/$3') : null, cnae_descricao: txt(j.cnae_fiscal_descricao),
        regime_tributario: j.opcao_pelo_mei ? 'MEI' : j.opcao_pelo_simples ? 'SIMPLES' : null,
        cep: dig(j.cep) || null, logradouro: txt([j.descricao_tipo_de_logradouro, j.logradouro].filter(Boolean).join(' ')),
        numero: txt(j.numero), complemento: txt(j.complemento), bairro: txt(j.bairro), cidade: txt(j.municipio), uf: txt(j.uf, 2),
        codigo_ibge: dig(j.codigo_municipio_ibge) || null,
        telefone: tel.length >= 10 ? `(${tel.slice(0, 2)}) ${tel.slice(2, -4)}-${tel.slice(-4)}` : null,
        email: txt(j.email)?.toLowerCase() || null,
      },
    };
  } catch {
    return { ok: false, erro: 'Consulta da Receita indisponível agora. Preencha à mão.' };
  }
}

export async function consultarCepEmpresaAction(cep: string, accessToken: string): Promise<Resultado<{ logradouro: string | null; bairro: string | null; cidade: string | null; uf: string | null; codigo_ibge: string | null }>> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const d = dig(cep);
  if (d.length !== 8) return { ok: false, erro: 'CEP com 8 dígitos.' };
  try {
    const r = await fetch(`https://viacep.com.br/ws/${d}/json/`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(10000), cache: 'no-store' });
    if (!r.ok) return { ok: false, erro: `Consulta do CEP indisponível (HTTP ${r.status}).` };
    const j = (await r.json()) as Record<string, unknown>;
    if (j.erro) return { ok: false, erro: 'CEP não encontrado.' };
    return { ok: true, info: { logradouro: txt(j.logradouro), bairro: txt(j.bairro), cidade: txt(j.localidade), uf: txt(j.uf, 2), codigo_ibge: dig(j.ibge) || null } };
  } catch {
    return { ok: false, erro: 'Consulta do CEP indisponível agora.' };
  }
}

// ============================================================================
// COFRE DE CREDENCIAIS — Administrador + 2FA
// ============================================================================
async function exigirAdmin2fa(accessToken: string): Promise<{ ok: true; perfil: PerfilValidado } | { ok: false; erro: string; precisa2fa?: boolean }> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  if (!ehAdministradorGlobal(acesso.perfil.permissaoBruta)) return { ok: false, erro: 'Só o Administrador vê e troca as credenciais.' };
  if (!(await sessaoCumpre2fa(accessToken, acesso.perfil.id))) return { ok: false, erro: 'Confirme o código do 2FA para abrir as credenciais.', precisa2fa: true };
  return { ok: true, perfil: acesso.perfil };
}

async function nomeEscopo(empresaId: number | null): Promise<string> {
  if (empresaId === null) return 'SISTEMA';
  const { data } = await supabaseAdmin().from('empresas').select('nome').eq('id', empresaId).maybeSingle();
  return data?.nome || `empresa ${empresaId}`;
}

function campoDoEscopo(nome: string, empresaId: number | null) {
  const c = CAMPOS_COFRE.get(nome);
  if (!c) return null;
  return (c.servico.escopo === 'SISTEMA') === (empresaId === null) ? c : null;
}

export interface SituacaoCampo { nome: string; origem: 'COFRE' | 'VERCEL' | null; dica: string | null; metadados: Record<string, unknown>; atualizadoEm: string | null; atualizadoPor: string | null }

export async function situacaoCredenciaisAction(empresaId: number | null, accessToken: string): Promise<Resultado<{ campos: SituacaoCampo[]; cofreAtivo: boolean }>> {
  const g = await exigirAdmin2fa(accessToken);
  if (!g.ok) return { ok: false, erro: g.erro, info: g.precisa2fa ? { campos: [], cofreAtivo: false } : undefined };
  const db = supabaseAdmin();
  const doEscopo = await situacaoCofre(db, empresaId);
  const escopo = empresaId === null ? 'SISTEMA' : 'EMPRESA';
  const campos: SituacaoCampo[] = [];
  for (const s of SERVICOS_COFRE.filter(x => x.escopo === escopo)) {
    for (const c of s.campos) {
      const l = doEscopo.find(x => x.nome === c.nome);
      if (l) { campos.push({ nome: c.nome, origem: 'COFRE', dica: l.dica, metadados: l.metadados || {}, atualizadoEm: l.atualizado_em, atualizadoPor: l.atualizado_por }); continue; }
      // fora do cofre: diz só SE a Vercel tem (nunca o valor)
      const r = await resolverSegredo(c.nome, empresaId);
      campos.push({ nome: c.nome, origem: r.origem === 'VERCEL' ? 'VERCEL' : null, dica: null, metadados: {}, atualizadoEm: null, atualizadoPor: null });
    }
  }
  return { ok: true, info: { campos, cofreAtivo: cofreDisponivel() } };
}

function dicaDe(tipo: string, valor: string): string {
  if (tipo === 'texto') return valor.length > 60 ? `${valor.slice(0, 57)}…` : valor;
  if (tipo === 'arquivo') return `arquivo de ${Math.max(1, Math.round(Buffer.from(valor, 'base64').length / 1024))} KB`;
  return valor.length >= 8 ? `••••${valor.slice(-4)}` : '••••';
}

export async function salvarCredencialAction(payload: { empresaId: number | null; nome: string; valor: string }, accessToken: string): Promise<Resultado> {
  const g = await exigirAdmin2fa(accessToken);
  if (!g.ok) return { ok: false, erro: g.erro };
  const c = campoDoEscopo(payload.nome, payload.empresaId);
  if (!c || c.servico.certificadoA1) return { ok: false, erro: 'Campo inválido para esta ficha.' };
  let valor = String(payload.valor ?? '');
  if (c.campo.tipo !== 'arquivo') valor = valor.trim();
  if (!valor) return { ok: false, erro: 'Informe o valor.' };
  if (valor.length > 200_000) return { ok: false, erro: 'Valor grande demais.' };
  if (c.campo.tipo === 'arquivo') {
    // arquivo chega em base64; PEM/KEY precisa ser texto "-----BEGIN"
    const texto = Buffer.from(valor, 'base64').toString('utf8');
    if (!/-----BEGIN [A-Z ]+-----/.test(texto)) return { ok: false, erro: 'O arquivo não parece um certificado/chave PEM (falta "-----BEGIN").' };
  }
  const db = supabaseAdmin();
  try {
    await gravarNoCofre(db, { empresaId: payload.empresaId, nome: c.campo.nome, valor, dica: dicaDe(c.campo.tipo, valor), usuario: g.perfil.nome });
    await registrarLogAuditoria({ usuario_nome: g.perfil.nome, acao: `COFRE: GRAVOU ${c.campo.nome} (${c.servico.titulo}) — ${await nomeEscopo(payload.empresaId)}`, setor: SETOR });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

export async function salvarCertificadoA1Action(payload: { empresaId: number; pfxBase64: string; senha: string }, accessToken: string): Promise<Resultado<{ titular: string; validoAte: string }>> {
  const g = await exigirAdmin2fa(accessToken);
  if (!g.ok) return { ok: false, erro: g.erro };
  const pfx = String(payload.pfxBase64 || '').replace(/\s/g, '');
  const senha = String(payload.senha || '');
  if (!pfx || !senha) return { ok: false, erro: 'Envie o arquivo .pfx e a senha.' };
  if (pfx.length > 60_000) return { ok: false, erro: 'Arquivo grande demais para um certificado A1.' };
  const db = supabaseAdmin();
  const { data: emp } = await db.from('empresas').select('nome, cnpj').eq('id', payload.empresaId).maybeSingle();
  if (!emp) return { ok: false, erro: 'Empresa não encontrada.' };
  let info: { titular: string; validoAte: string };
  try { info = infoCertificado({ pfxBase64: pfx, senha }); } catch { return { ok: false, erro: 'Não abriu o certificado: confira o arquivo .pfx e a senha.' }; }
  const cnpjCert = dig(info.titular.split(':').pop());
  if (cnpjCert.length === 14 && dig(emp.cnpj) && cnpjCert !== dig(emp.cnpj)) {
    return { ok: false, erro: `Este certificado é do CNPJ ${cnpjCert.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')}, não desta empresa.` };
  }
  if (new Date(info.validoAte).getTime() < Date.now()) return { ok: false, erro: `Este certificado venceu em ${info.validoAte.slice(0, 10).split('-').reverse().join('/')}.` };
  const metadados = { titular: info.titular.split(':')[0], cnpj: cnpjCert || null, validoAte: info.validoAte };
  try {
    await gravarNoCofre(db, { empresaId: payload.empresaId, nome: 'CERT_A1_PFX_BASE64', valor: pfx, dica: `${metadados.titular} · vence ${info.validoAte.slice(0, 10).split('-').reverse().join('/')}`, metadados, usuario: g.perfil.nome });
    await gravarNoCofre(db, { empresaId: payload.empresaId, nome: 'CERT_A1_SENHA', valor: senha, dica: '••••', metadados: {}, usuario: g.perfil.nome });
    await registrarLogAuditoria({ usuario_nome: g.perfil.nome, acao: `COFRE: GRAVOU CERTIFICADO A1 (vence ${info.validoAte.slice(0, 10)}) — ${emp.nome}`, setor: SETOR });
    return { ok: true, info: { titular: metadados.titular, validoAte: info.validoAte } };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

export async function removerCredencialAction(payload: { empresaId: number | null; nome: string }, accessToken: string): Promise<Resultado> {
  const g = await exigirAdmin2fa(accessToken);
  if (!g.ok) return { ok: false, erro: g.erro };
  const c = campoDoEscopo(payload.nome, payload.empresaId);
  if (!c) return { ok: false, erro: 'Campo inválido para esta ficha.' };
  // certificado: arquivo e senha saem juntos
  const nomes = c.servico.certificadoA1 ? c.servico.campos.map(x => x.nome) : [c.campo.nome];
  const db = supabaseAdmin();
  try {
    for (const n of nomes) await removerDoCofre(db, payload.empresaId, n);
    await registrarLogAuditoria({ usuario_nome: g.perfil.nome, acao: `COFRE: REMOVEU ${nomes.join(' + ')} (${c.servico.titulo}) — ${await nomeEscopo(payload.empresaId)}`, setor: SETOR });
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}
