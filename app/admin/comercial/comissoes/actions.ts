'use server';

// app/admin/comercial/comissoes/actions.ts
// Comissões de vendas (2026-11-17). Cálculo em app/lib/comercial/comissoes.ts.
// Gestão (escopo TODAS em Permissões → Locação) vê todos os vendedores, fecha
// o mês, marca como pago e ajusta as %. Vendedor padrão (CARTEIRA) só vê a
// própria comissão.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { acessoLocacao, MSG_SEM_VENDEDOR } from '../../../lib/locacao/acessoFichas';
import { calcularComissoesAbertas, primeiroDiaMes, ultimoDiaMes, type LinhaComissao } from '../../../lib/comercial/comissoes';
import { hojeISO, dataValida } from '../../../lib/locacao/datas';
import { normalizarFaixasDesconto, normalizarFaixasPrazo, type FaixaDesconto, type FaixaPrazo } from '../../../lib/comercial/regraComissao';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/comercial/comissoes';
const arred = (v: number) => Math.round(v * 100) / 100;
const mesValido = (m: string) => /^\d{4}-\d{2}$/.test(m || '');

async function contexto(accessToken: string) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const acesso = await acessoLocacao(supabaseAdmin(), v.perfil);
  const gestao = acesso.escopo === 'TODAS';
  if (!gestao && !acesso.vendedorId) return { erro: MSG_SEM_VENDEDOR } as const;
  return { perfil: v.perfil, gestao, vendedorId: gestao ? null : acesso.vendedorId } as const;
}
const SO_GESTAO = 'Só a gestão (quem vê todas as fichas) pode fazer isso.';

async function nomesVendedores() {
  const { data } = await supabaseAdmin().from('colaboradores').select('id, nome_exibicao, nome_completo, status_colaborador').eq('flag_vendedor_rep', true);
  return new Map(((data || []) as any[]).map(v => [v.id as number, { nome: String(v.nome_exibicao || v.nome_completo || '').trim(), ativo: v.status_colaborador === 'A' }]));
}

export async function painelComissoesAction(mes: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!mesValido(mes)) return { ok: false, erro: 'Mês inválido.' };
  const db = supabaseAdmin();
  try {
    const competencia = `${mes}-01`;
    const fim = ultimoDiaMes(competencia);
    const [abertas, nomes, rFech, rTaxas] = await Promise.all([
      calcularComissoesAbertas(db, fim, ctx.vendedorId),
      nomesVendedores(),
      (() => {
        let q = db.from('comercial_comissao_fechamentos').select('*, lancamentos:comercial_comissao_lancamentos(*)').eq('competencia', competencia);
        if (ctx.vendedorId) q = q.eq('vendedor_id', ctx.vendedorId);
        return q.order('vendedor_id');
      })(),
      db.from('comercial_comissao_vendedores').select('*').order('vendedor_id'),
    ]);
    if (rFech.error) throw rFech.error;
    if (rTaxas.error) throw rTaxas.error;
    const nomeDe = (id: number) => nomes.get(id)?.nome || `#${id}`;
    const fechadosNoMes = new Set(((rFech.data || []) as any[]).map(f => f.vendedor_id as number));

    // em aberto, agrupado por vendedor
    const grupos = new Map<number, LinhaComissao[]>();
    for (const l of abertas.linhas) grupos.set(l.vendedor_id, [...(grupos.get(l.vendedor_id) || []), l]);
    const emAberto = [...grupos].map(([vendedor_id, linhas]) => ({
      vendedor_id, vendedor: nomeDe(vendedor_id),
      jaFechadoNoMes: fechadosNoMes.has(vendedor_id),
      recebido: arred(linhas.reduce((s, l) => s + l.valor_recebido, 0)),
      comissao: arred(linhas.reduce((s, l) => s + l.valor_comissao, 0)),
      deMesesAnteriores: linhas.filter(l => l.recebido_em < competencia).length,
      linhas,
    })).sort((a, b) => b.comissao - a.comissao);

    const fechamentos = ((rFech.data || []) as any[]).map(f => ({
      ...f, vendedor: nomeDe(f.vendedor_id),
      lancamentos: ((f.lancamentos || []) as any[]).sort((a, b) => String(a.recebido_em).localeCompare(String(b.recebido_em))),
    }));

    return {
      ok: true,
      info: {
        gestao: ctx.gestao, mes, inicio: abertas.inicio, hoje: hojeISO(),
        emAberto, fechamentos,
        pendencias: ctx.gestao ? abertas.pendencias.filter(p => p.recebido_em >= competencia) : [],
        pendenciasAnteriores: ctx.gestao ? abertas.pendencias.filter(p => p.recebido_em < competencia).length : 0,
        taxas: ctx.gestao
          ? [...nomes].filter(([, v]) => v.ativo).map(([id, v]) => {
            const t = ((rTaxas.data || []) as any[]).find(x => x.vendedor_id === id);
            return {
              vendedor_id: id, vendedor: v.nome, pct_locacao: Number(t?.pct_locacao) || 0, pct_servicos: Number(t?.pct_servicos) || 0, ativo: t ? !!t.ativo : true,
              faixas_desconto: normalizarFaixasDesconto(t?.faixas_desconto), faixas_prazo: normalizarFaixasPrazo(t?.faixas_prazo), atualizado_por: t?.atualizado_por || null,
            };
          }).sort((a, b) => a.vendedor.localeCompare(b.vendedor))
          : [],
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

/** Fecha o mês: grava os lançamentos em aberto até o fim do mês (vendedor que já tem fechamento no mês fica para o próximo). */
export async function fecharMesComissoesAction(mes: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.gestao) return { ok: false, erro: SO_GESTAO };
  if (!mesValido(mes)) return { ok: false, erro: 'Mês inválido.' };
  const competencia = `${mes}-01`;
  if (competencia > primeiroDiaMes(hojeISO())) return { ok: false, erro: 'Não dá para fechar um mês que ainda não começou.' };
  const db = supabaseAdmin();
  try {
    const { linhas } = await calcularComissoesAbertas(db, ultimoDiaMes(competencia), null);
    const { data: jaFech } = await db.from('comercial_comissao_fechamentos').select('vendedor_id').eq('competencia', competencia);
    const pular = new Set(((jaFech || []) as any[]).map(f => f.vendedor_id as number));
    const grupos = new Map<number, LinhaComissao[]>();
    for (const l of linhas) if (!pular.has(l.vendedor_id)) grupos.set(l.vendedor_id, [...(grupos.get(l.vendedor_id) || []), l]);
    if (!grupos.size) return { ok: false, erro: 'Nada em aberto para fechar neste mês.' };

    let qtdVend = 0, total = 0;
    for (const [vendedorId, ls] of grupos) {
      const valorComissao = arred(ls.reduce((s, l) => s + l.valor_comissao, 0));
      const { data: fech, error } = await db.from('comercial_comissao_fechamentos').insert({
        competencia, vendedor_id: vendedorId, qtd_lancamentos: ls.length,
        valor_recebido: arred(ls.reduce((s, l) => s + l.valor_recebido, 0)), valor_comissao: valorComissao,
        fechado_por: ctx.perfil.nome,
      }).select('id').single();
      if (error) throw error;
      const rows = ls.map(l => ({
        fechamento_id: fech.id, vendedor_id: vendedorId, fonte: l.fonte, titulo_ref: l.titulo_ref, ficha_chave: l.ficha_chave, ficha_id: l.ficha_id,
        ficha_numero: l.ficha_numero, cliente: l.cliente, descricao: l.descricao, recebido_em: l.recebido_em,
        valor_recebido: l.valor_recebido, pct_efetivo: l.pct_efetivo, valor_comissao: l.valor_comissao,
        pct_locacao_aplicada: l.pct_locacao_aplicada, desconto_pct: l.desconto_pct, dias_nao_cobrados: l.dias_nao_cobrados, regra_motivo: l.regra_motivo,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error: eL } = await db.from('comercial_comissao_lancamentos').insert(rows.slice(i, i + 500));
        if (eL) { await db.from('comercial_comissao_fechamentos').delete().eq('id', fech.id); throw eL; }
      }
      qtdVend++; total += valorComissao;
    }
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'FECHOU COMISSÕES DO MÊS', setor: 'COMERCIAL', equipamento_nome: `${mes} · ${qtdVend} vendedor(es) · ${arred(total).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` });
    return { ok: true, info: { vendedores: qtdVend, total: arred(total) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function reabrirFechamentoAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.gestao) return { ok: false, erro: SO_GESTAO };
  const db = supabaseAdmin();
  const { data: f } = await db.from('comercial_comissao_fechamentos').select('*').eq('id', id).maybeSingle();
  if (!f) return { ok: false, erro: 'Fechamento não encontrado.' };
  if (f.status === 'PAGO') return { ok: false, erro: 'Comissão já paga — não dá para reabrir.' };
  const { error } = await db.from('comercial_comissao_fechamentos').delete().eq('id', id);
  if (error) return { ok: false, erro: error.message };
  registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'REABRIU FECHAMENTO DE COMISSÃO', setor: 'COMERCIAL', equipamento_nome: `${String(f.competencia).slice(0, 7)} · vendedor #${f.vendedor_id} · ${f.valor_comissao}` });
  return { ok: true };
}

export async function marcarComissaoPagaAction(id: number, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.gestao) return { ok: false, erro: SO_GESTAO };
  const db = supabaseAdmin();
  const { data, error } = await db.from('comercial_comissao_fechamentos')
    .update({ status: 'PAGO', pago_por: ctx.perfil.nome, pago_em: new Date().toISOString() }).eq('id', id).eq('status', 'FECHADO').select('competencia, vendedor_id, valor_comissao');
  if (error) return { ok: false, erro: error.message };
  if (!data?.length) return { ok: false, erro: 'Fechamento não encontrado ou já pago.' };
  registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'MARCOU COMISSÃO COMO PAGA', setor: 'COMERCIAL', equipamento_nome: `${String(data[0].competencia).slice(0, 7)} · vendedor #${data[0].vendedor_id} · ${data[0].valor_comissao}` });
  return { ok: true };
}

export async function salvarTaxaVendedorAction(t: {
  vendedor_id: number; pct_locacao: number; pct_servicos: number; ativo: boolean;
  faixas_desconto: FaixaDesconto[]; faixas_prazo: FaixaPrazo[];
}, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.gestao) return { ok: false, erro: SO_GESTAO };
  const pl = Number(t.pct_locacao), ps = Number(t.pct_servicos);
  if (![pl, ps].every(x => Number.isFinite(x) && x >= 0 && x <= 100)) return { ok: false, erro: 'As % devem ficar entre 0 e 100.' };

  // faixas: desconto crescente e % de comissão que não sobe com mais desconto
  const fd = normalizarFaixasDesconto(t.faixas_desconto);
  const fp = normalizarFaixasPrazo(t.faixas_prazo);
  if ((t.faixas_desconto || []).length !== fd.length) return { ok: false, erro: 'Faixa de desconto inválida: informe "até X%" maior que zero e a % de comissão.' };
  if ((t.faixas_prazo || []).length !== fp.length) return { ok: false, erro: 'Faixa de prazo inválida: informe "até N dias" (inteiro maior que zero) e a redução.' };
  if (new Set(fd.map(f => f.ate_pct)).size !== fd.length) return { ok: false, erro: 'Há duas faixas de desconto com o mesmo limite.' };
  if (new Set(fp.map(f => f.ate_dias)).size !== fp.length) return { ok: false, erro: 'Há duas faixas de prazo com o mesmo limite.' };
  if (fd.some(f => f.pct > 100 || f.ate_pct > 100)) return { ok: false, erro: 'Faixa de desconto acima de 100%.' };
  if (fd.some(f => f.pct > pl + 0.0001)) return { ok: false, erro: 'A % de uma faixa de desconto não pode ser maior que a % cheia de locação.' };
  for (let i = 1; i < fd.length; i++) if (fd[i].pct > fd[i - 1].pct + 0.0001) return { ok: false, erro: 'Mais desconto não pode dar mais comissão: as % das faixas precisam cair (ou ficar iguais).' };
  for (let i = 1; i < fp.length; i++) if (fp[i].reducao < fp[i - 1].reducao - 0.0001) return { ok: false, erro: 'Mais dias a menos não pode reduzir menos: as reduções precisam subir (ou ficar iguais).' };

  const { error } = await supabaseAdmin().from('comercial_comissao_vendedores').upsert({
    vendedor_id: t.vendedor_id, pct_locacao: arred(pl), pct_servicos: arred(ps), ativo: !!t.ativo,
    faixas_desconto: fd, faixas_prazo: fp,
    atualizado_por: ctx.perfil.nome, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'vendedor_id' });
  if (error) return { ok: false, erro: error.message };
  const txtFd = fd.map(f => `≤${f.ate_pct}%→${f.pct}%`).join(', ') || 'sem faixas';
  const txtFp = fp.map(f => `≤${f.ate_dias}d→−${f.reducao}`).join(', ') || 'sem faixas';
  registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'ALTEROU % DE COMISSÃO', setor: 'COMERCIAL', equipamento_nome: `vendedor #${t.vendedor_id}: locação ${pl}% · serviços ${ps}% · desconto [${txtFd}] · prazo [${txtFp}]${t.ativo ? '' : ' · sem comissão'}` });
  return { ok: true };
}

export async function salvarInicioComissoesAction(inicio: string, accessToken: string): Promise<Resultado> {
  const ctx = await contexto(accessToken);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.gestao) return { ok: false, erro: SO_GESTAO };
  if (!dataValida(inicio)) return { ok: false, erro: 'Data inválida.' };
  const { error } = await supabaseAdmin().from('comercial_comissao_config').upsert({ id: 1, inicio, atualizado_por: ctx.perfil.nome, atualizado_em: new Date().toISOString() }, { onConflict: 'id' });
  if (error) return { ok: false, erro: error.message };
  registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'ALTEROU INÍCIO DAS COMISSÕES', setor: 'COMERCIAL', equipamento_nome: inicio });
  return { ok: true };
}
