// app/admin/locacoes/reservas/propostaCore.ts
// Proposta de locação assinada via Autentique (2026-11-16). SEM "use server":
// é usada pelas actions (já protegidas por accessToken) e pelo webhook
// app/api/webhooks/autentique (a própria Autentique chamando, sem sessão).
// Fora de "use server" ela não vira endpoint chamável direto — mesmo motivo
// de app/admin/op/assinaturaOpCore.ts.
//
// Assinou → arquiva o PDF assinado, marca a ficha como APROVADO e tenta
// reservar; faltando equipamento, fica APROVADO e o histórico avisa.
import { supabaseAdmin } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { autentiqueConsultarDocumento } from '../../../lib/autentique';
import { reservarFicha } from '../../../lib/locacao/disponibilidade';
import { diasInclusivos } from '../../../lib/locacao/datas';
import { CONDICOES_GERAIS_PADRAO, type DadosPropostaPdf } from '../../../lib/locacao/gerarPropostaPdf';
import { numeroFichaPorId } from '../../../lib/locacao/fichaNumero';

type Db = ReturnType<typeof supabaseAdmin>;
export const BUCKET_PROPOSTAS = 'locacao-propostas';
export type StatusProposta = 'ENVIADO' | 'VISUALIZADO' | 'ASSINADO' | 'REJEITADO' | 'CANCELADO';

const MODALIDADE_ROTULO: Record<string, string> = { DIARIA: 'Por diária', PERIODO: 'Período fechado', MENSAL: 'Mensal' };
export const numeroFichaTexto = numeroFichaPorId;

const digitos = (s?: string | null) => (s || '').replace(/\D/g, '');
function formatarDocumento(cnpj?: string | null, cpf?: string | null): string | null {
  const c = digitos(cnpj);
  if (c.length === 14) return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
  const p = digitos(cpf);
  if (p.length === 11) return `${p.slice(0, 3)}.${p.slice(3, 6)}.${p.slice(6, 9)}-${p.slice(9)}`;
  return cnpj || cpf || null;
}

/** Monta tudo que o PDF precisa a partir da ficha salva. */
export async function montarDadosProposta(db: Db, fichaId: number, mostrarValoresItens: boolean): Promise<DadosPropostaPdf> {
  const { data: f, error } = await db.from('locacao_fichas_reserva').select('*').eq('id', fichaId).single();
  if (error) throw error;
  const [rEmp, rCli, rEv, rItens] = await Promise.all([
    db.from('empresas').select('*').eq('id', f.empresa_id).single(),
    db.from('parceiros').select('nome_exibicao, nome_completo, cnpj, cpf, endereco1, numero1, complemento1, bairro1, cidade1, estado1, cep1').eq('id', f.parceiro_id).maybeSingle(),
    f.evento_id ? db.from('eventos_feiras').select('nome, local').eq('id', f.evento_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('locacao_fichas_reserva_itens').select('*, produto:produtos(codigo_formatado, unidade)').eq('ficha_id', fichaId).order('ordem'),
  ]);
  for (const r of [rEmp, rCli, rEv, rItens] as any[]) if (r.error) throw r.error;
  const emp: any = rEmp.data, cli: any = rCli.data, ev: any = rEv.data;
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
      const lista = porKit.get(c.kit_produto_id) || [];
      lista.push(`${Number(c.quantidade).toLocaleString('pt-BR', { maximumFractionDigits: 3 })}x ${c.componente?.nome_item || ''}${c.opcional ? ' (opcional)' : ''}`);
      porKit.set(c.kit_produto_id, lista);
    }
    for (const [k, l] of porKit) composicao.set(k, l.join(' · '));
  }

  const nomeEmp = `${emp?.nome_curto || ''} ${emp?.nome || ''}`.toUpperCase();
  const enderecoCli = cli ? [
    [cli.endereco1, cli.numero1].filter(Boolean).join(', '), cli.complemento1, cli.bairro1,
    [cli.cidade1, cli.estado1].filter(Boolean).join('/'), cli.cep1 ? `CEP ${cli.cep1}` : null,
  ].filter(Boolean).join(' - ') : null;

  return {
    numero: numeroFichaTexto(fichaId),
    emitidaEm: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date()),
    validade: f.validade_orcamento,
    empresa: {
      nome: emp?.nome_curto || emp?.nome || '', razao_social: emp?.razao_social, cnpj: formatarDocumento(emp?.cnpj, null),
      endereco: emp?.endereco, telefone: emp?.telefone, email: emp?.email_contato, site: emp?.site,
      logo: /ALFA/.test(nomeEmp) ? 'ALFALIGHT' : 'RENTECH',
    },
    cliente: {
      nome: cli ? (cli.nome_completo || cli.nome_exibicao) : 'Cliente', documento: cli ? formatarDocumento(cli.cnpj, cli.cpf) : null,
      endereco: enderecoCli, contato: f.contato_nome, telefone: f.contato_telefone, email: f.contato_email,
    },
    evento: {
      nome: ev?.nome || null, local: f.local_entrega || ev?.local || null, estande: f.endereco_estande,
      inicio: f.data_inicio, fim: f.data_fim, dias: diasInclusivos(f.data_inicio, f.data_fim),
      montagem: f.data_montagem, desmontagem: f.data_desmontagem, saida: f.data_saida, retorno: f.data_retorno,
    },
    modalidade: MODALIDADE_ROTULO[f.modalidade] || f.modalidade,
    vendedor: f.vendedor_nome,
    itens: itens.map(i => ({
      tipo: i.tipo, descricao: i.descricao, codigo: i.produto?.codigo_formatado || null, unidade: i.produto?.unidade || null,
      quantidade: Number(i.quantidade), dias: i.dias, valor_unitario: Number(i.valor_unitario), desconto_valor: Number(i.desconto_valor),
      valor_total: Number(i.valor_total), composicao: i.tipo === 'KIT' ? composicao.get(i.produto_id) || null : null,
    })),
    totais: { equipamentos: Number(f.valor_equipamentos), servicos: Number(f.valor_servicos), desconto: Number(f.desconto_valor), total: Number(f.valor_total) },
    mostrarValoresItens,
    condicaoPagamento: f.condicao_pagamento,
    observacoes: f.observacoes,
    condicoesGerais: emp?.proposta_condicoes?.trim() || CONDICOES_GERAIS_PADRAO,
  };
}

async function historico(db: Db, fichaId: number, usuario: string, acao: string, detalhe: string, de?: string | null, para?: string | null) {
  await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: fichaId, usuario, acao, detalhe, status_de: de ?? null, status_para: para ?? null });
}

/** Baixa o PDF assinado na Autentique e guarda no bucket. Devolve o caminho. */
async function arquivarAssinado(db: Db, proposta: { id: number; ficha_id: number; versao: number }, docId: string): Promise<string | null> {
  const doc = await autentiqueConsultarDocumento(docId);
  const url = doc?.files?.signed || doc?.files?.pades;
  const token = process.env.AUTENTIQUE_API_TOKEN;
  if (!url || !token) return null;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const caminho = `ficha-${proposta.ficha_id}/proposta-v${proposta.versao}-assinada.pdf`;
  const { error } = await db.storage.from(BUCKET_PROPOSTAS).upload(caminho, bytes, { contentType: 'application/pdf', upsert: true });
  return error ? null : caminho;
}

/**
 * Aplica um evento da Autentique numa proposta (webhook ou consulta manual).
 * Devolve false se o documento não é de proposta de locação.
 */
export async function processarEventoProposta(
  db: Db,
  docId: string,
  ev: { status: StatusProposta; visualizadoEm?: string | null; assinadoEm?: string | null; rejeitadoEm?: string | null; trilha?: unknown }
): Promise<boolean> {
  const { data: prop } = await db.from('locacao_propostas').select('*').eq('autentique_doc_id', docId).maybeSingle();
  if (!prop) return false;
  if (prop.status === 'CANCELADO' || prop.status === 'ASSINADO') {
    // cancelada: evento atrasado não reabre. assinada: só completa o arquivo se faltou.
    if (prop.status === 'ASSINADO' && !prop.pdf_assinado_path) {
      const caminho = await arquivarAssinado(db, prop, docId);
      if (caminho) await db.from('locacao_propostas').update({ pdf_assinado_path: caminho, atualizado_em: new Date().toISOString() }).eq('id', prop.id);
    }
    return true;
  }

  const agora = new Date().toISOString();
  await db.from('locacao_propostas').update({
    status: ev.status, trilha: ev.trilha ?? prop.trilha,
    visualizado_em: ev.visualizadoEm || prop.visualizado_em, assinado_em: ev.assinadoEm || prop.assinado_em, rejeitado_em: ev.rejeitadoEm || prop.rejeitado_em,
    atualizado_em: agora,
  }).eq('id', prop.id);

  const ficha = numeroFichaTexto(prop.ficha_id);
  if (ev.status === 'VISUALIZADO' && !prop.visualizado_em) {
    await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_VISUALIZADA', `Cliente abriu a proposta v${prop.versao}`);
  }
  if (ev.status === 'REJEITADO') {
    await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_RECUSADA', `Cliente recusou a proposta v${prop.versao} na Autentique`);
    registrarLogAuditoria({ usuario_nome: 'AUTENTIQUE', acao: 'PROPOSTA DE LOCAÇÃO RECUSADA', setor: 'LOCACOES', equipamento_nome: `${ficha} v${prop.versao}` });
  }
  if (ev.status === 'ASSINADO') {
    const caminho = await arquivarAssinado(db, prop, docId).catch(() => null);
    if (caminho) await db.from('locacao_propostas').update({ pdf_assinado_path: caminho }).eq('id', prop.id);

    const { data: f } = await db.from('locacao_fichas_reserva').select('id, status').eq('id', prop.ficha_id).single();
    if (prop.sandbox) {
      // envio de TESTE: só registra — nunca aprova nem reserva equipamento de verdade
      await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_ASSINADA', `Proposta v${prop.versao} de TESTE (sandbox) assinada — ficha não foi aprovada nem reservada`);
      return true;
    }
    await historico(db, prop.ficha_id, 'CLIENTE (Autentique)', 'PROPOSTA_ASSINADA', `Cliente assinou a proposta v${prop.versao}`);
    if (f && ['ORCAMENTO', 'ENVIADO'].includes(f.status)) {
      await db.from('locacao_fichas_reserva').update({ status: 'APROVADO', aprovado_em: ev.assinadoEm || agora, aprovado_por: `${prop.signatario_nome || 'Cliente'} (assinatura Autentique)`, updated_at: agora }).eq('id', f.id);
      await historico(db, f.id, 'SISTEMA', 'APROVADO', 'Aprovada pela assinatura do cliente', f.status, 'APROVADO');
      const r = await reservarFicha(db, f.id).catch((e: any) => ({ ok: false, erro: e.message, faltas: undefined }));
      if (r.ok) {
        await db.from('locacao_fichas_reserva').update({ status: 'RESERVADA', updated_at: new Date().toISOString() }).eq('id', f.id);
        await historico(db, f.id, 'SISTEMA', 'RESERVAR', 'Equipamentos reservados automaticamente após a assinatura', 'APROVADO', 'RESERVADA');
      } else {
        const faltas = (r.faltas || []).map(l => `${l.nome} (faltam ${l.falta})`).join(', ');
        await historico(db, f.id, 'SISTEMA', 'RESERVA_PENDENTE', `Assinada, mas não deu para reservar: ${faltas || r.erro || 'falta equipamento'}. Ajuste e use "Aprovar e reservar".`);
      }
    }
    registrarLogAuditoria({ usuario_nome: 'AUTENTIQUE', acao: 'PROPOSTA DE LOCAÇÃO ASSINADA', setor: 'LOCACOES', equipamento_nome: `${ficha} v${prop.versao} · ${prop.signatario_nome || ''}` });
  }
  return true;
}

/** Consulta a Autentique e aplica o status atual (botão "Atualizar status"). */
export async function atualizarPropostaPelaAutentique(db: Db, propostaId: number): Promise<StatusProposta | null> {
  const { data: prop } = await db.from('locacao_propostas').select('autentique_doc_id').eq('id', propostaId).maybeSingle();
  if (!prop?.autentique_doc_id) return null;
  const doc = await autentiqueConsultarDocumento(prop.autentique_doc_id);
  const sig = (doc?.signatures || []).find((x: any) => x?.action?.name === 'SIGN') || (doc?.signatures || [])[0];
  const assinadoEm = sig?.signed?.created_at || null, visualizadoEm = sig?.viewed?.created_at || null, rejeitadoEm = sig?.rejected?.created_at || null;
  const status: StatusProposta = rejeitadoEm ? 'REJEITADO' : assinadoEm ? 'ASSINADO' : visualizadoEm ? 'VISUALIZADO' : 'ENVIADO';
  await processarEventoProposta(db, prop.autentique_doc_id, { status, assinadoEm, visualizadoEm, rejeitadoEm });
  return status;
}
