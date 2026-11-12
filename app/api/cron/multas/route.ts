import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { executarConsultaVeiculo, sincronizarPagamentoOps, type VeiculoConsulta } from '../../../lib/multasCore';
import { provedorConfigurado, validadeCertificadoA1 } from '../../../lib/consultaDebitosVeiculares';
import { dispararAutomacoesPorEventoWhatsApp } from '../../../lib/automacoes';
import { notificarPush } from '../../../lib/push';
import { formatarMoeda } from '../../../lib/formatadores';

// Consulta semanal de Multas e Débitos (/admin/operacional/multas).
//
// Agenda (vercel.json): segunda-feira, a cada 20 min entre 9h e 10h40 UTC
// (6h–7h40 em Brasília) — 6 execuções. Cada consulta na Infosimples leva
// ~30–60s, então cada execução consulta só alguns veículos (orçamento de
// tempo abaixo) e a seguinte continua de onde parou: pega os veículos
// PRÓPRIOS cuja última consulta OK tem mais de 5 dias. Alugado fica de fora
// (lançamento manual — decisão do usuário 2026-11-10).
//
// Liga/desliga: card "consulta-semanal-multas" em Parâmetros → Agendamentos.
// Multas novas → push (quem acessa a tela) + WhatsApp pelo evento
// NOVAS_MULTAS_FROTA (card "multas-novas-frota", destinatários escolhidos lá).
export const maxDuration = 300;

const CHAVE_CARD_CONTROLE = 'consulta-semanal-multas';
const ROTA_TELA = '/admin/operacional/multas';
const DIAS_SEM_RECONSULTAR = 5;
const ORCAMENTO_MS = 200_000; // para de iniciar consulta nova depois disso
const fmtBRL = formatarMoeda;

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }

  const inicio = Date.now();
  const db = supabaseAdmin();

  const { data: card } = await db.from('parametros_automacoes').select('ativo').eq('chave', CHAVE_CARD_CONTROLE).maybeSingle();
  if (!card || card.ativo === false) {
    return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada (ou card ainda não criado) em Agendamentos e Disparos.' });
  }
  if (!provedorConfigurado()) {
    return NextResponse.json({ success: false, executado: false, motivo: 'Infosimples sem token/certificado configurado.' });
  }

  // Certificado A1 vencido: nem tenta (a Infosimples recusaria) e avisa.
  const cert = await validadeCertificadoA1();
  if (cert && cert.diasRestantes < 0) {
    await notificarPush(ROTA_TELA, 'Certificado A1 vencido', `A consulta automática de multas parou: o certificado de ${cert.titular} venceu. Atualize-o no servidor.`);
    return NextResponse.json({ success: false, executado: false, motivo: 'Certificado A1 vencido.' });
  }

  // OP paga → multa paga (antes de consultar, pra não contar como "em aberto").
  await sincronizarPagamentoOps(db);

  const { data: veiculosData } = await db.from('frota_veiculos')
    .select('id, apelido, placa, renavam, empresa_id, propriedade, status')
    .eq('propriedade', 'PRÓPRIO').neq('status', 'INATIVO')
    .not('placa', 'is', null).not('renavam', 'is', null);
  const veiculos = (veiculosData || []) as (VeiculoConsulta & { status: string })[];

  const limite = new Date(Date.now() - DIAS_SEM_RECONSULTAR * 86400000).toISOString();
  const { data: recentes } = await db.from('frota_multas_consultas')
    .select('veiculo_id').eq('status', 'OK').eq('servico', 'detran/sp/debitos').gte('consultado_em', limite);
  const jaConsultados = new Set(((recentes || []) as { veiculo_id: string }[]).map(r => r.veiculo_id));
  const pendentes = veiculos.filter(v => !jaConsultados.has(v.id));

  const resumo: { veiculo: string; ok: boolean; novos: number; erro?: string }[] = [];
  const novosParaAviso: string[] = [];
  let valorNovos = 0;

  for (const v of pendentes) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const r = await executarConsultaVeiculo(db, v, 'CONSULTA AUTOMÁTICA');
    resumo.push({ veiculo: `${v.apelido} (${v.placa})`, ok: r.ok, novos: r.novos, erro: r.erro });
    r.novosItens.forEach(n => {
      valorNovos += n.valor;
      novosParaAviso.push(`• ${v.apelido} (${v.placa}): ${n.tipo === 'MULTA' ? `multa ${n.auto_infracao || ''}` : n.descricao || n.tipo} — ${fmtBRL(n.valor)}`);
    });
  }

  if (novosParaAviso.length) {
    const titulo = `${novosParaAviso.length} multa(s)/débito(s) novo(s) na frota`;
    const corpo = `Total ${fmtBRL(valorNovos)}. Veja em Operacional → Multas e Débitos.`;
    try { await notificarPush(ROTA_TELA, titulo, corpo); } catch (e) { console.error('Push de multas novas falhou:', e); }
    try {
      const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
      await dispararAutomacoesPorEventoWhatsApp('NOVAS_MULTAS_FROTA', {
        quantidade: novosParaAviso.length,
        valor: fmtBRL(valorNovos),
        lista: novosParaAviso.slice(0, 15).join('\n') + (novosParaAviso.length > 15 ? `\n… e mais ${novosParaAviso.length - 15}` : ''),
        // Template da Meta não aceita quebra de linha dentro de variável —
        // versão em linha única pro Message Template.
        lista_resumo: novosParaAviso.slice(0, 8).map(l => l.replace(/^•\s*/, '')).join('; ')
          + (novosParaAviso.length > 8 ? `; … e mais ${novosParaAviso.length - 8}` : ''),
        link: `${baseUrl}${ROTA_TELA}`,
      });
    } catch (e) { console.error('WhatsApp de multas novas falhou:', e); }
  }

  // Prazo de indicação do condutor vencendo (≤ 7 dias) — o que evita multa
  // por não identificação. Só na execução que consultou algo (1x/semana).
  if (resumo.length > 0) {
    const limitePrazo = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const { data: prazos } = await db.from('frota_multas_debitos')
      .select('id').eq('tipo', 'MULTA').eq('status', 'ABERTO')
      .is('condutor_indicado_em', null).not('prazo_indicacao_condutor', 'is', null)
      .lte('prazo_indicacao_condutor', limitePrazo);
    const qtdPrazos = (prazos || []).length;
    if (qtdPrazos > 0) {
      try {
        await notificarPush(ROTA_TELA, 'Prazo de indicação de condutor', `${qtdPrazos} multa(s) com prazo para indicar o condutor vencendo em até 7 dias. Sem a indicação vem a multa por não identificação.`);
      } catch (e) { console.error('Push de prazo de indicação falhou:', e); }
    }
  }

  // Aviso de certificado perto de vencer — no máximo uma vez por semana
  // (só na execução que ainda tinha veículo pra consultar).
  if (cert && cert.diasRestantes <= 30 && resumo.length > 0) {
    try {
      await notificarPush(ROTA_TELA, 'Certificado A1 vencendo', `O certificado de ${cert.titular} vence em ${cert.diasRestantes} dia(s). Sem ele a consulta de multas para.`);
    } catch (e) { console.error('Push de certificado falhou:', e); }
  }

  await db.from('parametros_automacoes').update({ ultima_execucao: new Date().toISOString() }).eq('chave', CHAVE_CARD_CONTROLE);

  return NextResponse.json({
    success: true,
    executado: true,
    consultados: resumo.length,
    restantes: pendentes.length - resumo.length,
    novos: novosParaAviso.length,
    resumo,
  });
}
