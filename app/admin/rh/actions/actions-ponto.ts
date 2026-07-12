'use server';

// app/reunioes/.../actions-ponto.ts  (ajuste o caminho de import conforme a localização real)
// Server actions para a importação de PONTO (batidas e abonos), com service role.
import { supabaseAdmin } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';

type Resultado = { ok: boolean; erro?: string; info?: any };

// Verifica se há folha fechada no mês (trava de reimportação)
async function nomesComFolhaFechada(db: ReturnType<typeof supabaseAdmin>, mesAno: string): Promise<string[]> {
  const { data, error } = await db.from('folha_holerites').select('funcionario_nome').eq('mes_referencia', mesAno);
  if (error) return [];
  return (data || []).map((d: any) => d.funcionario_nome);
}

// ============================================================================
// IMPORTAÇÃO DE BATIDAS DE PONTO
// ============================================================================
export async function importarPontoAction(payload: {
  registros: any[];
  nomes: string[];
  anoRef: string;
  mesRef: string;
  usuarioNome: string;
  nomeArquivo: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { registros, nomes, anoRef, mesRef, usuarioNome, nomeArquivo } = payload;

  try {
    const mesAno = `${anoRef}-${mesRef}`;
    const fechados = await nomesComFolhaFechada(db, mesAno);
    if (fechados.length > 0) {
      return { ok: false, erro: `A folha de ${mesRef}/${anoRef} já foi fechada para ${fechados.length} funcionário(s). Reabra a folha desse mês na tela de Holerites antes de reimportar o ponto.` };
    }

    const ultimoDia = new Date(Number(anoRef), Number(mesRef), 0).getDate();
    const dataFim = `${anoRef}-${mesRef}-${String(ultimoDia).padStart(2, '0')}`;

    // Dias com batida via WhatsApp (origem legal, imutável) nunca são apagados
    // pela reimportação do CSV — mesmo que o funcionário também apareça no
    // arquivo do Pontomais naquele mês.
    const { data: diasWhatsapp } = await db.from('folha_ponto_diaria')
      .select('funcionario_nome, data_registro')
      .in('funcionario_nome', nomes)
      .eq('origem', 'WHATSAPP')
      .gte('data_registro', `${anoRef}-${mesRef}-01`)
      .lte('data_registro', dataFim);

    const diasPreservados = new Set((diasWhatsapp || []).map((d) => `${d.funcionario_nome}|${d.data_registro}`));

    const { error: delErr } = await db.from('folha_ponto_diaria').delete()
      .in('funcionario_nome', nomes)
      .neq('origem', 'WHATSAPP')
      .gte('data_registro', `${anoRef}-${mesRef}-01`)
      .lte('data_registro', dataFim);
    if (delErr) throw new Error(`Falha ao limpar ponto antigo: ${delErr.message}`);

    const registrosFiltrados = registros.filter(
      (r) => !diasPreservados.has(`${r.funcionario_nome}|${r.data_registro}`)
    );

    if (registrosFiltrados.length > 0) {
      const { error: insErr } = await db.from('folha_ponto_diaria').insert(
        registrosFiltrados.map((r) => ({ ...r, origem: 'CSV_PONTOMAIS' }))
      );
      if (insErr) throw new Error(`Falha ao gravar ponto: ${insErr.message}`);
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `IMPORTAÇÃO DE PONTO (BATIDAS) — ${nomeArquivo}`,
      setor: 'RECURSOS HUMANOS / PONTO'
    });

    const aviso = diasPreservados.size > 0
      ? `${diasPreservados.size} dia(s) com ponto via WhatsApp foram preservados e não foram sobrescritos pelo CSV.`
      : undefined;

    return { ok: true, info: { gravados: registrosFiltrados.length, aviso } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// IMPORTAÇÃO DE ABONOS
// ============================================================================
export async function importarAbonosAction(payload: {
  abonos: any[];
  nomes: string[];
  anoRef: string;
  mesRef: string;
  usuarioNome: string;
  nomeArquivo: string;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { abonos, nomes, anoRef, mesRef, usuarioNome, nomeArquivo } = payload;

  try {
    const mesAno = `${anoRef}-${mesRef}`;
    const fechados = await nomesComFolhaFechada(db, mesAno);
    if (fechados.length > 0) {
      return { ok: false, erro: `A folha de ${mesRef}/${anoRef} já foi fechada para ${fechados.length} funcionário(s). Reabra a folha desse mês na tela de Holerites antes de reimportar os abonos.` };
    }

    const ultimoDia = new Date(Number(anoRef), Number(mesRef), 0).getDate();
    const dataFim = `${anoRef}-${mesRef}-${String(ultimoDia).padStart(2, '0')}`;

    const { error: delErr } = await db.from('folha_ponto_abono').delete()
      .in('funcionario_nome', nomes)
      .gte('data_abono', `${anoRef}-${mesRef}-01`)
      .lte('data_abono', dataFim);
    if (delErr) throw new Error(`Falha ao limpar abonos antigos: ${delErr.message}`);

    const { data: inseridos, error: insErr } = await db.from('folha_ponto_abono').insert(abonos).select('id');
    if (insErr) throw new Error(`Falha ao gravar no banco: ${insErr.message}`);
    if (!inseridos || inseridos.length === 0) {
      throw new Error('O banco não gravou nenhuma linha de abono.');
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `IMPORTAÇÃO DE ABONOS — ${nomeArquivo}`,
      setor: 'RECURSOS HUMANOS / PONTO'
    });

    return { ok: true, info: { gravados: inseridos.length } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}