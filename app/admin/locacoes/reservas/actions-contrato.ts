'use server';

// app/admin/locacoes/reservas/actions-contrato.ts
// Contrato de locação (2026-11-17): gerado da ficha aprovada/reservada no
// modelo padrão da empresa e enviado para assinatura na Autentique.
// Assinam: vendedor(a) e cliente sempre; testemunhas, representante da
// empresa (só se marcado) e outras pessoas, se incluídos. Núcleo: contratoCore.ts.
import { supabaseAdmin } from '../../../lib/supabase';
import { validarAcesso, obterEmpresasPermitidas, empresaPermitida } from '../../../lib/serverAuth';
import { registrarLogAuditoria } from '../../../actions';
import { autentiqueCriarDocumento, autentiqueCancelarDocumento } from '../../../lib/autentique';
import { gerarContratoPdf } from '../../../lib/locacao/gerarContratoPdf';
import { montarDadosContrato } from '../../../lib/locacao/dadosDocumentos';
import { numeroFichaPorId } from '../../../lib/locacao/fichaNumero';
import { acessoLocacao, podeVerCliente, MSG_FICHA_FORA_CARTEIRA } from '../../../lib/locacao/acessoFichas';
import { BUCKET_PROPOSTAS } from './propostaCore';
import { contatoVendedor } from '../../../lib/locacao/contatoVendedor';
import { atualizarContratoPelaAutentique, type SignatarioContrato } from './contratoCore';
import { ROTULO_PAPEL, PELA_LOCADORA, MAX_ASSINANTES, type PapelAssinante } from '../../../lib/locacao/assinantesContrato';

type Resultado = { ok: boolean; erro?: string; info?: any };
const ROTA = '/admin/locacoes/reservas';
const CONTRATAVEIS = ['APROVADO', 'RESERVADA', 'EM_LOCACAO', 'FINALIZADA'];
const ABERTOS = ['ENVIADO', 'VISUALIZADO', 'PARCIAL'];
const SEM_EDITAR = 'Seu usuário não pode alterar fichas de locação.';

async function contextoFicha(accessToken: string, fichaId: number) {
  const v = await validarAcesso(accessToken, ROTA);
  if (!v.ok) return { erro: v.message } as const;
  const db = supabaseAdmin();
  const [permitidas, acesso] = await Promise.all([obterEmpresasPermitidas(v.perfil.id, v.perfil.permissaoNormalizada), acessoLocacao(db, v.perfil)]);
  const { data: ficha } = await db.from('locacao_fichas_reserva').select('*').eq('id', fichaId).maybeSingle();
  if (!ficha) return { erro: 'Ficha não encontrada.' } as const;
  if (!empresaPermitida(permitidas, ficha.empresa_id)) return { erro: 'Você não tem acesso a esta empresa.' } as const;
  if (!(await podeVerCliente(db, acesso, ficha.parceiro_id))) return { erro: MSG_FICHA_FORA_CARTEIRA } as const;
  return { perfil: v.perfil, ficha, acesso } as const;
}

async function contextoContrato(accessToken: string, contratoId: number) {
  const { data: c } = await supabaseAdmin().from('locacao_contratos').select('*').eq('id', contratoId).maybeSingle();
  if (!c) return { erro: 'Contrato não encontrado.' } as const;
  const ctx = await contextoFicha(accessToken, c.ficha_id);
  if ('erro' in ctx) return { erro: ctx.erro as string } as const;
  return { ...ctx, contrato: c } as const;
}

function celularE164(t?: string | null): string | null {
  const d = (t || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `+55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return `+${d}`;
  return null;
}
const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function listarContratosAction(fichaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contextoFicha(accessToken, fichaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const db = supabaseAdmin();
  try {
    const [{ data, error }, { data: emp }, vend] = await Promise.all([
      db.from('locacao_contratos').select('id, versao, status, sandbox, signatarios, valor_total, conteudo_versao, pdf_original_path, pdf_assinado_path, enviado_por, enviado_em, assinado_em, rejeitado_em, motivo_cancelamento')
        .eq('ficha_id', fichaId).order('versao', { ascending: false }),
      db.from('empresas').select('*').eq('id', ctx.ficha.empresa_id).maybeSingle(),
      contatoVendedor(db, ctx.ficha.vendedor_id, ctx.ficha.vendedor_nome),
    ]);
    const v = vend;
    if (error) throw error;
    const e: any = emp || {};
    return {
      ok: true,
      info: {
        contratos: data || [], conteudoAtual: ctx.ficha.conteudo_alterado_em,
        representante: { nome: e.contrato_representante_nome || '', email: e.contrato_representante_email || '', celular: e.contrato_representante_celular || '' },
        // Ficha do Funcionário (nossa base de colaboradores)
        vendedor: { nome: v?.nome || '', email: v?.email || '', celular: v?.celular || '' },
        // o que falta no cadastro da empresa para o contrato sair completo
        pendenciasEmpresa: [!e.endereco && 'endereço', !e.cnpj && 'CNPJ', !e.inscricao_estadual && 'inscrição estadual'].filter(Boolean),
      },
    };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function previaContratoAction(fichaId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contextoFicha(accessToken, fichaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    const bytes = await gerarContratoPdf(await montarDadosContrato(supabaseAdmin(), fichaId));
    return { ok: true, info: { base64: Buffer.from(bytes).toString('base64'), nome: `contrato-${numeroFichaPorId(fichaId)}.pdf` } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

interface PessoaEnvio { papel: PapelAssinante; nome: string; celular?: string | null; email?: string | null }

export async function enviarContratoAction(fichaId: number, dados: { assinantes: PessoaEnvio[]; sandbox: boolean }, accessToken: string): Promise<Resultado> {
  const ctx = await contextoFicha(accessToken, fichaId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_EDITAR };
  const f = ctx.ficha;
  if (f.origem === 'P2S') return { ok: false, erro: 'Ficha importada do P2S — o contrato sai pelo PrimeStart.' };
  if (!CONTRATAVEIS.includes(f.status)) return { ok: false, erro: 'O contrato sai depois que a ficha é aprovada/reservada.' };

  // valida quem assina: cliente + alguém pela locadora (vendedor(a) ou representante)
  const lista = (dados.assinantes || []).filter(p => p && (p.nome || p.email || p.celular));
  if (!lista.some(p => p.papel === 'LOCATARIA')) return { ok: false, erro: 'Inclua o cliente entre quem assina.' };
  if (!lista.some(p => PELA_LOCADORA.includes(p.papel))) return { ok: false, erro: 'Inclua o(a) vendedor(a) ou o representante para assinar pela empresa.' };
  if (lista.length > MAX_ASSINANTES) return { ok: false, erro: `No máximo ${MAX_ASSINANTES} pessoas por contrato.` };
  const signatarios: SignatarioContrato[] = [];
  const contatos = new Set<string>();
  for (const p of lista) {
    if (!ROTULO_PAPEL[p.papel]) return { ok: false, erro: 'Papel de assinatura inválido.' };
    const rotulo = ROTULO_PAPEL[p.papel].toLowerCase();
    const nome = (p.nome || '').trim();
    if (!nome) return { ok: false, erro: `Informe o nome (${rotulo}).` };
    const celular = p.celular ? celularE164(p.celular) : null;
    if (p.celular && !celular) return { ok: false, erro: `Celular de ${nome} inválido — use DDD + número.` };
    const email = (p.email || '').trim().toLowerCase() || null;
    if (email && !emailValido(email)) return { ok: false, erro: `E-mail de ${nome} inválido.` };
    if (!celular && !email) return { ok: false, erro: `Informe o celular (WhatsApp) ou o e-mail de ${nome}.` };
    const chave = celular || email!;
    if (contatos.has(chave)) return { ok: false, erro: `O contato de ${nome} se repete — cada pessoa precisa de um celular/e-mail próprio.` };
    contatos.add(chave);
    signatarios.push({ papel: p.papel, nome, celular, email });
  }

  const db = supabaseAdmin();
  try {
    const { data: ultima } = await db.from('locacao_contratos').select('versao').eq('ficha_id', fichaId).order('versao', { ascending: false }).limit(1).maybeSingle();
    const versao = (ultima?.versao || 0) + 1;
    const numero = numeroFichaPorId(fichaId);
    const pdf = await gerarContratoPdf(await montarDadosContrato(db, fichaId, signatarios.map(x => ({ papel: x.papel, nome: x.nome }))));
    const caminho = `ficha-${fichaId}/contrato-v${versao}.pdf`;
    const { error: eUp } = await db.storage.from(BUCKET_PROPOSTAS).upload(caminho, pdf, { contentType: 'application/pdf', upsert: true });
    if (eUp) throw new Error(`Falha ao guardar o PDF: ${eUp.message}`);

    const { data: cli } = await db.from('parceiros').select('nome_exibicao, nome_completo').eq('id', f.parceiro_id).maybeSingle();
    const doc = await autentiqueCriarDocumento({
      nomeDocumento: `Contrato de Locação ${numero}${versao > 1 ? ` v${versao}` : ''} — ${cli?.nome_exibicao || cli?.nome_completo || signatarios[0].nome}`,
      signatarioNome: signatarios[0].nome,
      signatarios: signatarios.map(s => ({ nome: s.nome, celular: s.celular || undefined, email: s.celular ? undefined : s.email || undefined })),
      pdfBuffer: pdf, pdfNomeArquivo: `contrato-${numero}-v${versao}.pdf`, sandbox: !!dados.sandbox,
    });
    signatarios.forEach((s, i) => { s.link = doc.assinaturas[i]?.link || null; s.public_id = doc.assinaturas[i]?.publicId || null; });

    const agora = new Date().toISOString();
    const { error: eIns } = await db.from('locacao_contratos').insert({
      ficha_id: fichaId, versao, status: 'ENVIADO', autentique_doc_id: doc.docId, sandbox: !!dados.sandbox, signatarios,
      valor_total: f.valor_total, conteudo_versao: f.conteudo_alterado_em, pdf_original_path: caminho,
      enviado_por: ctx.perfil.nome, enviado_em: agora, atualizado_em: agora,
    });
    if (eIns) throw new Error(`Documento criado na Autentique (${doc.docId}), mas falha ao gravar o controle: ${eIns.message}`);

    // versões anteriores ainda abertas deixam de valer
    const { data: abertos } = await db.from('locacao_contratos').select('id, autentique_doc_id').eq('ficha_id', fichaId).in('status', ABERTOS).lt('versao', versao);
    for (const a of abertos || []) {
      try { if (a.autentique_doc_id) await autentiqueCancelarDocumento(a.autentique_doc_id); } catch { /* marca cancelado mesmo assim */ }
      await db.from('locacao_contratos').update({ status: 'CANCELADO', motivo_cancelamento: `Substituído pela versão ${versao}`, atualizado_em: agora }).eq('id', a.id);
    }

    await db.from('locacao_fichas_reserva_historico').insert({
      ficha_id: fichaId, usuario: ctx.perfil.nome, acao: 'CONTRATO_ENVIADO',
      detalhe: `Contrato v${versao} enviado para assinatura: ${signatarios.map(x => `${x.nome} — ${ROTULO_PAPEL[x.papel]} (${x.celular ? 'WhatsApp' : 'e-mail'})`).join('; ')}${dados.sandbox ? ' — TESTE (sandbox)' : ''}`,
    });
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'ENVIOU CONTRATO DE LOCAÇÃO (AUTENTIQUE)', setor: 'LOCACOES', equipamento_nome: `${numero} v${versao}` });
    return { ok: true, info: { versao } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function atualizarStatusContratoAction(contratoId: number, accessToken: string): Promise<Resultado> {
  const ctx = await contextoContrato(accessToken, contratoId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  try {
    return { ok: true, info: { status: await atualizarContratoPelaAutentique(supabaseAdmin(), contratoId) } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarContratoAction(contratoId: number, qual: 'ORIGINAL' | 'ASSINADO', accessToken: string): Promise<Resultado> {
  const ctx = await contextoContrato(accessToken, contratoId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  const caminho = qual === 'ASSINADO' ? ctx.contrato.pdf_assinado_path : ctx.contrato.pdf_original_path;
  if (!caminho) return { ok: false, erro: qual === 'ASSINADO' ? 'O PDF assinado ainda não chegou — use "Atualizar".' : 'PDF não encontrado.' };
  const { data, error } = await supabaseAdmin().storage.from(BUCKET_PROPOSTAS).createSignedUrl(caminho, 60 * 10, { download: caminho.split('/').pop() });
  if (error) return { ok: false, erro: error.message };
  return { ok: true, info: { url: data.signedUrl } };
}

export async function cancelarContratoAction(contratoId: number, motivo: string, accessToken: string): Promise<Resultado> {
  const ctx = await contextoContrato(accessToken, contratoId);
  if ('erro' in ctx) return { ok: false, erro: ctx.erro };
  if (!ctx.acesso.podeEditar) return { ok: false, erro: SEM_EDITAR };
  if (!ABERTOS.includes(ctx.contrato.status)) return { ok: false, erro: 'Só dá para cancelar contrato ainda não assinado por todos.' };
  try {
    if (ctx.contrato.autentique_doc_id) await autentiqueCancelarDocumento(ctx.contrato.autentique_doc_id);
    const db = supabaseAdmin();
    await db.from('locacao_contratos').update({ status: 'CANCELADO', motivo_cancelamento: motivo?.trim() || 'Cancelado', atualizado_em: new Date().toISOString() }).eq('id', contratoId);
    await db.from('locacao_fichas_reserva_historico').insert({
      ficha_id: ctx.contrato.ficha_id, usuario: ctx.perfil.nome, acao: 'CONTRATO_CANCELADO', detalhe: `Contrato v${ctx.contrato.versao} cancelado${motivo ? `: ${motivo}` : ''}`,
    });
    registrarLogAuditoria({ usuario_nome: ctx.perfil.nome, acao: 'CANCELOU CONTRATO DE LOCAÇÃO', setor: 'LOCACOES', equipamento_nome: `${numeroFichaPorId(ctx.contrato.ficha_id)} v${ctx.contrato.versao}` });
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
