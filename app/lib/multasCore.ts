// app/lib/multasCore.ts
// Regras de negócio de Multas e Débitos que precisam rodar SEM sessão de
// usuário (cron semanal em app/api/cron/multas) e também pela tela
// (/admin/operacional/multas via actions-multas.ts). Sem "use server" de
// propósito: quem chama é responsável por validar acesso/empresa antes.
import { supabaseAdmin } from './supabase';
import { consultarDebitosVeiculo, consultarInfracoesSenatran, baixarInfracaoSenatran, type DebitoConsultado } from './consultaDebitosVeiculares';
import { resolverProvedor, enviarComJanela, type TemplateMeta } from './whatsapp';
import { registrarLogAuditoria } from '../actions';
import { formatarMoeda, formatarDataBR } from './formatadores';

type Db = ReturnType<typeof supabaseAdmin>;

export const CHAVE_AVISO_CONDUTOR = 'multa-aviso-condutor';
const TEMPLATE_AVISO_CONDUTOR_PADRAO = 'multa_aviso_condutor';

const fmtBRL = formatarMoeda;
const fmtDataBR = (d: string | null | undefined) => formatarDataBR(d, '');

// "MULTA, POR NAO IDENTIFICACAO DO CONDUTOR INFRATOR, IMPOSTA A PESSOA JURIDICA"
export function ehNic(descricao: string | null | undefined): boolean {
  return /N[AÃ]O IDENTIFICA[CÇ][AÃ]O DO CONDUTOR/i.test(descricao || '');
}

export interface VeiculoConsulta {
  id: string; apelido: string; placa: string | null; renavam: string | null; empresa_id: number | null; propriedade: string | null;
}

export interface ResultadoConsultaVeiculo {
  ok: boolean;
  erro?: string;
  encontrados: number;
  novos: number;
  baixados: number;
  valorTotal: number;
  avisos: string[];
  preco: number | null;
  novosItens: { tipo: string; auto_infracao: string | null; descricao: string | null; valor: number; data_vencimento: string | null }[];
}

// ---------------------------------------------------------------------------
// Consulta de um veículo + gravação (dedup, adoção de manual, baixa automática)
// ---------------------------------------------------------------------------
export async function executarConsultaVeiculo(db: Db, veiculo: VeiculoConsulta, usuario: string): Promise<ResultadoConsultaVeiculo> {
  const vazio = { encontrados: 0, novos: 0, baixados: 0, valorTotal: 0, avisos: [], preco: null, novosItens: [] };

  // Decisão do usuário (2026-11-10): alugado é só lançamento manual.
  if (veiculo.propriedade === 'ALUGADO') return { ...vazio, ok: false, erro: `${veiculo.apelido} é alugado — multas de veículo alugado são lançadas manualmente.` };
  if (!veiculo.placa || !veiculo.renavam) return { ...vazio, ok: false, erro: `Cadastre placa e Renavam do veículo ${veiculo.apelido} no Controle de Frota antes de consultar.` };

  const resultado = await consultarDebitosVeiculo({ placa: veiculo.placa, renavam: veiculo.renavam, uf: 'SP' });

  const registrarConsulta = async (extra: { encontrados?: number; novos?: number; baixados?: number; valor_total?: number | null }) => {
    await db.from('frota_multas_consultas').insert([{
      empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id,
      provedor: resultado.provedor, servico: resultado.servico,
      status: resultado.ok ? 'OK' : 'ERRO', codigo: resultado.codigo,
      mensagem: [resultado.mensagem, ...resultado.avisos].filter(Boolean).join(' | ').slice(0, 2000),
      encontrados: extra.encontrados ?? 0, novos: extra.novos ?? 0, baixados: extra.baixados ?? 0,
      valor_total: extra.valor_total ?? null, preco: resultado.preco, site_receipt: resultado.siteReceipt,
      resposta: resultado.resposta, consultado_por: usuario,
    }]);
  };

  if (!resultado.ok) {
    await registrarConsulta({});
    return { ...vazio, ok: false, erro: resultado.mensagem, preco: resultado.preco };
  }

  const encontrados: DebitoConsultado[] = resultado.debitos;

  try {
    const agora = new Date().toISOString();
    const { data: existentesData, error: exErr } = await db.from('frota_multas_debitos')
      .select('id, chave_externa, tipo, status, baixa_automatica, origem, auto_infracao, fonte').eq('veiculo_id', veiculo.id);
    if (exErr) throw new Error(exErr.message);
    type Existente = { id: string; chave_externa: string; tipo: string; status: string; baixa_automatica: boolean; origem: string; auto_infracao: string | null; fonte: string | null };
    const existentesLista = (existentesData || []) as Existente[];
    const existentes = new Map(existentesLista.map(e => [e.chave_externa, e]));
    // Multa lançada à mão antes de chegar no Detran: quando o mesmo AIT
    // aparece na consulta, a linha manual é "adotada" (mantém condutor,
    // desconto e OP) em vez de nascer uma duplicada.
    const manuaisPorAuto = new Map(existentesLista
      .filter(e => e.origem === 'MANUAL' && e.auto_infracao)
      .map(e => [String(e.auto_infracao).toUpperCase(), e]));

    const novosItens: ResultadoConsultaVeiculo['novosItens'] = [];
    const chavesVistas = new Set<string>();
    for (const d of encontrados) {
      if (chavesVistas.has(d.chave)) continue;
      chavesVistas.add(d.chave);
      const campos = {
        empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id, tipo: d.tipo, origem: 'CONSULTA_API', fonte: d.fonte,
        descricao: d.descricao, auto_infracao: d.auto_infracao, orgao_autuador: d.orgao_autuador,
        data_infracao: d.data_infracao, hora_infracao: d.hora_infracao, local_infracao: d.local_infracao, municipio: d.municipio,
        exercicio: d.exercicio, cota: d.cota, valor: d.valor, data_vencimento: d.data_vencimento,
        eh_nic: d.tipo === 'MULTA' && ehNic(d.descricao),
        dados_brutos: d.bruto, ultima_consulta_em: agora, updated_at: agora,
      };
      const manualMesmoAuto = d.auto_infracao ? manuaisPorAuto.get(d.auto_infracao.toUpperCase()) : undefined;
      const atual = existentes.get(d.chave);
      if (!atual && manualMesmoAuto) {
        const { error } = await db.from('frota_multas_debitos').update({
          ...campos, chave_externa: d.chave, primeira_consulta_em: agora,
        }).eq('id', manualMesmoAuto.id);
        if (error) throw new Error(error.message);
        manuaisPorAuto.delete(d.auto_infracao!.toUpperCase());
      } else if (atual) {
        // Reapareceu depois de uma baixa automática → volta a ficar em aberto.
        // Baixa/cancelamento MANUAL é respeitado (o usuário pode ter pago e o
        // Detran ainda não ter processado).
        const reabrir = atual.status === 'PAGO' && atual.baixa_automatica;
        const { error } = await db.from('frota_multas_debitos').update({
          ...campos,
          ...(reabrir ? { status: 'ABERTO', baixa_automatica: false, pago_em: null, status_alterado_por: 'CONSULTA AUTOMÁTICA' } : {}),
        }).eq('id', atual.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await db.from('frota_multas_debitos').insert([{
          ...campos, chave_externa: d.chave, status: 'ABERTO', primeira_consulta_em: agora, criado_por: usuario,
        }]);
        if (error) throw new Error(error.message);
        novosItens.push({ tipo: d.tipo, auto_infracao: d.auto_infracao, descricao: d.descricao, valor: d.valor, data_vencimento: d.data_vencimento });
      }
    }

    // Baixa automática: só de débitos vindos da API, ainda ABERTOS, cujo tipo
    // teve a seção devolvida completa nesta consulta.
    const paraBaixar = existentesLista.filter(e =>
      e.origem === 'CONSULTA_API' && e.status === 'ABERTO' && !chavesVistas.has(e.chave_externa)
      // Multa que veio da SENATRAN ainda pode não estar no Detran (autuação em
      // prazo de indicação) — sumir do Detran não quer dizer que foi paga.
      && e.fonte !== 'SENATRAN'
      && (e.tipo === 'MULTA' || e.tipo === 'IPVA' || e.tipo === 'LICENCIAMENTO')
      && resultado.secaoConfiavel[e.tipo as 'MULTA' | 'IPVA' | 'LICENCIAMENTO']
    );
    if (paraBaixar.length) {
      const { error } = await db.from('frota_multas_debitos').update({
        status: 'PAGO', baixa_automatica: true, pago_em: agora, status_alterado_por: 'CONSULTA AUTOMÁTICA', updated_at: agora,
      }).in('id', paraBaixar.map(e => e.id));
      if (error) throw new Error(error.message);
    }

    await vincularNics(db, [veiculo.id]);

    const valorTotal = Math.round(encontrados.reduce((s, d) => s + d.valor, 0) * 100) / 100;
    await registrarConsulta({ encontrados: chavesVistas.size, novos: novosItens.length, baixados: paraBaixar.length, valor_total: valorTotal });

    registrarLogAuditoria({
      usuario_nome: usuario, acao: 'CONSULTOU MULTAS E DÉBITOS', setor: 'OPERACIONAL',
      equipamento_id: veiculo.id, equipamento_nome: `${veiculo.apelido} (${veiculo.placa}) — ${chavesVistas.size} débito(s), ${novosItens.length} novo(s)`,
    });

    return { ok: true, encontrados: chavesVistas.size, novos: novosItens.length, baixados: paraBaixar.length, valorTotal, avisos: resultado.avisos, preco: resultado.preco, novosItens };
  } catch (e) {
    await registrarConsulta({});
    return { ...vazio, ok: false, erro: `A consulta respondeu, mas falhou ao gravar: ${e instanceof Error ? e.message : String(e)}`, preco: resultado.preco };
  }
}

// ---------------------------------------------------------------------------
// NIC → infração de origem
// A NIC nasce quando o prazo de indicar o condutor da infração original
// vence (~30–60 dias depois). Liga com a multa NÃO-NIC do mesmo veículo e
// mesmo órgão autuador cuja data de infração é a mais próxima ANTES da NIC
// (janela de até 150 dias). Se a original já foi paga e saiu do Detran antes
// de entrar no sistema, a NIC fica sem vínculo — a tela mostra isso.
// ---------------------------------------------------------------------------
const normOrgao = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export async function vincularNics(db: Db, veiculoIds: string[] | null): Promise<number> {
  let q = db.from('frota_multas_debitos')
    .select('id, veiculo_id, descricao, orgao_autuador, data_infracao, eh_nic, multa_origem_id, tipo')
    .eq('tipo', 'MULTA');
  if (veiculoIds) q = q.in('veiculo_id', veiculoIds);
  const { data, error } = await q;
  if (error || !data) return 0;

  type Linha = { id: string; veiculo_id: string; descricao: string | null; orgao_autuador: string | null; data_infracao: string | null; eh_nic: boolean; multa_origem_id: string | null };
  const linhas = data as Linha[];

  // Marca NIC que ainda não estava marcada (ex.: lançamento manual).
  const semMarca = linhas.filter(l => !l.eh_nic && ehNic(l.descricao)).map(l => l.id);
  if (semMarca.length) {
    await db.from('frota_multas_debitos').update({ eh_nic: true }).in('id', semMarca);
    linhas.forEach(l => { if (semMarca.includes(l.id)) l.eh_nic = true; });
  }

  let vinculadas = 0;
  for (const nic of linhas.filter(l => l.eh_nic && !l.multa_origem_id && l.data_infracao)) {
    const dataNic = new Date(`${nic.data_infracao}T00:00:00`).getTime();
    const candidatas = linhas
      .filter(o => !o.eh_nic && o.veiculo_id === nic.veiculo_id && o.data_infracao
        && normOrgao(o.orgao_autuador) === normOrgao(nic.orgao_autuador))
      .map(o => ({ o, dias: (dataNic - new Date(`${o.data_infracao}T00:00:00`).getTime()) / 86400000 }))
      .filter(c => c.dias >= 1 && c.dias <= 150)
      .sort((a, b) => a.dias - b.dias);
    if (candidatas.length) {
      const { error: e2 } = await db.from('frota_multas_debitos').update({ multa_origem_id: candidatas[0].o.id }).eq('id', nic.id);
      if (!e2) vinculadas++;
    }
  }
  return vinculadas;
}

// ---------------------------------------------------------------------------
// Aviso ao condutor por WhatsApp (template Meta "multa_aviso_condutor")
// Card de controle em parametros_automacoes (chave multa-aviso-condutor):
// ativo=false bloqueia; sem o card, segue com os defaults.
// ---------------------------------------------------------------------------
export async function enviarAvisoCondutor(db: Db, debitoId: string, usuario: string): Promise<{ ok: boolean; erro?: string }> {
  const { data: d } = await db.from('frota_multas_debitos')
    .select('id, veiculo_id, condutor_nome, descricao, auto_infracao, valor, data_infracao, desconto_lancado_em, desconto_parcelas, desconto_valor_parcela, desconto_mes_inicio')
    .eq('id', debitoId).maybeSingle();
  if (!d) return { ok: false, erro: 'Débito não encontrado.' };
  if (!d.condutor_nome) return { ok: false, erro: 'Defina o condutor antes de avisar.' };

  const { data: automacao } = await db.from('parametros_automacoes')
    .select('ativo, canais, meta_template_nome, meta_template_idioma').eq('chave', CHAVE_AVISO_CONDUTOR).maybeSingle();
  if (automacao && (automacao.ativo === false || !(automacao.canais || []).includes('WhatsApp'))) {
    return { ok: false, erro: 'Aviso ao condutor desativado em Parâmetros → Agendamentos e Disparos.' };
  }

  const { data: func } = await db.from('folha_funcionarios').select('celular').eq('nome_completo', d.condutor_nome).maybeSingle();
  if (!func?.celular) return { ok: false, erro: `${d.condutor_nome} não tem celular cadastrado no RH.` };

  const { data: veic } = await db.from('frota_veiculos').select('placa, apelido').eq('id', d.veiculo_id).maybeSingle();
  const primeiroNome = d.condutor_nome.split(' ')[0];
  const placa = veic ? `${veic.apelido} (${veic.placa})` : '-';
  const dataTxt = fmtDataBR(d.data_infracao) || '-';
  const descricao = `${d.descricao || 'Infração de trânsito'}${d.auto_infracao ? ` (AIT ${d.auto_infracao})` : ''}`;
  const valor = fmtBRL(Number(d.valor));
  const desconto = d.desconto_lancado_em
    ? `Será descontado em folha: ${d.desconto_parcelas}x de ${fmtBRL(Number(d.desconto_valor_parcela))} a partir de ${(d.desconto_mes_inicio || '').split('-').reverse().join('/')}.`
    : 'Você foi identificado como o condutor do veículo nesta data.';

  const texto = `Olá ${primeiroNome}! Foi identificada uma multa de trânsito no veículo ${placa}, em ${dataTxt}:\n\n${descricao}\nValor: ${valor}\n${desconto}\n\nQualquer dúvida, fale com o responsável pela frota.`;
  const template: TemplateMeta = {
    nome: automacao?.meta_template_nome || TEMPLATE_AVISO_CONDUTOR_PADRAO,
    idioma: automacao?.meta_template_idioma || 'pt_BR',
    parametros: [primeiroNome, placa, dataTxt, descricao, valor, desconto],
  };

  const provedor = await resolverProvedor('ENVIO');
  const res = await enviarComJanela(provedor, func.celular, texto, template);
  if (!res.ok) return { ok: false, erro: `Falha ao enviar o WhatsApp para ${d.condutor_nome}.` };

  const agora = new Date().toISOString();
  await db.from('frota_multas_debitos').update({ condutor_avisado_em: agora, condutor_avisado_por: usuario }).eq('id', d.id);
  await db.from('parametros_automacoes_envios').insert({ chave: CHAVE_AVISO_CONDUTOR, canal: 'WhatsApp', quantidade: 1 });
  await db.from('parametros_automacoes').update({ ultima_execucao: agora }).eq('chave', CHAVE_AVISO_CONDUTOR);
  registrarLogAuditoria({
    usuario_nome: usuario, acao: 'AVISOU CONDUTOR DA MULTA (WHATSAPP)', setor: 'OPERACIONAL',
    equipamento_id: d.id, equipamento_nome: `${d.condutor_nome} — AIT ${d.auto_infracao || 'S/N'}`,
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Prazos de indicação do condutor pela SENATRAN (SNE)
// 1) senatran/infracoes lista as infrações não pagas do veículo (1 chamada);
// 2) senatran/download-infracao só para multa nova ou ainda sem prazo — traz
//    data-limite de indicação/defesa e o condutor (se já indicado).
// Infração que está na Senatran mas ainda não no Detran (autuação dentro do
// prazo de indicação) entra já aqui, com fonte SENATRAN — é o momento em que
// ainda dá pra indicar e evitar a multa por não identificação (NIC).
// ---------------------------------------------------------------------------
export interface ResultadoPrazosSenatran {
  ok: boolean; erro?: string;
  infracoes: number; novas: number; prazos: number; indicadas: number; detalhes: number; historico: number; pagasFora: number;
  preco: number; avisos: string[];
}

const MAX_DETALHES_POR_VEICULO = 8;

// Trava por veículo na instância do servidor: duas buscas simultâneas do
// mesmo veículo pagariam os mesmos detalhes duas vezes.
const prazosEmAndamento = new Set<string>();

export async function atualizarPrazosSenatran(db: Db, veiculo: VeiculoConsulta, usuario: string): Promise<ResultadoPrazosSenatran> {
  const vazio = { infracoes: 0, novas: 0, prazos: 0, indicadas: 0, detalhes: 0, historico: 0, pagasFora: 0, preco: 0, avisos: [] as string[] };
  if (prazosEmAndamento.has(veiculo.id)) return { ...vazio, ok: false, erro: `Já existe uma busca na Senatran em andamento para ${veiculo.apelido}.` };
  prazosEmAndamento.add(veiculo.id);
  try {
    return await atualizarPrazosSenatranInterno(db, veiculo, usuario);
  } finally {
    prazosEmAndamento.delete(veiculo.id);
  }
}

async function atualizarPrazosSenatranInterno(db: Db, veiculo: VeiculoConsulta, usuario: string): Promise<ResultadoPrazosSenatran> {
  const vazio = { infracoes: 0, novas: 0, prazos: 0, indicadas: 0, detalhes: 0, historico: 0, pagasFora: 0, preco: 0, avisos: [] as string[] };
  if (veiculo.propriedade === 'ALUGADO') return { ...vazio, ok: false, erro: `${veiculo.apelido} é alugado — fora da consulta automática.` };
  if (!veiculo.placa) return { ...vazio, ok: false, erro: `Veículo ${veiculo.apelido} sem placa.` };

  let cnpj: string | null = null;
  if (veiculo.empresa_id) {
    const { data: emp } = await db.from('empresas').select('cnpj').eq('id', veiculo.empresa_id).maybeSingle();
    cnpj = (emp?.cnpj as string | null) || null;
  }

  const registrar = async (servico: string, ok: boolean, codigo: number | null, mensagem: string, preco: number | null, encontrados: number, novos: number, resposta: unknown) => {
    await db.from('frota_multas_consultas').insert([{
      empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id, provedor: 'INFOSIMPLES', servico,
      status: ok ? 'OK' : 'ERRO', codigo, mensagem: mensagem.slice(0, 2000), encontrados, novos, baixados: 0,
      preco, resposta, consultado_por: usuario,
    }]);
  };

  const lista = await consultarInfracoesSenatran({ placa: veiculo.placa, cnpj });
  let preco = lista.preco || 0;
  if (!lista.ok) {
    await registrar(lista.servico, false, lista.codigo, lista.mensagem, lista.preco, 0, 0, lista.resposta);
    return { ...vazio, ok: false, erro: lista.mensagem, preco };
  }
  // Só o que está em aberto (a Senatran usa NAO_PAGAS_A_VENCER / NAO_PAGAS_VENCIDAS).
  const abertas = lista.infracoes.filter(i => !i.situacao || /N[AÃ]O_?PAGA/i.test(i.situacao));

  const { data: existentesData } = await db.from('frota_multas_debitos')
    .select('id, auto_infracao, status, prazo_indicacao_condutor, condutor_indicado_em, orgao_autuador, data_infracao, eh_nic')
    .eq('veiculo_id', veiculo.id).eq('tipo', 'MULTA');
  type Ex = { id: string; auto_infracao: string | null; status: string; prazo_indicacao_condutor: string | null; condutor_indicado_em: string | null; orgao_autuador: string | null; data_infracao: string | null; eh_nic: boolean };
  const porAit = new Map(((existentesData || []) as Ex[]).map(e => [(e.auto_infracao || '').toUpperCase().replace(/[^A-Z0-9]/g, ''), e]));

  const agora = new Date().toISOString();
  let novas = 0, prazos = 0, indicadas = 0, detalhes = 0;
  const avisos: string[] = [];

  for (const inf of abertas) {
    const atual = porAit.get(inf.ait);
    if (atual && atual.status !== 'ABERTO') continue;

    // NIC (multa por não identificação) não tem indicação de condutor: não
    // paga detalhe. Se for nova, entra só com os dados da lista.
    if (atual?.eh_nic || ehNic(inf.descricao)) {
      if (!atual) {
        const { error } = await db.from('frota_multas_debitos').insert([{
          empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id, tipo: 'MULTA', origem: 'CONSULTA_API', fonte: 'SENATRAN',
          chave_externa: `MULTA:${inf.ait}`, auto_infracao: inf.ait, descricao: inf.descricao, orgao_autuador: inf.codigo_orgao,
          codigo_infracao: inf.codigo_infracao, valor: inf.valor, data_vencimento: inf.data_vencimento, eh_nic: true,
          status: 'ABERTO', primeira_consulta_em: agora, ultima_consulta_em: agora, criado_por: usuario, updated_at: agora,
        }]);
        if (!error) novas++;
      }
      continue;
    }
    // Prazo já conhecido/indicação feita: nada a buscar. Infração com mais de
    // 90 dias: o prazo de indicação (≈30 dias da notificação) já passou.
    if (atual && (atual.prazo_indicacao_condutor || atual.condutor_indicado_em)) continue;
    if (atual?.data_infracao && (Date.now() - new Date(`${atual.data_infracao}T00:00:00`).getTime()) / 86400000 > 90) continue;
    if (detalhes >= MAX_DETALHES_POR_VEICULO) { avisos.push(`Limite de ${MAX_DETALHES_POR_VEICULO} detalhes por consulta atingido — o restante entra na próxima.`); break; }

    const det = await baixarInfracaoSenatran({ chave: inf.chave, placa: veiculo.placa, cnpj });
    detalhes++;
    preco += det.preco || 0;
    await registrar(det.servico, det.ok, det.codigo, det.ok ? `AIT ${inf.ait}: prazo indicação ${det.detalhe?.prazo_indicacao || '—'}` : det.mensagem, det.preco, det.ok ? 1 : 0, 0, det.resposta);
    if (!det.ok || !det.detalhe) { avisos.push(`AIT ${inf.ait}: ${det.mensagem}`); continue; }
    const d = det.detalhe;

    const indicado = !!d.condutor_nome;
    const camposPrazo = {
      ...(d.prazo_indicacao ? { prazo_indicacao_condutor: d.prazo_indicacao } : {}),
      ...(d.prazo_defesa ? { prazo_defesa: d.prazo_defesa } : {}),
      ...(indicado ? { condutor_indicado_em: agora, condutor_indicado_por: `SENATRAN (${d.condutor_nome})`.slice(0, 120) } : {}),
      updated_at: agora,
    };

    if (atual) {
      const { error } = await db.from('frota_multas_debitos').update({
        ...camposPrazo,
        ...(d.codigo_infracao ? { codigo_infracao: d.codigo_infracao } : {}),
      }).eq('id', atual.id);
      if (!error) { if (d.prazo_indicacao) prazos++; if (indicado) indicadas++; }
    } else {
      const descricao = d.descricao || inf.descricao;
      const { error } = await db.from('frota_multas_debitos').insert([{
        empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id, tipo: 'MULTA', origem: 'CONSULTA_API', fonte: 'SENATRAN',
        chave_externa: `MULTA:${inf.ait}`, auto_infracao: inf.ait,
        descricao, orgao_autuador: d.orgao_autuador || inf.codigo_orgao, codigo_infracao: d.codigo_infracao || inf.codigo_infracao,
        data_infracao: d.data_infracao, hora_infracao: d.hora_infracao, local_infracao: d.local_infracao, municipio: d.municipio,
        valor: d.valor || inf.valor, data_vencimento: inf.data_vencimento,
        eh_nic: ehNic(descricao), status: 'ABERTO', primeira_consulta_em: agora, ultima_consulta_em: agora, criado_por: usuario,
        ...camposPrazo,
      }]);
      if (!error) { novas++; if (d.prazo_indicacao) prazos++; if (indicado) indicadas++; }
      else avisos.push(`AIT ${inf.ait}: não foi possível gravar (${error.message}).`);
    }
  }

  // Histórico: infrações já pagas na Senatran. Sem custo extra (vêm na mesma
  // lista). Pagas que o sistema não conhecia entram como PAGO (completa
  // relatório/ranking); as que estavam ABERTAS aqui foram pagas fora do sistema.
  let historico = 0, pagasFora = 0;
  for (const p of lista.infracoes.filter(i => i.situacao && /^PAGA/i.test(i.situacao))) {
    const atual = porAit.get(p.ait);
    if (!atual) {
      const { error } = await db.from('frota_multas_debitos').insert([{
        empresa_id: veiculo.empresa_id, veiculo_id: veiculo.id, tipo: 'MULTA', origem: 'CONSULTA_API', fonte: 'SENATRAN',
        chave_externa: `MULTA:${p.ait}`, auto_infracao: p.ait, descricao: p.descricao, orgao_autuador: p.codigo_orgao,
        codigo_infracao: p.codigo_infracao, valor: p.valor, data_vencimento: p.data_vencimento, eh_nic: ehNic(p.descricao),
        status: 'PAGO', status_alterado_por: 'SENATRAN (já paga)', primeira_consulta_em: agora, ultima_consulta_em: agora,
        criado_por: usuario, updated_at: agora,
      }]);
      if (!error) historico++;
    } else if (atual.status === 'ABERTO') {
      const { error } = await db.from('frota_multas_debitos').update({
        status: 'PAGO', baixa_automatica: true, pago_em: agora, status_alterado_por: 'SENATRAN (consta paga)', updated_at: agora,
      }).eq('id', atual.id);
      if (!error) pagasFora++;
    }
  }

  await registrar(lista.servico, true, lista.codigo, `${abertas.length} infração(ões) em aberto na Senatran; ${novas} nova(s); ${prazos} prazo(s); ${indicadas} já indicada(s); ${historico} paga(s) no histórico${pagasFora ? `; ${pagasFora} paga(s) fora do sistema` : ''}`, lista.preco, abertas.length, novas, lista.resposta);
  if (novas) await vincularNics(db, [veiculo.id]);

  registrarLogAuditoria({
    usuario_nome: usuario, acao: 'CONSULTOU PRAZOS DE INDICAÇÃO (SENATRAN)', setor: 'OPERACIONAL',
    equipamento_id: veiculo.id, equipamento_nome: `${veiculo.apelido} (${veiculo.placa}) — ${abertas.length} infração(ões), ${novas} nova(s), ${prazos} prazo(s)`,
  });

  return { ok: true, infracoes: abertas.length, novas, prazos, indicadas, detalhes, historico, pagasFora, preco: Math.round(preco * 100) / 100, avisos };
}

// ---------------------------------------------------------------------------
// Aviso diário de prazo de indicação (fonte de dados MULTAS_PRAZO_INDICACAO
// do motor de automações — app/api/cron/motor). Multas ABERTAS, sem indicação
// marcada, com prazo entre hoje e daqui a 7 dias. null = nada a avisar (o
// motor não dispara).
// ---------------------------------------------------------------------------
export async function montarContextoPrazoIndicacao(empresaId: number | null): Promise<{ lista: string; quantidade: number } | null> {
  const db = supabaseAdmin();
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const limite = new Date(new Date(`${hoje}T12:00:00`).getTime() + 7 * 86400000).toISOString().slice(0, 10);
  let q = db.from('frota_multas_debitos')
    .select('auto_infracao, prazo_indicacao_condutor, condutor_nome, empresa_id, veiculo:frota_veiculos(apelido, placa)')
    .eq('tipo', 'MULTA').eq('status', 'ABERTO').is('condutor_indicado_em', null)
    .gte('prazo_indicacao_condutor', hoje).lte('prazo_indicacao_condutor', limite)
    .order('prazo_indicacao_condutor', { ascending: true });
  if (empresaId) q = q.or(`empresa_id.is.null,empresa_id.eq.${empresaId}`);
  const { data } = await q;
  const linhas = ((data || []) as unknown as { auto_infracao: string | null; prazo_indicacao_condutor: string; condutor_nome: string | null; veiculo: { apelido: string; placa: string } | null }[]);
  if (linhas.length === 0) return null;
  const lista = linhas.map(m => {
    const dias = Math.round((new Date(`${m.prazo_indicacao_condutor}T12:00:00`).getTime() - new Date(`${hoje}T12:00:00`).getTime()) / 86400000);
    const quando = dias === 0 ? 'HOJE' : `em ${dias} dia(s)`;
    return `• ${m.veiculo ? `${m.veiculo.apelido} (${m.veiculo.placa})` : '-'} — AIT ${m.auto_infracao || 'S/N'} — até ${fmtDataBR(m.prazo_indicacao_condutor)} (${quando}) — condutor: ${m.condutor_nome || 'a definir'}`;
  }).join('\n');
  return { lista, quantidade: linhas.length };
}

// ---------------------------------------------------------------------------
// OP paga → multa paga. Multa ABERTA ligada a uma OP com status PAGO passa a
// PAGO na hora, sem esperar sumir do Detran. Chamado ao abrir a tela e no cron.
// ---------------------------------------------------------------------------
export async function sincronizarPagamentoOps(db: Db): Promise<number> {
  const { data: abertas } = await db.from('frota_multas_debitos').select('id').eq('status', 'ABERTO');
  const ids = ((abertas || []) as { id: string }[]).map(a => a.id);
  if (ids.length === 0) return 0;
  const { data: ops } = await db.from('op_ordens_pagamento')
    .select('numero_op, status, pago_em, multa_debito_ids')
    .eq('status', 'PAGO').overlaps('multa_debito_ids', ids);
  let atualizadas = 0;
  for (const op of (ops || []) as { numero_op: number | null; pago_em: string | null; multa_debito_ids: string[] | null }[]) {
    const alvo = (op.multa_debito_ids || []).filter(id => ids.includes(id));
    if (!alvo.length) continue;
    const { error } = await db.from('frota_multas_debitos').update({
      status: 'PAGO', baixa_automatica: false, pago_em: op.pago_em || new Date().toISOString(),
      status_alterado_por: `OP #${op.numero_op ?? '?'} PAGA`, updated_at: new Date().toISOString(),
    }).in('id', alvo).eq('status', 'ABERTO');
    if (!error) atualizadas += alvo.length;
  }
  return atualizadas;
}
