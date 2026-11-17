// app/lib/locacao/dadosDocumentos.ts
// Carrega uma ficha com tudo que a PROPOSTA e o CONTRATO precisam (empresa,
// cliente, evento, itens com categoria, composição dos kits, ficha técnica de
// LED, vendedor, parcelas) e monta os dados de cada PDF. 2026-11-17.
// SEM checagem de acesso — quem chama já validou.
import type { supabaseAdmin } from '../supabase';
import { diasInclusivos, hojeISO } from './datas';
import { numeroFichaPorId } from './fichaNumero';
import { sugerirParcelas } from '../financeiro/parcelas';
import { formatarDocumento, nomeCategoria } from './pdfBase';
import { calcularLed, type EspecLed } from './ledTecnico';
import { PROPOSTA_EXTRAS_PADRAO, PROPOSTA_TERMO_PADRAO, CONTRATO_CLAUSULAS_PADRAO, ROTULO_FORMA_PAGAMENTO } from './textosPadrao';
import { GRUPO_SERVICOS, type DadosPropostaPdf } from './gerarPropostaPdf';
import type { DadosContratoPdf } from './gerarContratoPdf';

type Db = ReturnType<typeof supabaseAdmin>;
const MODALIDADE_ROTULO: Record<string, string> = { DIARIA: 'Por diária', PERIODO: 'Período fechado', MENSAL: 'Mensal' };
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

async function carregarContexto(db: Db, fichaId: number) {
  const { data: f, error } = await db.from('locacao_fichas_reserva').select('*').eq('id', fichaId).single();
  if (error) throw error;
  const [rEmp, rCli, rEv, rItens, rVend, rTit] = await Promise.all([
    db.from('empresas').select('*').eq('id', f.empresa_id).single(),
    db.from('parceiros').select('nome_exibicao, nome_completo, cnpj, cpf, inscricao_estadual, endereco1, numero1, complemento1, bairro1, cidade1, estado1, cep1, telefone1, email1').eq('id', f.parceiro_id).maybeSingle(),
    f.evento_id ? db.from('eventos_feiras').select('nome, local').eq('id', f.evento_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('locacao_fichas_reserva_itens').select('*, produto:produtos(codigo_formatado, unidade, categoria_nome)').eq('ficha_id', fichaId).order('ordem'),
    f.vendedor_id ? db.from('colaboradores').select('nome_exibicao, nome_completo, email1').eq('id', f.vendedor_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('financeiro_titulos_receber').select('valor, vencimento, status').eq('ficha_id', fichaId).neq('status', 'CANCELADO').order('vencimento'),
  ]);
  for (const r of [rEmp, rCli, rEv, rItens] as any[]) if (r.error) throw r.error;
  const itens: any[] = rItens.data || [];

  // composição dos kits
  const kitIds = itens.filter(i => i.tipo === 'KIT' && i.produto_id).map(i => i.produto_id);
  const composicao = new Map<number, string>();
  if (kitIds.length) {
    const { data: comps } = await db.from('locacao_kit_itens')
      .select('kit_produto_id, quantidade, opcional, componente:produtos!locacao_kit_itens_componente_produto_id_fkey(nome_item)')
      .in('kit_produto_id', kitIds).order('ordem');
    const porKit = new Map<number, string[]>();
    for (const c of (comps || []) as any[]) {
      porKit.set(c.kit_produto_id, [...(porKit.get(c.kit_produto_id) || []), `${n(c.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}x ${c.componente?.nome_item || ''}${c.opcional ? ' (opcional)' : ''}`]);
    }
    for (const [k, l] of porKit) composicao.set(k, l.join(' · '));
  }

  // ficha técnica de LED (tabela pode não existir antes do SQL)
  const led = new Map<number, EspecLed>();
  const prodIds = [...new Set(itens.map(i => i.produto_id).filter(Boolean))];
  if (prodIds.length) {
    const { data } = await db.from('locacao_produto_led').select('*').in('produto_id', prodIds);
    for (const r of (data || []) as any[]) led.set(r.produto_id, r as EspecLed);
  }

  const emp: any = rEmp.data, cli: any = rCli.data, ev: any = rEv.data, vend: any = rVend.data;
  const nomeEmp = `${emp?.nome_curto || ''} ${emp?.nome || ''}`.toUpperCase();
  return { f, emp, cli, ev, vend, itens, composicao, led, titulos: (rTit.data || []) as any[], logo: (/ALFA/.test(nomeEmp) ? 'ALFALIGHT' : 'RENTECH') as 'ALFALIGHT' | 'RENTECH' };
}

const hojeSP = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

function enderecoCliente(cli: any): string | null {
  if (!cli) return null;
  return [
    [cli.endereco1, cli.numero1].filter(Boolean).join(', '), cli.complemento1, cli.bairro1,
    [cli.cidade1, cli.estado1].filter(Boolean).join('/'), cli.cep1 ? `CEP ${cli.cep1}` : null,
  ].filter(Boolean).join(' - ') || null;
}

/** Parcelas: as dos títulos já gerados; senão sugeridas pela condição ("após entrega" conta da saída/montagem). */
function parcelasDaFicha(f: any, titulos: any[]): { vencimento: string; valor: number }[] {
  if (titulos.length) return titulos.map(t => ({ vencimento: t.vencimento, valor: n(t.valor) }));
  const cond = String(f.condicao_pagamento || '');
  const base = /entrega|montagem|evento/i.test(cond) ? (f.data_saida || f.data_montagem || f.data_inicio) : hojeISO();
  return sugerirParcelas(n(f.valor_total), cond, base, f.data_fim).map(p => ({ vencimento: p.vencimento, valor: p.valor }));
}

export async function montarDadosProposta(db: Db, fichaId: number, mostrarValoresItens: boolean): Promise<DadosPropostaPdf> {
  const { f, emp, cli, ev, vend, itens, composicao, led, titulos, logo } = await carregarContexto(db, fichaId);
  return {
    numero: numeroFichaPorId(fichaId),
    emitidaEm: hojeSP(),
    validade: f.validade_orcamento,
    empresa: {
      nome: emp?.nome_curto || emp?.nome || '', razao_social: emp?.razao_social, cnpj: formatarDocumento(emp?.cnpj, null),
      endereco: emp?.endereco, telefone: emp?.telefone, email: emp?.email_contato, site: emp?.site, logo,
    },
    cliente: {
      nome: cli ? (cli.nome_completo || cli.nome_exibicao) : 'Cliente', documento: cli ? formatarDocumento(cli.cnpj, cli.cpf) : null,
      inscricao: cli?.inscricao_estadual || null, endereco: enderecoCliente(cli),
      contato: f.contato_nome, telefone: f.contato_telefone || cli?.telefone1 || null, email: f.contato_email || cli?.email1 || null,
    },
    evento: {
      nome: ev?.nome || null, local: f.local_entrega || ev?.local || null, estande: f.endereco_estande,
      inicio: f.data_inicio, fim: f.data_fim, dias: diasInclusivos(f.data_inicio, f.data_fim), diasCobrados: f.dias_cobrados,
      montagem: f.data_montagem, desmontagem: f.data_desmontagem, saida: f.data_saida, retorno: f.data_retorno,
    },
    modalidade: MODALIDADE_ROTULO[f.modalidade] || f.modalidade,
    vendedor: f.vendedor_nome ? { nome: vend ? (vend.nome_exibicao || vend.nome_completo) : f.vendedor_nome, telefone: emp?.telefone || null, email: vend?.email1 || null } : null,
    itens: itens.map(i => {
      const espec = i.produto_id ? led.get(i.produto_id) : undefined;
      const montagem = espec && n(i.led_largura_m) > 0 && n(i.led_altura_m) > 0 ? calcularLed(espec, n(i.led_largura_m), n(i.led_altura_m)) : null;
      const cat = i.produto?.categoria_nome ? nomeCategoria(i.produto.categoria_nome) : '';
      return {
        tipo: i.tipo, descricao: i.descricao, codigo: i.produto?.codigo_formatado || null, unidade: i.produto?.unidade || null,
        quantidade: n(i.quantidade), dias: i.dias, valor_unitario: n(i.valor_unitario), desconto_valor: n(i.desconto_valor),
        valor_total: n(i.valor_total), composicao: i.tipo === 'KIT' ? composicao.get(i.produto_id) || null : null,
        grupo: i.produto_id && cat ? cat : GRUPO_SERVICOS,
        led: montagem ? { montagem, descricao: espec?.descricao_tecnica || null, pitch: espec?.pitch_mm ?? null } : null,
      };
    }),
    totais: { equipamentos: n(f.valor_equipamentos), servicos: n(f.valor_servicos), desconto: n(f.desconto_valor), total: n(f.valor_total) },
    mostrarValoresItens,
    pagamento: {
      forma: f.forma_pagamento ? ROTULO_FORMA_PAGAMENTO[f.forma_pagamento] || f.forma_pagamento : null,
      condicao: f.condicao_pagamento, parcelas: parcelasDaFicha(f, titulos),
    },
    observacoes: f.observacoes,
    extras: emp?.proposta_extras?.trim() || PROPOSTA_EXTRAS_PADRAO,
    termo: emp?.proposta_condicoes?.trim() || PROPOSTA_TERMO_PADRAO,
  };
}

export async function montarDadosContrato(db: Db, fichaId: number, assinantes?: { papel: string; nome: string }[]): Promise<DadosContratoPdf> {
  const { f, emp, cli, ev, itens, composicao, titulos, logo } = await carregarContexto(db, fichaId);
  const ehEquip = (i: any) => i.produto_id && (i.tipo === 'EQUIPAMENTO' || i.tipo === 'KIT' || i.tipo === 'OUTRO');
  return {
    numero: numeroFichaPorId(fichaId),
    data: hojeSP(),
    empresa: {
      razao_social: emp?.razao_social || emp?.nome || '', cnpj: formatarDocumento(emp?.cnpj, null), endereco: emp?.endereco || null,
      inscricao_estadual: emp?.inscricao_estadual || null, inscricao_municipal: emp?.inscricao_municipal || null, logo,
    },
    cliente: {
      nome: cli ? (cli.nome_completo || cli.nome_exibicao) : 'Cliente', pessoaFisica: !!cli && !cli.cnpj && !!cli.cpf,
      documento: cli ? formatarDocumento(cli.cnpj, cli.cpf) : null, inscricao_estadual: cli?.inscricao_estadual || null,
      logradouro: [cli?.endereco1, cli?.numero1 ? `nº ${cli.numero1}` : null, cli?.complemento1].filter(Boolean).join(', ') || null,
      bairro: cli?.bairro1 || null, cidade: cli?.cidade1 || null, uf: cli?.estado1 || null, cep: cli?.cep1 || null,
    },
    objetos: itens.filter(ehEquip).map(i => ({
      codigo: i.produto?.codigo_formatado || '', quantidade: n(i.quantidade),
      descricao: i.descricao + (i.tipo === 'KIT' && composicao.get(i.produto_id) ? ` (${composicao.get(i.produto_id)})` : ''),
    })),
    extras: itens.filter(i => !ehEquip(i)).map(i => ({ descricao: i.descricao, dataRef: null, quantidade: n(i.quantidade) })),
    inicio: f.data_inicio, termino: f.data_fim, evento: ev?.nome || null,
    local: f.local_entrega || ev?.local || null, estande: f.endereco_estande || null,
    condicao: f.condicao_pagamento || null, forma: f.forma_pagamento ? ROTULO_FORMA_PAGAMENTO[f.forma_pagamento] || f.forma_pagamento : null,
    parcelas: parcelasDaFicha(f, titulos),
    valores: { locacao: n(f.valor_equipamentos), servicos: n(f.valor_servicos), desconto: n(f.desconto_valor), total: n(f.valor_total) },
    clausulas: emp?.contrato_clausulas?.trim() || CONTRATO_CLAUSULAS_PADRAO,
    assinantes,
  };
}
