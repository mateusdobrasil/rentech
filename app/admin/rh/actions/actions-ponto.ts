'use server';

// app/reunioes/.../actions-ponto.ts  (ajuste o caminho de import conforme a localização real)
// Server actions para a importação de PONTO (batidas e abonos), com service role.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ROTA = '/admin/rh/ponto';

// Mapa nome→empresa_id pra um lote de funcionários, e checagem de que todos
// pertencem a empresas que o usuário logado pode enxergar (senão um usuário
// só-Rentech poderia importar CSV de ponto embutindo nomes da AlfaLight).
async function mapaEmpresasELimite(db: ReturnType<typeof supabaseAdmin>, nomes: string[], empresasPermitidas: number[] | null): Promise<{ mapa: Record<string, number | null>; foraDoEscopo: string[] }> {
  const { data } = nomes.length
    ? await db.from('folha_funcionarios').select('nome_completo, empresa_id').in('nome_completo', nomes)
    : { data: [] as { nome_completo: string; empresa_id: number | null }[] };
  const mapa: Record<string, number | null> = {};
  const foraDoEscopo: string[] = [];
  (data || []).forEach(f => {
    mapa[f.nome_completo] = f.empresa_id;
    if (!empresaPermitida(empresasPermitidas, f.empresa_id)) foraDoEscopo.push(f.nome_completo);
  });
  return { mapa, foraDoEscopo };
}

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
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { registros, nomes, anoRef, mesRef, usuarioNome, nomeArquivo } = payload;

  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { mapa: empresaPorNome, foraDoEscopo } = await mapaEmpresasELimite(db, nomes, empresasPermitidas);
    if (foraDoEscopo.length > 0) {
      return { ok: false, erro: `Você não tem permissão para importar ponto de: ${foraDoEscopo.join(', ')}.` };
    }

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
        registrosFiltrados.map((r) => ({ ...r, empresa_id: empresaPorNome[r.funcionario_nome] ?? null, origem: 'CSV_PONTOMAIS' }))
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
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { abonos, nomes, anoRef, mesRef, usuarioNome, nomeArquivo } = payload;

  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { mapa: empresaPorNome, foraDoEscopo } = await mapaEmpresasELimite(db, nomes, empresasPermitidas);
    if (foraDoEscopo.length > 0) {
      return { ok: false, erro: `Você não tem permissão para importar abonos de: ${foraDoEscopo.join(', ')}.` };
    }

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
        abonosFiltrados.map((a) => ({ ...a, empresa_id: empresaPorNome[a.funcionario_nome] ?? null, origem: 'CSV_PONTOMAIS' }))
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
  // RH confirmou que é um turno noturno (a saída caiu de madrugada, no dia
  // seguinte a dataRegistro) — sem isso, um horário de saída "menor" que o
  // de entrada é tratado como erro de digitação e a gravação é recusada.
  confirmarViradaNoite?: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, dataRegistro, entrada1, saida1, entrada2, saida2, usuarioNome, confirmarSobreposicaoWhatsapp, confirmarViradaNoite } = payload;

  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: func } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', funcionarioNome).maybeSingle();
    if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para lançar ponto para este funcionário.' };
    }

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

    // Um par onde a saída marca um horário "menor" que a entrada normalmente
    // é erro de digitação — mas também é exatamente a cara de um turno
    // noturno (entrada à noite, saída de madrugada no dia seguinte). Sem
    // confirmarViradaNoite, trata como erro; com a confirmação, soma 24h ao
    // par antes de calcular.
    const parVirouNoite = (ini: string, fim: string) => timeToMinutes(fim) - timeToMinutes(ini) < 0;
    const par1Vira = parVirouNoite(entrada1!, saida1!);
    const par2Vira = padraoCompleto ? parVirouNoite(entrada2!, saida2!) : false;

    if ((par1Vira || par2Vira) && !confirmarViradaNoite) {
      return { ok: false, erro: 'VIRADA_NOITE' };
    }

    const diffMin = (ini: string, fim: string, vira: boolean): number => {
      const mins = timeToMinutes(fim) - timeToMinutes(ini);
      return vira ? mins + 1440 : mins;
    };

    let minutosTrabalhados: number;
    if (padraoEntradaSaida) {
      minutosTrabalhados = diffMin(entrada1!, saida1!, par1Vira);
      if (minutosTrabalhados >= 360) minutosTrabalhados -= 60;
    } else {
      minutosTrabalhados = diffMin(entrada1!, saida1!, par1Vira) + diffMin(entrada2!, saida2!, par2Vira);
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
        funcionario_nome: funcionarioNome, empresa_id: func?.empresa_id ?? null, data_registro: dataRegistro,
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

// ============================================================================
// DESCARTAR PONTO DO DIA — o RH desconsidera uma batida feita por engano
// (ex.: funcionário bateu entrada num dia que não deveria trabalhar). O
// ledger via WhatsApp nunca é apagado (fica intacto para auditoria); isto só
// zera a linha do RELATÓRIO consolidado usada no cálculo da folha e na
// verificação de inconsistências.
// ============================================================================
export async function descartarPontoManualAction(payload: {
  funcionarioNome: string;
  dataRegistro: string; // YYYY-MM-DD
  usuarioNome: string;
  confirmarSobreposicaoWhatsapp?: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, dataRegistro, usuarioNome, confirmarSobreposicaoWhatsapp } = payload;

  try {
    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: func } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', funcionarioNome).maybeSingle();
    if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para alterar o ponto deste funcionário.' };
    }

    const mesAno = dataRegistro.slice(0, 7);
    const fechados = await nomesComFolhaFechada(db, mesAno);
    if (fechados.includes(funcionarioNome)) {
      return { ok: false, erro: `A folha de ${mesAno} já foi fechada para ${funcionarioNome}. Reabra a folha desse mês na tela de Holerites antes de descartar o ponto.` };
    }

    const { data: existente } = await db.from('folha_ponto_diaria')
      .select('id, origem')
      .eq('funcionario_nome', funcionarioNome)
      .eq('data_registro', dataRegistro)
      .maybeSingle();

    if (!existente) {
      return { ok: false, erro: 'Não há ponto lançado nesse dia pra descartar.' };
    }

    const sobrepondoWhatsapp = existente.origem === 'WHATSAPP';
    if (sobrepondoWhatsapp && !confirmarSobreposicaoWhatsapp) {
      return { ok: false, erro: 'Este dia tem batida confirmada via WhatsApp. Confirme a sobreposição para descartar mesmo assim (o ledger original é preservado para auditoria).' };
    }

    // Zera a linha em vez de excluí-la: mantém a origem MANUAL_RH gravada
    // pra travar consolidarDia() de reconstruir a mesma batida indevida se o
    // ledger do WhatsApp for reprocessado (ex.: uma justificativa aprovada
    // depois nesse mesmo dia) — consolidarDia() nunca sobrescreve um dia de
    // origem != WHATSAPP.
    const { error } = await db.from('folha_ponto_diaria').update({
      entrada_1: null, saida_1: null, entrada_2: null, saida_2: null,
      minutos_trabalhados: 0, origem: 'MANUAL_RH'
    }).eq('id', existente.id);
    if (error) throw new Error(error.message);

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: sobrepondoWhatsapp
        ? `DESCARTE DE PONTO SOBRE DIA CONSOLIDADO DO WHATSAPP (ledger original preservado) — ${funcionarioNome} em ${dataRegistro}`
        : `DESCARTE MANUAL DE PONTO — ${funcionarioNome} em ${dataRegistro}`,
      setor: 'RECURSOS HUMANOS / PONTO'
    });

    return { ok: true, info: { sobrepondoWhatsapp } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

// ============================================================================
// ABONAR DIA — o RH abona um dia inteiro de um funcionário direto por aqui,
// sem depender de CSV ou do fluxo de aprovação via WhatsApp.
// ============================================================================
export async function abonarDiaManualAction(payload: {
  funcionarioNome: string;
  dataAbono: string; // YYYY-MM-DD
  motivo: string;
  usuarioNome: string;
  confirmarSobreposicaoWhatsapp?: boolean;
}, accessToken: string): Promise<Resultado> {
  const acesso = await validarAcesso(accessToken, ROTA);
  if (!acesso.ok) return { ok: false, erro: acesso.message };

  const db = supabaseAdmin();
  const { funcionarioNome, dataAbono, motivo, usuarioNome, confirmarSobreposicaoWhatsapp } = payload;

  try {
    if (!motivo?.trim()) return { ok: false, erro: 'Informe o motivo do abono.' };

    const empresasPermitidas = await obterEmpresasPermitidas(acesso.perfil.id, acesso.perfil.permissaoNormalizada);
    const { data: func } = await db.from('folha_funcionarios').select('empresa_id').eq('nome_completo', funcionarioNome).maybeSingle();
    if (!empresaPermitida(empresasPermitidas, func?.empresa_id)) {
      return { ok: false, erro: 'Você não tem permissão para abonar dia para este funcionário.' };
    }

    const mesAno = dataAbono.slice(0, 7);
    const fechados = await nomesComFolhaFechada(db, mesAno);
    if (fechados.includes(funcionarioNome)) {
      return { ok: false, erro: `A folha de ${mesAno} já foi fechada para ${funcionarioNome}. Reabra a folha desse mês na tela de Holerites antes de abonar o dia.` };
    }

    const { data: existente } = await db.from('folha_ponto_abono')
      .select('id, origem')
      .eq('funcionario_nome', funcionarioNome)
      .eq('data_abono', dataAbono)
      .maybeSingle();

    // Abono aprovado via WhatsApp (origem legal) só é sobrescrito com
    // confirmação explícita — mesma regra usada no lançamento manual de ponto.
    const sobrepondoWhatsapp = existente?.origem === 'WHATSAPP';
    if (sobrepondoWhatsapp && !confirmarSobreposicaoWhatsapp) {
      return { ok: false, erro: 'Este dia já tem abono confirmado via WhatsApp. Confirme a sobreposição para corrigir mesmo assim.' };
    }

    if (existente) {
      const { error } = await db.from('folha_ponto_abono').update({
        dia_todo: true, hora_inicio: null, hora_fim: null,
        minutos_abonados: 480, motivo, origem: 'MANUAL_RH'
      }).eq('id', existente.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await db.from('folha_ponto_abono').insert({
        funcionario_nome: funcionarioNome, empresa_id: func?.empresa_id ?? null, data_abono: dataAbono,
        dia_todo: true, hora_inicio: null, hora_fim: null,
        minutos_abonados: 480, motivo, origem: 'MANUAL_RH'
      });
      if (error) throw new Error(error.message);
    }

    await registrarLogAuditoria({
      usuario_nome: usuarioNome,
      acao: sobrepondoWhatsapp
        ? `CORREÇÃO DE ABONO SOBRE DIA CONFIRMADO VIA WHATSAPP — ${funcionarioNome} em ${dataAbono}`
        : `ABONO DE DIA (MANUAL) — ${funcionarioNome} em ${dataAbono}: ${motivo}`,
      setor: 'RECURSOS HUMANOS / PONTO'
    });

    return { ok: true, info: { sobrepondoWhatsapp } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}