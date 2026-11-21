'use server';

// app/cliente/actions.ts
// Portal do Cliente (2026-11-17). Acesso por e-mail + código (sem senha);
// sessão em cookie (ver sessao.ts). Tudo é escopado pelos clientes do e-mail
// da sessão — nunca por id vindo do navegador sem conferir.
// Fase paralela: mostra só fichas criadas no sistema (status a partir de
// "enviado"); fichas do P2S e títulos ficam atrás de MOSTRAR_P2S/MOSTRAR_TITULOS.
import { supabaseAdmin } from '../lib/supabase';
import { enviarEmailSistema } from '../lib/emailSistema';
import { registrarLogAuditoria } from '../actions';
import { dataValida } from '../lib/locacao/datas';
import {
  sessaoAtual, criarSessao, encerrarSessao, parceirosDoEmail, ipDaRequisicao,
  hash, novoCodigo, normalizarEmail, emailValido, MOSTRAR_P2S, MOSTRAR_TITULOS,
} from './sessao';
import { numeroFicha } from '../lib/locacao/fichaNumero';
import { numeroExibicao, linkFatura } from '../lib/financeiro/faturamento';

type Resultado = { ok: boolean; erro?: string; info?: any };
const VISIVEIS = ['ENVIADO', 'APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const MSG_GENERICA = 'Se este e-mail estiver cadastrado como contato de um cliente, enviamos um código de acesso. Confira a caixa de entrada (e o spam).';

// ============================================================================
// ACESSO
// ============================================================================
export async function solicitarCodigoAction(emailBruto: string): Promise<Resultado> {
  const email = normalizarEmail(emailBruto);
  if (!emailValido(email)) return { ok: false, erro: 'Digite um e-mail válido.' };
  const db = supabaseAdmin();
  const ip = await ipDaRequisicao();
  const umaHora = new Date(Date.now() - 3600_000).toISOString();
  const dezMin = new Date(Date.now() - 600_000).toISOString();
  try {
    const [{ count: porEmail }, { count: porIp }] = await Promise.all([
      db.from('cliente_portal_codigos').select('id', { count: 'exact', head: true }).eq('email', email).gte('criado_em', umaHora),
      db.from('cliente_portal_codigos').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('criado_em', dezMin),
    ]);
    if ((porEmail || 0) >= 5 || (porIp || 0) >= 15) return { ok: false, erro: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' };

    const parceiros = await parceirosDoEmail(email);
    const codigo = novoCodigo();
    // registra mesmo quando o e-mail não é de cliente — o limite acima vale igual
    await db.from('cliente_portal_codigos').insert({
      email, codigo_hash: hash(`${email}:${codigo}`), expira_em: new Date(Date.now() + 10 * 60_000).toISOString(), ip,
      usado: parceiros.length === 0,
    });
    if (parceiros.length) {
      await enviarEmailSistema(email, 'Seu código de acesso — Portal do Cliente',
        `Olá!\n\nSeu código de acesso ao Portal do Cliente é: ${codigo}\n\nEle vale por 10 minutos. Se você não pediu, ignore este e-mail.\n\nRentech / Alfa Light`);
    }
    return { ok: true, info: { mensagem: MSG_GENERICA } };
  } catch {
    return { ok: true, info: { mensagem: MSG_GENERICA } };
  }
}

export async function confirmarCodigoAction(emailBruto: string, codigo: string): Promise<Resultado> {
  const email = normalizarEmail(emailBruto);
  const c = (codigo || '').replace(/\D/g, '');
  if (!emailValido(email) || c.length !== 6) return { ok: false, erro: 'Código inválido.' };
  const db = supabaseAdmin();
  try {
    const { data: reg } = await db.from('cliente_portal_codigos').select('*').eq('email', email).eq('usado', false)
      .gte('expira_em', new Date().toISOString()).order('criado_em', { ascending: false }).limit(1).maybeSingle();
    if (!reg) return { ok: false, erro: 'Código expirado ou inválido. Peça um novo.' };
    if (reg.tentativas >= 5) {
      await db.from('cliente_portal_codigos').update({ usado: true }).eq('id', reg.id);
      return { ok: false, erro: 'Muitas tentativas com este código. Peça um novo.' };
    }
    if (reg.codigo_hash !== hash(`${email}:${c}`)) {
      await db.from('cliente_portal_codigos').update({ tentativas: reg.tentativas + 1 }).eq('id', reg.id);
      return { ok: false, erro: 'Código incorreto.' };
    }
    await db.from('cliente_portal_codigos').update({ usado: true }).eq('id', reg.id);
    if (!(await parceirosDoEmail(email)).length) return { ok: false, erro: 'Acesso não disponível para este e-mail.' };
    await criarSessao(email);
    registrarLogAuditoria({ usuario_nome: email, acao: 'ENTROU NO PORTAL DO CLIENTE', setor: 'PORTAL CLIENTE' });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: 'Não foi possível entrar agora. Tente de novo.' };
  }
}

export async function sairAction(): Promise<Resultado> {
  await encerrarSessao();
  return { ok: true };
}

// ============================================================================
// PAINEL
// ============================================================================
export async function painelClienteAction(): Promise<Resultado> {
  const s = await sessaoAtual();
  if (!s) return { ok: false, erro: 'SESSAO' };
  const db = supabaseAdmin();
  try {
    const [rCli, rFichas, rSol] = await Promise.all([
      db.from('parceiros').select('id, nome_exibicao, nome_completo').in('id', s.parceiros),
      (() => {
        let q = db.from('locacao_fichas_reserva')
          .select('id, origem, p2s_numero, status, parceiro_id, empresa_id, data_inicio, data_fim, data_montagem, data_desmontagem, local_entrega, valor_total, validade_orcamento, evento:eventos_feiras(nome), empresa:empresas(nome, nome_curto)')
          .in('parceiro_id', s.parceiros).in('status', VISIVEIS);
        if (!MOSTRAR_P2S) q = q.eq('origem', 'SISTEMA');
        return q.order('data_inicio', { ascending: false }).limit(300);
      })(),
      db.from('cliente_portal_solicitacoes').select('id, evento, data_inicio, data_fim, status, criado_em, ficha_id').eq('email', s.email).order('criado_em', { ascending: false }).limit(30),
    ]);
    const fichas = (rFichas.data || []) as any[];
    // proposta aberta para assinar (última versão enviada/visualizada) e se já há assinada
    const ids = fichas.map(f => f.id);
    const { data: props } = ids.length
      ? await db.from('locacao_propostas').select('ficha_id, versao, status, link_assinatura, sandbox').in('ficha_id', ids).order('versao', { ascending: false })
      : { data: [] };
    const abertaPor = new Map<number, any>(), assinadaPor = new Set<number>();
    for (const p of (props || []) as any[]) {
      if (['ENVIADO', 'VISUALIZADO'].includes(p.status) && !abertaPor.has(p.ficha_id)) abertaPor.set(p.ficha_id, p);
      if (p.status === 'ASSINADO') assinadaPor.add(p.ficha_id);
    }
    // Títulos: todos com a chave MOSTRAR_TITULOS; sem ela, só os das empresas que já
    // viraram a chave (Financeiro na fonte SISTEMA) — antes disso o oficial é o P2S.
    let titulos: any[] = [];
    const { data: fontes } = await db.from('financeiro_parametros').select('empresa_id').eq('fonte', 'SISTEMA');
    const empresasViradas = ((fontes || []) as any[]).map(x => x.empresa_id as number);
    if (MOSTRAR_TITULOS || empresasViradas.length) {
      let q = db.from('financeiro_titulos_receber').select('id, descricao, valor, vencimento, status, data_pagamento, parceiro_id, boleto_linha_digitavel, boleto_pix_copia_cola')
        .in('parceiro_id', s.parceiros).neq('status', 'CANCELADO');
      if (!MOSTRAR_TITULOS) q = q.in('empresa_id', empresasViradas);
      const { data } = await q.order('vencimento', { ascending: false }).limit(200);
      titulos = data || [];
    }
    // Notas de Débito OFICIAIS (as de ensaio, da transição, nunca aparecem para o cliente)
    const { data: fats } = await db.from('financeiro_faturas').select('id, serie, numero, data_emissao, valor_total, token_publico, parceiro_id, status')
      .in('parceiro_id', s.parceiros).eq('serie', 'OFICIAL').eq('status', 'EMITIDA').order('data_emissao', { ascending: false }).limit(100);
    const faturas = ((fats || []) as any[]).map(f => ({ id: f.id, numero: numeroExibicao(f), emissao: f.data_emissao, valor: Number(f.valor_total), link: linkFatura(f.token_publico) }));
    return {
      ok: true,
      info: {
        email: s.email,
        faturas,
        clientes: (rCli.data || []).map((c: any) => ({ id: c.id, nome: c.nome_exibicao || c.nome_completo })),
        fichas: fichas.map(f => ({
          id: f.id, numero: numeroFicha(f), status: f.status, parceiro_id: f.parceiro_id, evento: f.evento?.nome || null,
          empresa: (f.empresa?.nome_curto || f.empresa?.nome || '').trim(), data_inicio: f.data_inicio, data_fim: f.data_fim,
          local: f.local_entrega, valor_total: Number(f.valor_total), validade: f.validade_orcamento,
          proposta_para_assinar: abertaPor.get(f.id)?.link_assinatura || null, proposta_assinada: assinadaPor.has(f.id),
        })),
        titulos, mostrarTitulos: MOSTRAR_TITULOS || empresasViradas.length > 0,
        solicitacoes: rSol.data || [],
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function fichaClienteAction(fichaId: number): Promise<Resultado> {
  const s = await sessaoAtual();
  if (!s) return { ok: false, erro: 'SESSAO' };
  const db = supabaseAdmin();
  try {
    const { data: f } = await db.from('locacao_fichas_reserva')
      .select('*, evento:eventos_feiras(nome), empresa:empresas(nome, nome_curto, telefone, email_contato), cliente:parceiros(nome_exibicao, nome_completo)')
      .eq('id', fichaId).maybeSingle();
    if (!f || !s.parceiros.includes(f.parceiro_id) || !VISIVEIS.includes(f.status) || (!MOSTRAR_P2S && f.origem !== 'SISTEMA')) {
      return { ok: false, erro: 'Ficha não encontrada.' };
    }
    const [{ data: itens }, { data: props }] = await Promise.all([
      db.from('locacao_fichas_reserva_itens').select('tipo, descricao, quantidade, dias, valor_unitario, desconto_valor, valor_total').eq('ficha_id', fichaId).order('ordem'),
      db.from('locacao_propostas').select('id, versao, status, link_assinatura, enviado_em, assinado_em, pdf_original_path, pdf_assinado_path').eq('ficha_id', fichaId).order('versao', { ascending: false }),
    ]);
    return {
      ok: true,
      info: {
        id: f.id, numero: numeroFicha(f), status: f.status, evento: f.evento?.nome || null, cliente: f.cliente?.nome_completo || f.cliente?.nome_exibicao,
        empresa: { nome: (f.empresa?.nome_curto || f.empresa?.nome || '').trim(), telefone: f.empresa?.telefone, email: f.empresa?.email_contato },
        datas: { saida: f.data_saida, montagem: f.data_montagem, inicio: f.data_inicio, fim: f.data_fim, desmontagem: f.data_desmontagem, retorno: f.data_retorno },
        local: f.local_entrega, estande: f.endereco_estande, vendedor: f.vendedor_nome, condicao_pagamento: f.condicao_pagamento, observacoes: f.observacoes,
        valores: { equipamentos: Number(f.valor_equipamentos), servicos: Number(f.valor_servicos), desconto: Number(f.desconto_valor), total: Number(f.valor_total) },
        itens: (itens || []).map((i: any) => ({ ...i, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario), valor_total: Number(i.valor_total) })),
        propostas: (props || []).filter((p: any) => p.status !== 'CANCELADO').map((p: any) => ({
          id: p.id, versao: p.versao, status: p.status, assinado_em: p.assinado_em, enviado_em: p.enviado_em,
          link_assinatura: ['ENVIADO', 'VISUALIZADO'].includes(p.status) ? p.link_assinatura : null,
          tem_original: !!p.pdf_original_path, tem_assinado: !!p.pdf_assinado_path,
        })),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarPropostaClienteAction(propostaId: number, qual: 'ORIGINAL' | 'ASSINADO'): Promise<Resultado> {
  const s = await sessaoAtual();
  if (!s) return { ok: false, erro: 'SESSAO' };
  const db = supabaseAdmin();
  const { data: p } = await db.from('locacao_propostas').select('pdf_original_path, pdf_assinado_path, ficha:locacao_fichas_reserva(parceiro_id, origem, status)').eq('id', propostaId).maybeSingle();
  const f: any = (p as any)?.ficha;
  if (!p || !f || !s.parceiros.includes(f.parceiro_id) || !VISIVEIS.includes(f.status)) return { ok: false, erro: 'Proposta não encontrada.' };
  const caminho = qual === 'ASSINADO' ? p.pdf_assinado_path : p.pdf_original_path;
  if (!caminho) return { ok: false, erro: 'PDF ainda não disponível.' };
  const { data, error } = await db.storage.from('locacao-propostas').createSignedUrl(caminho, 300, { download: caminho.split('/').pop() });
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: { url: data.signedUrl } };
}

// ============================================================================
// SOLICITAR ORÇAMENTO
// ============================================================================
export async function solicitarOrcamentoAction(d: {
  parceiro_id: number; contato_nome: string; contato_telefone: string; evento: string; local: string;
  data_inicio: string; data_fim: string; itens: string; observacoes: string;
}): Promise<Resultado> {
  const s = await sessaoAtual();
  if (!s) return { ok: false, erro: 'SESSAO' };
  if (!s.parceiros.includes(d.parceiro_id)) return { ok: false, erro: 'Escolha a empresa.' };
  if (!(d.itens || '').trim()) return { ok: false, erro: 'Conte o que você precisa (equipamentos, quantidades).' };
  if (d.data_inicio && !dataValida(d.data_inicio)) return { ok: false, erro: 'Data inicial inválida.' };
  if (d.data_fim && !dataValida(d.data_fim)) return { ok: false, erro: 'Data final inválida.' };
  if (d.data_inicio && d.data_fim && d.data_fim < d.data_inicio) return { ok: false, erro: 'A data final é anterior à inicial.' };
  const db = supabaseAdmin();
  const { count } = await db.from('cliente_portal_solicitacoes').select('id', { count: 'exact', head: true })
    .eq('email', s.email).gte('criado_em', new Date(Date.now() - 3600_000).toISOString());
  if ((count || 0) >= 10) return { ok: false, erro: 'Muitas solicitações em pouco tempo. Fale com o seu vendedor.' };
  const { error } = await db.from('cliente_portal_solicitacoes').insert({
    email: s.email, parceiro_id: d.parceiro_id, contato_nome: d.contato_nome?.trim().slice(0, 120) || null, contato_telefone: d.contato_telefone?.trim().slice(0, 40) || null,
    evento: d.evento?.trim().slice(0, 200) || null, local: d.local?.trim().slice(0, 300) || null,
    data_inicio: d.data_inicio || null, data_fim: d.data_fim || null, itens: d.itens.trim().slice(0, 5000), observacoes: d.observacoes?.trim().slice(0, 2000) || null,
  });
  if (error) return { ok: false, erro: 'Não foi possível enviar agora.' };
  registrarLogAuditoria({ usuario_nome: s.email, acao: 'SOLICITOU ORÇAMENTO PELO PORTAL', setor: 'PORTAL CLIENTE', equipamento_nome: d.evento || '' });
  return { ok: true };
}
