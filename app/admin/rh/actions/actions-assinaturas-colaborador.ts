'use server';

// app/admin/rh/actions/actions-assinaturas-colaborador.ts
// Aba "Por Colaborador" de /admin/rh/assinaturas: tudo o que foi enviado para
// assinar de uma pessoa (holerites de todos os meses, documentos avulsos e
// TRCT da rescisão — todos em folha_holerite_assinaturas), os holerites
// fechados que nunca foram enviados e os documentos oficiais guardados em
// RH → Documentos (folha_documentos), com a validade.
//
// Validado pela rota da própria tela (/admin/rh/assinaturas): quem acessa a
// tela vê e abre o que ela mostra, sem precisar da rota de Documentos. Só
// colaboradores das empresas do usuário (obterEmpresasPermitidas, no servidor).
// Consultar status, baixar o assinado e cancelar continuam nas actions de
// actions-assinatura.ts (as mesmas das outras abas).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/rh/assinaturas';
const BUCKET_DOCUMENTOS = 'documentos-funcionarios';
const PENDENTES = ['ENVIADO', 'VISUALIZADO', 'PENDENTE'];

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export type TipoAssinatura = 'HOLERITE' | 'AVULSO' | 'RESCISAO' | 'DECIMO_TERCEIRO';
const tipoDe = (ref: string): TipoAssinatura =>
  ref.startsWith('RESCISAO-') ? 'RESCISAO' : ref.startsWith('AVULSO-') ? 'AVULSO' : /^13-\d{4}-P[12]$/.test(ref) ? 'DECIMO_TERCEIRO' : 'HOLERITE';
const titulo13 = (ref: string) => { const m = ref.match(/^13-(\d{4})-P([12])$/); return m ? `13º Salário - ${m[2]}ª parcela ${m[1]}` : '13º Salário'; };

/** Lista de colaboradores para escolher (ativos e desligados), com a contagem de assinaturas. */
export async function colaboradoresAssinaturaAction(accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const db = supabaseAdmin();
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    let q = db.from('folha_funcionarios').select('id, nome_completo, cargo, empresa_id, ativo').order('nome_completo');
    if (empresasPermitidas) q = q.in('empresa_id', empresasPermitidas);
    const [{ data: funcs, error }, { data: assin, error: erroAssin }] = await Promise.all([
      q,
      db.from('folha_holerite_assinaturas').select('funcionario_id, status').limit(20000),
    ]);
    if (error || erroAssin) return { ok: false, erro: (error || erroAssin)!.message };

    const cont = new Map<string, { total: number; assinados: number; pendentes: number; rejeitados: number }>();
    (assin || []).forEach((a: any) => {
      if (!a.funcionario_id || a.status === 'CANCELADO') return;
      const c = cont.get(a.funcionario_id) || { total: 0, assinados: 0, pendentes: 0, rejeitados: 0 };
      c.total++;
      if (a.status === 'ASSINADO') c.assinados++;
      else if (a.status === 'REJEITADO') c.rejeitados++;
      else if (PENDENTES.includes(a.status)) c.pendentes++;
      cont.set(a.funcionario_id, c);
    });

    const colaboradores = ((funcs || []) as any[]).map(f => ({
      id: f.id as string, nome: f.nome_completo as string, cargo: (f.cargo || '') as string,
      empresaId: (f.empresa_id ?? null) as number | null, ativo: !!f.ativo,
      ...(cont.get(f.id) || { total: 0, assinados: 0, pendentes: 0, rejeitados: 0 }),
    }));
    return { ok: true, info: { colaboradores } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Tudo de um colaborador: assinaturas, holerites fechados sem envio e documentos oficiais. */
export async function dossieAssinaturasAction(payload: { funcionarioId: string }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const db = supabaseAdmin();
    const { data: ficha } = await db.from('folha_funcionarios')
      .select('id, nome_completo, cpf, cargo, departamento, tipo_contrato, empresa_id, ativo, data_admissao, data_desligamento, recebe_holerite, recebe_fechamento')
      .eq('id', payload.funcionarioId).maybeSingle();
    if (!ficha) return { ok: false, erro: 'Colaborador não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, ficha.empresa_id)) return { ok: false, erro: 'Você não tem permissão para ver este colaborador.' };

    const colsAssin = 'id, funcionario_id, funcionario_nome, mes_referencia, titulo_avulso, status, sandbox, link_assinatura, arquivo_assinado, enviado_por, enviado_em, visualizado_em, assinado_em, cancelado_por, cancelado_em, empresa_id';
    const [assinRes, holRes, docsRes, catsRes, empRes] = await Promise.all([
      db.from('folha_holerite_assinaturas').select(colsAssin).eq('funcionario_id', ficha.id),
      db.from('folha_holerites').select('mes_referencia, fechado_em, valor_liquido').eq('funcionario_id', ficha.id),
      db.from('folha_documentos').select('id, categoria_id, titulo, nome_arquivo, data_validade, observacao, criado_em, visivel_portal, enviado_por').eq('funcionario_id', ficha.id),
      db.from('folha_documento_categorias').select('id, nome, exige_validade'),
      db.from('empresas').select('id, nome').eq('id', ficha.empresa_id ?? -1).maybeSingle(),
    ]);
    const erro = [assinRes, holRes, docsRes, catsRes].find(r => r.error)?.error;
    if (erro) return { ok: false, erro: erro.message };

    const assinaturas = ((assinRes.data || []) as any[]).map(a => {
      const tipo = tipoDe(String(a.mes_referencia));
      const competencia = tipo === 'HOLERITE' ? String(a.mes_referencia) : tipo === 'AVULSO' ? String(a.mes_referencia).slice(7, 14) : null;
      return {
        id: a.id as number,
        tipo,
        titulo: tipo === 'HOLERITE' ? `Holerite ${String(a.mes_referencia).split('-').reverse().join('/')}` : tipo === 'DECIMO_TERCEIRO' ? titulo13(String(a.mes_referencia)) : (String(a.titulo_avulso || '').trim() || (tipo === 'RESCISAO' ? 'TRCT - Rescisão' : 'Documento avulso')),
        mesReferencia: a.mes_referencia as string,   // chave das actions de consultar/baixar/cancelar
        competencia,                                    // AAAA-MM (holerite e avulso)
        rescisaoId: tipo === 'RESCISAO' ? Number(String(a.mes_referencia).slice(9)) || null : null,
        status: a.status as string,
        sandbox: !!a.sandbox,
        temAssinado: !!a.arquivo_assinado,
        temLink: !!a.link_assinatura,
        enviadoPor: a.enviado_por || null,
        enviadoEm: a.enviado_em || null,
        visualizadoEm: a.visualizado_em || null,
        assinadoEm: a.assinado_em || null,
        canceladoPor: a.cancelado_por || null,
        canceladoEm: a.cancelado_em || null,
      };
    }).sort((x, y) => String(y.enviadoEm || '').localeCompare(String(x.enviadoEm || '')));

    // Holerite fechado na folha e nunca enviado (ou só com envio cancelado)
    const enviados = new Set(assinaturas.filter(a => a.tipo === 'HOLERITE' && a.status !== 'CANCELADO').map(a => a.mesReferencia));
    const holeritesSemEnvio = ((holRes.data || []) as any[])
      .filter(h => h.fechado_em && !enviados.has(h.mes_referencia))
      .map(h => ({ mesReferencia: h.mes_referencia as string, fechadoEm: h.fechado_em as string, valorLiquido: Number(h.valor_liquido) || 0 }))
      .sort((a, b) => b.mesReferencia.localeCompare(a.mesReferencia));

    // Documentos oficiais (RH → Documentos), com a validade
    const hoje = hojeSP();
    const cats = new Map(((catsRes.data || []) as any[]).map(c => [c.id, c]));
    const docsBrutos = (docsRes.data || []) as any[];
    // na categoria com validade vale o mais recente; o resto é histórico
    const vigente = new Map<number, string>();
    docsBrutos.forEach(d => {
      if (!cats.get(d.categoria_id)?.exige_validade) return;
      const chave = `${d.data_validade || ''}|${d.criado_em}|${String(d.id).padStart(10, '0')}`;
      const atual = vigente.get(d.categoria_id);
      if (!atual || chave > atual) vigente.set(d.categoria_id, chave);
    });
    const documentos = docsBrutos.map(d => {
      const cat = cats.get(d.categoria_id);
      const chave = `${d.data_validade || ''}|${d.criado_em}|${String(d.id).padStart(10, '0')}`;
      let situacao: 'VENCIDO' | 'VENCENDO' | 'OK' | 'SEM' = 'SEM';
      let dias: number | null = null;
      if (d.data_validade) {
        dias = Math.round((Date.parse(d.data_validade + 'T12:00:00Z') - Date.parse(hoje + 'T12:00:00Z')) / 86400000);
        situacao = dias < 0 ? 'VENCIDO' : dias <= 30 ? 'VENCENDO' : 'OK';
      }
      return {
        id: d.id as number,
        categoria: (cat?.nome || '—') as string,
        exigeValidade: !!cat?.exige_validade,
        titulo: (d.titulo || '') as string,
        arquivo: (d.nome_arquivo || '') as string,
        validade: (d.data_validade || null) as string | null,
        situacao, dias,
        historico: !!cat?.exige_validade && vigente.get(d.categoria_id) !== chave,
        enviadoEm: d.criado_em as string,
        enviadoPor: (d.enviado_por || null) as string | null,
        visivelPortal: !!d.visivel_portal,
        observacao: (d.observacao || '') as string,
      };
    }).sort((a, b) => a.categoria.localeCompare(b.categoria, 'pt-BR') || String(b.enviadoEm).localeCompare(String(a.enviadoEm)));

    return {
      ok: true,
      info: {
        colaborador: {
          id: ficha.id, nome: ficha.nome_completo, cpf: ficha.cpf || null, cargo: ficha.cargo || '', departamento: ficha.departamento || '',
          tipoContrato: ficha.tipo_contrato || '', empresaId: ficha.empresa_id ?? null, empresa: (empRes.data as any)?.nome || '',
          ativo: !!ficha.ativo, dataAdmissao: ficha.data_admissao || null, dataDesligamento: ficha.data_desligamento || null,
        },
        assinaturas, holeritesSemEnvio, documentos, hoje,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Link (10 min) de um documento oficial do colaborador, para abrir ou baixar pela aba Por Colaborador. */
export async function urlDocumentoColaboradorAction(payload: { id: number; download?: boolean }, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };
  try {
    const db = supabaseAdmin();
    const { data: doc } = await db.from('folha_documentos').select('storage_path, nome_arquivo, empresa_id').eq('id', payload.id).maybeSingle();
    if (!doc?.storage_path) return { ok: false, erro: 'Documento não encontrado.' };
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    if (!empresaPermitida(empresasPermitidas, doc.empresa_id)) return { ok: false, erro: 'Você não tem permissão para acessar este documento.' };
    const opts = payload.download ? { download: doc.nome_arquivo } : undefined;
    const { data, error } = await db.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(doc.storage_path, 60 * 10, opts);
    if (error || !data?.signedUrl) return { ok: false, erro: error?.message || 'Falha ao gerar link.' };
    return { ok: true, info: { url: data.signedUrl } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
