'use server';

// app/admin/rh/actions/actions-exportar-documentos.ts
// Dados para o botão "Exportar Excel" de /admin/rh/documentos: os documentos
// dos funcionários escolhidos, com a validade e a situação calculadas aqui
// (mesma regra da tela: vencido antes de hoje, "vencendo" em até 30 dias), e,
// se pedido, os documentos da empresa. Só funcionários e empresas liberados
// para o usuário (obterEmpresasPermitidas, resolvida no servidor). A planilha
// é montada no navegador (ExportarDocumentos.tsx).
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas } from '../../../lib/serverAuth';

type Resultado = { ok: boolean; erro?: string; info?: any };
type Situacao = 'VENCIDO' | 'VENCENDO' | 'OK' | 'SEM';

const ROTA = '/admin/rh/documentos';
const LOTE = 150;

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate + 'T12:00:00Z') - Date.parse(de + 'T12:00:00Z')) / 86400000);
function situacaoDe(validade: string | null, hoje: string): { situacao: Situacao; dias: number | null } {
  if (!validade) return { situacao: 'SEM', dias: null };
  const dias = diasEntre(hoje, validade.slice(0, 10));
  return { situacao: dias < 0 ? 'VENCIDO' : dias <= 30 ? 'VENCENDO' : 'OK', dias };
}

export async function exportarDocumentosAction(payload: {
  nomes: string[];          // funcionários da lista da tela (o painel é por nome)
  categorias: number[];     // vazio = nenhuma (a tela sempre manda as marcadas)
  empresa: boolean;         // incluir os documentos da empresa
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const nomes = [...new Set((payload.nomes || []).filter(n => typeof n === 'string' && n.trim()))];
  const categorias = [...new Set((payload.categorias || []).map(Number).filter(Number.isFinite))];

  try {
    const db = supabaseAdmin();
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const hoje = hojeSP();

    // Fichas: só as liberadas para o usuário (o nome vindo da tela não basta)
    const fichas: any[] = [];
    for (let i = 0; i < nomes.length; i += LOTE) {
      let q = db.from('folha_funcionarios').select('id, nome_completo, cargo, empresa_id, ativo').in('nome_completo', nomes.slice(i, i + LOTE));
      if (empresasPermitidas) q = q.in('empresa_id', empresasPermitidas);
      const { data, error } = await q;
      if (error) return { ok: false, erro: error.message };
      fichas.push(...(data || []));
    }
    fichas.sort((a, b) => String(a.nome_completo).localeCompare(String(b.nome_completo), 'pt-BR'));

    const [catsRes, empresasRes] = await Promise.all([
      db.from('folha_documento_categorias').select('id, nome, exige_validade').order('nome'),
      db.from('empresas').select('id, nome'),
    ]);
    const nomeEmpresa = new Map(((empresasRes.data || []) as any[]).map(e => [e.id, String(e.nome)]));
    const nomeCat = new Map(((catsRes.data || []) as any[]).map(c => [c.id, String(c.nome)]));
    const comValidade = new Set(((catsRes.data || []) as any[]).filter(c => c.exige_validade).map(c => c.id as number));

    // Documentos: pela ficha (funcionario_id); os antigos sem id, pelo nome
    const docsBrutos: any[] = [];
    if (fichas.length && categorias.length) {
      const cols = 'id, funcionario_id, funcionario_nome, categoria_id, titulo, nome_arquivo, data_validade, observacao, criado_em, visivel_portal';
      for (let i = 0; i < fichas.length; i += LOTE) {
        const parte = fichas.slice(i, i + LOTE);
        const [porId, porNome] = await Promise.all([
          db.from('folha_documentos').select(cols).in('categoria_id', categorias).in('funcionario_id', parte.map(f => f.id)),
          db.from('folha_documentos').select(cols).in('categoria_id', categorias).is('funcionario_id', null).in('funcionario_nome', parte.map(f => f.nome_completo)),
        ]);
        if (porId.error) return { ok: false, erro: porId.error.message };
        if (porNome.error) return { ok: false, erro: porNome.error.message };
        docsBrutos.push(...(porId.data || []), ...(porNome.data || []));
      }
    }

    const fichaPorId = new Map(fichas.map(f => [f.id, f]));
    const fichaPorNome = new Map(fichas.map(f => [f.nome_completo, f]));
    // Categoria com validade (ASO, CNH, curso…): vale o mais recente de cada
    // funcionário, o resto é histórico (o ASO renovado não conta como vencido).
    // Categoria sem validade (RG, contrato, advertência, outros…): todos valem —
    // a pessoa pode ter vários documentos diferentes na mesma categoria.
    const maisRecente = new Map<string, any>();
    const documentos = docsBrutos.map(d => {
      const ficha = (d.funcionario_id && fichaPorId.get(d.funcionario_id)) || fichaPorNome.get(d.funcionario_nome);
      return { d, ficha };
    }).filter(x => x.ficha).map(({ d, ficha }) => {
      const { situacao, dias } = situacaoDe(d.data_validade, hoje);
      const item = {
        id: d.id as number,
        fichaId: ficha.id as string,
        funcionario: ficha.nome_completo as string,
        cargo: (ficha.cargo || '') as string,
        empresa: nomeEmpresa.get(ficha.empresa_id) || '',
        categoriaId: d.categoria_id as number,
        categoria: nomeCat.get(d.categoria_id) || '—',
        titulo: (d.titulo || '') as string,
        arquivo: (d.nome_arquivo || '') as string,
        validade: (d.data_validade || null) as string | null,
        situacao, dias,
        enviadoEm: String(d.criado_em || '').slice(0, 10),
        visivelPortal: !!d.visivel_portal,
        observacao: (d.observacao || '') as string,
        vigente: !comValidade.has(d.categoria_id),
      };
      if (item.vigente) return item;
      const k = `${item.fichaId}|${item.categoriaId}`;
      const atual = maisRecente.get(k);
      // mais recente = maior validade; sem validade, o enviado por último
      const chave = (x: any) => `${x.validade || ''}|${x.enviadoEm}|${String(x.id).padStart(10, '0')}`;
      if (!atual || chave(item) > chave(atual)) maisRecente.set(k, item);
      return item;
    });
    maisRecente.forEach(item => { item.vigente = true; });
    documentos.sort((a, b) => a.funcionario.localeCompare(b.funcionario, 'pt-BR') || a.categoria.localeCompare(b.categoria, 'pt-BR') || String(b.validade || b.enviadoEm).localeCompare(String(a.validade || a.enviadoEm)));

    // Documentos da empresa
    let documentosEmpresa: any[] = [];
    if (payload.empresa) {
      let q = db.from('empresa_documentos').select('id, categoria_id, empresa_id, titulo, nome_arquivo, data_validade, observacao, criado_em').order('criado_em', { ascending: false });
      if (empresasPermitidas) q = q.in('empresa_id', empresasPermitidas);
      const [{ data, error }, { data: catsEmp }] = await Promise.all([q, db.from('empresa_documento_categorias').select('id, nome')]);
      if (error) return { ok: false, erro: error.message };
      const nomeCatEmp = new Map(((catsEmp || []) as any[]).map(c => [c.id, String(c.nome)]));
      documentosEmpresa = ((data || []) as any[]).map(d => ({
        empresa: nomeEmpresa.get(d.empresa_id) || (d.empresa_id == null ? 'Todas' : ''),
        categoria: nomeCatEmp.get(d.categoria_id) || '—',
        titulo: d.titulo || '', arquivo: d.nome_arquivo || '',
        validade: d.data_validade || null, ...situacaoDe(d.data_validade, hoje),
        enviadoEm: String(d.criado_em || '').slice(0, 10), observacao: d.observacao || '',
      })).sort((a, b) => a.empresa.localeCompare(b.empresa, 'pt-BR') || a.categoria.localeCompare(b.categoria, 'pt-BR'));
    }

    return {
      ok: true,
      info: {
        hoje,
        funcionarios: fichas.map(f => ({ id: f.id, nome: f.nome_completo, cargo: f.cargo || '', empresa: nomeEmpresa.get(f.empresa_id) || '' })),
        categorias: ((catsRes.data || []) as any[]).filter(c => categorias.includes(c.id)).map(c => ({ id: c.id, nome: c.nome, exigeValidade: !!c.exige_validade })),
        documentos,
        documentosEmpresa,
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
