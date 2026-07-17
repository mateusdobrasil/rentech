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

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(':').map(Number);
  return (h * 60) + m;
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

    // Abono aprovado via WhatsApp (origem legal) nunca é apagado pela
    // reimportação do CSV — mesmo que o funcionário também apareça no
    // arquivo do Pontomais naquele mês.
    const { data: diasWhatsapp } = await db.from('folha_ponto_abono')
      .select('funcionario_nome, data_abono')
      .in('funcionario_nome', nomes)
      .eq('origem', 'WHATSAPP')
      .gte('data_abono', `${anoRef}-${mesRef}-01`)
      .lte('data_abono', dataFim);

    const diasPreservados = new Set((diasWhatsapp || []).map((d) => `${d.funcionario_nome}|${d.data_abono}`));

    const { error: delErr } = await db.from('folha_ponto_abono').delete()
      .in('funcionario_nome', nomes)
      .neq('origem', 'WHATSAPP')
      .gte('data_abono', `${anoRef}-${mesRef}-01`)
      .lte('data_abono', dataFim);
    if (delErr) throw new Error(`Falha ao limpar abonos antigos: ${delErr.message}`);

    const abonosFiltrados = abonos.filter(
      (a) => !diasPreservados.has(`${a.funcionario_nome}|${a.data_abono}`)
    );

    let gravados = 0;
    if (abonosFiltrados.length > 0) {
      const { data: inseridos, error: insErr } = await db.from('folha_ponto_abono').insert(
        abonosFiltrados.map((a) => ({ ...a, origem: 'CSV_PONTOMAIS' }))
      ).select('id');
      if (insErr) throw new Error(`Falha ao gravar no banco: ${insErr.message}`);
      if (!inseridos || inseridos.length === 0) {
        throw new Error('O banco não gravou nenhuma linha de abono.');
      }
      gravados = inseridos.length;
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: `IMPORTAÇÃO DE ABONOS — ${nomeArquivo}`,
      setor: 'RECURSOS HUMANOS / PONTO'
    });

    const aviso = diasPreservados.size > 0
      ? `${diasPreservados.size} dia(s) com abono via WhatsApp foram preservados e não foram sobrescritos pelo CSV.`
      : undefined;

    return { ok: true, info: { gravados, aviso } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// LANÇAMENTO MANUAL DE PONTO — o RH bate o ponto direto por um funcionário,
// sem depender de CSV do Pontomais ou do fluxo de WhatsApp. Só aceita os dois
// padrões válidos de batida (ENTRADA+SAÍDA, ou as 4 batidas completas) — a
// mesma regra usada para bloquear o fechamento da folha em lote.
// ============================================================================
export async function lancarPontoManualAction(payload: {
  funcionarioNome: string;
  dataRegistro: string; // YYYY-MM-DD
  entrada1: string | null;
  saida1: string | null;
  entrada2: string | null;
  saida2: string | null;
  usuarioNome: string;
  confirmarSobreposicaoWhatsapp?: boolean;
}): Promise<Resultado> {
  const db = supabaseAdmin();
  const { funcionarioNome, dataRegistro, entrada1, saida1, entrada2, saida2, usuarioNome, confirmarSobreposicaoWhatsapp } = payload;

  try {
    const mesAno = dataRegistro.slice(0, 7);
    const fechados = await nomesComFolhaFechada(db, mesAno);
    if (fechados.includes(funcionarioNome)) {
      return { ok: false, erro: `A folha de ${mesAno} já foi fechada para ${funcionarioNome}. Reabra a folha desse mês na tela de Holerites antes de lançar o ponto.` };
    }

    const padraoEntradaSaida = entrada1 && saida1 && !entrada2 && !saida2;
    const padraoCompleto = entrada1 && saida1 && entrada2 && saida2;
    if (!padraoEntradaSaida && !padraoCompleto) {
      return { ok: false, erro: 'Lance Entrada e Saída, ou as 4 batidas completas (Entrada, Saída Almoço, Retorno Almoço, Saída).' };
    }

    let minutosTrabalhados: number;
    if (padraoEntradaSaida) {
      minutosTrabalhados = timeToMinutes(saida1!) - timeToMinutes(entrada1!);
      if (minutosTrabalhados >= 360) minutosTrabalhados -= 60;
    } else {
      minutosTrabalhados = (timeToMinutes(saida1!) - timeToMinutes(entrada1!)) + (timeToMinutes(saida2!) - timeToMinutes(entrada2!));
    }
    if (minutosTrabalhados <= 0) {
      return { ok: false, erro: 'Os horários informados resultam em zero ou tempo negativo trabalhado. Confira as batidas.' };
    }

    const { data: existente } = await db.from('folha_ponto_diaria')
      .select('id, origem')
      .eq('funcionario_nome', funcionarioNome)
      .eq('data_registro', dataRegistro)
      .maybeSingle();

    // O ledger via WhatsApp (folha_ponto_whatsapp_registros) é a fonte legal
    // e nunca é apagado/editado. Mas a linha consolidada em
    // folha_ponto_diaria é só um "retrato" usado para calcular a folha — o
    // RH pode corrigi-la aqui (ex.: remover uma batida a mais feita sem
    // querer), desde que confirme explicitamente a sobreposição. O ledger
    // original continua intacto para auditoria; e como consolidarDia()
    // nunca sobrescreve um dia de origem != WHATSAPP, essa correção fica
    // protegida mesmo se uma justificativa futura for aprovada nesse dia.
    const sobrepondoWhatsapp = existente?.origem === 'WHATSAPP';
    if (sobrepondoWhatsapp && !confirmarSobreposicaoWhatsapp) {
      return { ok: false, erro: 'Este dia já tem batida confirmada via WhatsApp. Confirme a sobreposição para corrigir mesmo assim (o ledger original é preservado para auditoria).' };
    }

    if (existente) {
      const { error } = await db.from('folha_ponto_diaria').update({
        entrada_1: entrada1, saida_1: saida1, entrada_2: entrada2, saida_2: saida2,
        minutos_trabalhados: minutosTrabalhados, origem: 'MANUAL_RH'
      }).eq('id', existente.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from('folha_ponto_diaria').insert({
        funcionario_nome: funcionarioNome, data_registro: dataRegistro,
        entrada_1: entrada1, saida_1: saida1, entrada_2: entrada2, saida_2: saida2,
        minutos_trabalhados: minutosTrabalhados, origem: 'MANUAL_RH'
      });
      if (error) throw new Error(error.message);
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: sobrepondoWhatsapp
        ? `CORREÇÃO MANUAL SOBRE DIA CONSOLIDADO DO WHATSAPP (ledger original preservado) — ${funcionarioNome} em ${dataRegistro}`
        : `LANÇAMENTO MANUAL DE PONTO — ${funcionarioNome} em ${dataRegistro}`,
      setor: 'RECURSOS HUMANOS / PONTO'
    });

    return { ok: true, info: { minutosTrabalhados, sobrepondoWhatsapp } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}