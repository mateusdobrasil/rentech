import { NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { atualizarPrazosSenatran, type VeiculoConsulta } from '../../../lib/multasCore';
import { provedorConfigurado, validadeCertificadoA1 } from '../../../lib/consultaDebitosVeiculares';
import { notificarPush } from '../../../lib/push';

// Prazos de indicação do condutor pela SENATRAN (Multas e Débitos).
//
// Agenda (vercel.json): segunda, a cada 20 min entre 11h e 12h40 UTC
// (8h–9h40 em Brasília) — depois da consulta do Detran (6h–7h40), pra já
// achar as multas que ela trouxe. Cada execução processa os veículos
// PRÓPRIOS sem consulta senatran/infracoes OK nos últimos 5 dias, dentro do
// orçamento de tempo. Liga/desliga junto com a consulta semanal (card
// "consulta-semanal-multas").
export const maxDuration = 300;

const CHAVE_CARD_CONTROLE = 'consulta-semanal-multas';
const ROTA_TELA = '/admin/operacional/multas';
const ORCAMENTO_MS = 180_000;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Acesso Não Autorizado' }, { status: 401 });
  }
  const inicio = Date.now();
  const db = supabaseAdmin();

  const { data: card } = await db.from('parametros_automacoes').select('ativo').eq('chave', CHAVE_CARD_CONTROLE).maybeSingle();
  if (!card || card.ativo === false) return NextResponse.json({ success: true, executado: false, motivo: 'Rotina desativada em Agendamentos e Disparos.' });
  if (!provedorConfigurado()) return NextResponse.json({ success: false, executado: false, motivo: 'Infosimples sem token/certificado configurado.' });
  const cert = await validadeCertificadoA1();
  if (cert && cert.diasRestantes < 0) return NextResponse.json({ success: false, executado: false, motivo: 'Certificado A1 vencido.' });

  const { data: veiculosData } = await db.from('frota_veiculos')
    .select('id, apelido, placa, renavam, empresa_id, propriedade, status')
    .eq('propriedade', 'PRÓPRIO').neq('status', 'INATIVO').not('placa', 'is', null);
  const veiculos = (veiculosData || []) as (VeiculoConsulta & { status: string })[];

  const limite = new Date(Date.now() - 5 * 86400000).toISOString();
  const { data: recentes } = await db.from('frota_multas_consultas')
    .select('veiculo_id').eq('servico', 'senatran/infracoes').eq('status', 'OK').gte('consultado_em', limite);
  const feitos = new Set(((recentes || []) as { veiculo_id: string }[]).map(r => r.veiculo_id));
  const pendentes = veiculos.filter(v => !feitos.has(v.id));

  const resumo: { veiculo: string; ok: boolean; novas: number; prazos: number; erro?: string }[] = [];
  let novasTotal = 0;
  for (const v of pendentes) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const r = await atualizarPrazosSenatran(db, v, 'CONSULTA AUTOMÁTICA');
    resumo.push({ veiculo: `${v.apelido} (${v.placa})`, ok: r.ok, novas: r.novas, prazos: r.prazos, erro: r.erro });
    novasTotal += r.novas;
  }

  if (novasTotal > 0) {
    try {
      await notificarPush(ROTA_TELA, 'Infrações novas na Senatran', `${novasTotal} infração(ões) nova(s) ainda no prazo de indicar o condutor. Veja em Operacional → Multas e Débitos.`);
    } catch (e) { console.error('Push de infrações Senatran falhou:', e); }
  }

  return NextResponse.json({ success: true, executado: true, consultados: resumo.length, restantes: pendentes.length - resumo.length, resumo });
}
