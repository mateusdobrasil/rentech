'use server';

// app/admin/rh/actions/actions-afd.ts
// AFD da Portaria 671 (REP-P) na tela RH → Ponto: dados do REP-P, situação do
// certificado e geração do arquivo (.txt + .p7s). Só quem acessa
// /admin/rh/ponto, e só empresas liberadas para o usuário. O núcleo
// (congelar as marcações e montar o arquivo) fica em app/lib/ponto/afdCore.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcessoAlgumaRota, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { lerParametrosAfd, certificadoDaEmpresa, gerarAfd, type ParametrosAfd } from '../../../lib/ponto/afdCore';
import { COLETORES_AFD, type ColetorAfd } from '../../../lib/ponto/afd';

type Resultado<T> = { ok: boolean; erro?: string; info?: T };
const ROTAS = ['/admin/rh/ponto'];
const SETOR = 'RECURSOS HUMANOS / PONTO';
const dig = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export interface EmpresaAfd { id: number; nome: string; cnpj: string; certificado: { titular: string; validoAte: string } | null }
export interface DadosAfd { parametros: ParametrosAfd; empresas: EmpresaAfd[]; coletores: Record<string, string> }

export async function dadosAfdAction(accessToken: string): Promise<Resultado<DadosAfd>> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const db = supabaseAdmin();
  try {
    const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: emps, error } = await db.from('empresas').select('id, razao_social, nome, nome_curto, cnpj, ativo').order('id');
    if (error) throw new Error(error.message);
    const empresas = (emps || [])
      .filter(e => e.ativo !== false && empresaPermitida(permitidas, e.id) && dig(e.cnpj).length === 14)
      .map(e => {
        const cert = certificadoDaEmpresa(e.cnpj);
        return { id: e.id, nome: e.nome_curto || e.nome || e.razao_social, cnpj: dig(e.cnpj), certificado: cert ? { titular: cert.titular, validoAte: cert.validoAte } : null };
      });
    return { ok: true, info: { parametros: await lerParametrosAfd(db), empresas, coletores: COLETORES_AFD } };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

export async function salvarParametrosAfdAction(
  payload: { inpiRegistro: string; desenvolvedorDocumento: string; coletor: string },
  accessToken: string
): Promise<Resultado<ParametrosAfd>> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const inpi = dig(payload.inpiRegistro);
  const dev = dig(payload.desenvolvedorDocumento);
  if (inpi.length > 17) return { ok: false, erro: 'O número do INPI tem no máximo 17 dígitos.' };
  if (dev && dev.length !== 11 && dev.length !== 14) return { ok: false, erro: 'CNPJ/CPF do desenvolvedor inválido.' };
  if (!(payload.coletor in COLETORES_AFD)) return { ok: false, erro: 'Coletor inválido.' };
  const db = supabaseAdmin();
  try {
    const { error } = await db.from('parametros_ponto_afd').upsert({
      id: 1, inpi_registro: inpi, desenvolvedor_documento: dev, coletor: payload.coletor as ColetorAfd,
      atualizado_em: new Date().toISOString(), atualizado_por: acesso.perfil.nome,
    });
    if (error) throw new Error(/parametros_ponto_afd/.test(error.message) ? 'Falta rodar o SQL do AFD (.sql/Pendentes/ponto_afd_portaria_671.sql).' : error.message);
    await registrarLogAuditoria({ usuario_nome: acesso.perfil.nome, acao: `ALTEROU DADOS DO REP-P (AFD): INPI ${inpi || '—'}, coletor ${payload.coletor}`, setor: SETOR });
    return { ok: true, info: await lerParametrosAfd(db) };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}

export interface ArquivoAfd {
  nomeTxt: string; txtBase64: string;
  nomeP7s: string | null; p7sBase64: string | null;
  marcacoes: number; funcionarios: number; primeiroNsr: number | null; ultimoNsr: number | null;
  avisos: string[];
}

// previa=true: mesmo arquivo, mas sem congelar nenhuma marcação (para a
// contabilidade conferir antes do primeiro AFD oficial) — sai com "_PREVIA" no nome.
export async function gerarAfdAction(payload: { empresaId: number; inicio: string; fim: string; previa?: boolean }, accessToken: string): Promise<Resultado<ArquivoAfd>> {
  const acesso = await validarAcessoAlgumaRota(accessToken, ROTAS);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  const { empresaId, inicio, fim } = payload;
  const previa = !!payload.previa;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio || '') || !/^\d{4}-\d{2}-\d{2}$/.test(fim || '')) return { ok: false, erro: 'Informe o período.' };
  if (fim < inicio) return { ok: false, erro: 'A data final não pode ser antes da inicial.' };
  if (inicio > hojeSP()) return { ok: false, erro: 'O período não pode começar no futuro.' };
  const db = supabaseAdmin();
  try {
    const permitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(permitidas, Number(empresaId))) return { ok: false, erro: 'Você não tem acesso a esta empresa.' };
    const r = await gerarAfd(db, { empresaId: Number(empresaId), inicio, fim: fim > hojeSP() ? hojeSP() : fim, simular: previa });
    const base = previa ? `${r.nomeBase}_PREVIA` : r.nomeBase;
    await registrarLogAuditoria({
      usuario_nome: acesso.perfil.nome,
      acao: `${previa ? 'PRÉVIA DO' : 'GEROU'} AFD (PORTARIA 671): empresa ${empresaId}, ${inicio} a ${fim}, ${r.marcacoes} marcação(ões)${r.p7s ? ', assinado' : ', SEM assinatura'}`,
      setor: SETOR,
    });
    return {
      ok: true,
      info: {
        nomeTxt: `${base}.txt`, txtBase64: r.txt.toString('base64'),
        nomeP7s: r.p7s ? `${base}.p7s` : null, p7sBase64: r.p7s ? r.p7s.toString('base64') : null,
        marcacoes: r.marcacoes, funcionarios: r.funcionarios, primeiroNsr: r.primeiroNsr, ultimoNsr: r.ultimoNsr, avisos: r.avisos,
      },
    };
  } catch (e) {
    return { ok: false, erro: (e as Error).message };
  }
}
