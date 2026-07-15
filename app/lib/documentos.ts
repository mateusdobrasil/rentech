// Verificação de documentos vencidos em RH → Documentos (abas Funcionários e
// Empresa), usada pelo motor de Cron para alimentar a automação
// 'documentos-vencidos' (tela Agendamentos e Disparos) com a lista do dia.
import { supabaseAdmin } from './supabase';

interface ContextoDocumentosVencidos {
  quantidade: number;
  lista: string;
}

const fmtData = (dataStr: string) => new Date(`${dataStr}T00:00:00`).toLocaleDateString('pt-BR');

export async function montarContextoDocumentosVencidos(): Promise<ContextoDocumentosVencidos | null> {
  const db = supabaseAdmin();
  const hoje = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  hoje.setHours(0, 0, 0, 0);
  const hojeStr = hoje.toISOString().slice(0, 10);

  const [{ data: docsFunc }, { data: catsFunc }, { data: docsEmpresa }, { data: catsEmpresa }] = await Promise.all([
    db.from('folha_documentos').select('funcionario_nome, categoria_id, data_validade').not('data_validade', 'is', null).lt('data_validade', hojeStr),
    db.from('folha_documento_categorias').select('id, nome'),
    db.from('empresa_documentos').select('categoria_id, data_validade').not('data_validade', 'is', null).lt('data_validade', hojeStr),
    db.from('empresa_documento_categorias').select('id, nome'),
  ]);

  const nomeCatFunc = (id: number) => catsFunc?.find(c => c.id === id)?.nome || 'Documento';
  const nomeCatEmpresa = (id: number) => catsEmpresa?.find(c => c.id === id)?.nome || 'Documento';

  const linhasFunc = (docsFunc || []).map(d =>
    `👤 *${d.funcionario_nome}* — ${nomeCatFunc(d.categoria_id)} vencido em ${fmtData(d.data_validade!)}`
  );
  const linhasEmpresa = (docsEmpresa || []).map(d =>
    `🏢 ${nomeCatEmpresa(d.categoria_id)} vencido em ${fmtData(d.data_validade!)}`
  );

  const linhas = [...linhasFunc, ...linhasEmpresa];
  if (linhas.length === 0) return null;
  return { quantidade: linhas.length, lista: linhas.join('\n') };
}
