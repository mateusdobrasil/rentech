// app/admin/locacoes/reservas/contratoCore.ts
// Contrato de locação assinado na Autentique (2026-11-17): vendedor(a) e
// cliente sempre; testemunhas, representante da empresa e outras pessoas
// quando incluídos no envio (app/lib/locacao/assinantesContrato.ts). SEM "use server": usado pelas
// actions (actions-contrato.ts) e pelo webhook app/api/webhooks/autentique.
// O webhook marca "assinado" na 1ª assinatura; aqui o status vem da consulta
// ao documento: ASSINADO só quando TODOS assinaram (PARCIAL no meio).
import { supabaseAdmin } from '../../../lib/supabase';
import { registrarLogAuditoria } from '../../../actions';
import { autentiqueConsultarDocumento } from '../../../lib/autentique';
import { numeroFichaPorId } from '../../../lib/locacao/fichaNumero';
import { BUCKET_PROPOSTAS } from './propostaCore';
import { ROTULO_PAPEL, type AssinanteContrato } from '../../../lib/locacao/assinantesContrato';

type Db = ReturnType<typeof supabaseAdmin>;
export type StatusContrato = 'ENVIADO' | 'VISUALIZADO' | 'PARCIAL' | 'ASSINADO' | 'REJEITADO' | 'CANCELADO';
export type SignatarioContrato = AssinanteContrato;

async function historico(db: Db, fichaId: number, usuario: string, acao: string, detalhe: string) {
  await db.from('locacao_fichas_reserva_historico').insert({ ficha_id: fichaId, usuario, acao, detalhe });
}

async function arquivarAssinado(db: Db, c: { ficha_id: number; versao: number }, url: string | null | undefined): Promise<string | null> {
  const token = process.env.AUTENTIQUE_API_TOKEN;
  if (!url || !token) return null;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return null;
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const caminho = `ficha-${c.ficha_id}/contrato-v${c.versao}-assinado.pdf`;
  const { error } = await db.storage.from(BUCKET_PROPOSTAS).upload(caminho, bytes, { contentType: 'application/pdf', upsert: true });
  return error ? null : caminho;
}

/** Aplica o estado atual do documento na Autentique. false = docId não é de contrato. */
export async function processarEventoContrato(db: Db, docId: string): Promise<boolean> {
  const { data: c } = await db.from('locacao_contratos').select('*').eq('autentique_doc_id', docId).maybeSingle();
  if (!c) return false;
  if (c.status === 'CANCELADO') return true;
  if (c.status === 'ASSINADO' && c.pdf_assinado_path) return true;

  const doc = await autentiqueConsultarDocumento(docId);
  const sigs = ((doc?.signatures || []) as any[]).filter(s => s?.action?.name === 'SIGN');
  const antes: SignatarioContrato[] = Array.isArray(c.signatarios) ? c.signatarios : [];
  // casa por public_id; senão pela ordem de envio
  const signatarios: SignatarioContrato[] = antes.map((s, i) => {
    const a = sigs.find(x => s.public_id && x.public_id === s.public_id) || sigs[i];
    if (!a) return s;
    return {
      ...s, public_id: a.public_id || s.public_id || null,
      visualizado_em: a.viewed?.created_at || s.visualizado_em || null,
      assinado_em: a.signed?.created_at || s.assinado_em || null,
      rejeitado_em: a.rejected?.created_at || s.rejeitado_em || null,
    };
  });
  const todosAssinaram = signatarios.length > 0 && signatarios.every(s => s.assinado_em);
  const status: StatusContrato = signatarios.some(s => s.rejeitado_em) ? 'REJEITADO'
    : todosAssinaram ? 'ASSINADO'
    : signatarios.some(s => s.assinado_em) ? 'PARCIAL'
    : signatarios.some(s => s.visualizado_em) ? 'VISUALIZADO' : 'ENVIADO';

  const agora = new Date().toISOString();
  const upd: Record<string, unknown> = { status, signatarios, atualizado_em: agora };
  if (status === 'ASSINADO') {
    upd.assinado_em = signatarios.map(s => s.assinado_em!).sort().pop();
    const caminho = await arquivarAssinado(db, c, doc?.files?.signed || doc?.files?.pades).catch(() => null);
    if (caminho) upd.pdf_assinado_path = caminho;
  }
  if (status === 'REJEITADO') upd.rejeitado_em = signatarios.find(s => s.rejeitado_em)?.rejeitado_em || agora;
  await db.from('locacao_contratos').update(upd).eq('id', c.id);

  if (status !== c.status) {
    const num = numeroFichaPorId(c.ficha_id);
    const teste = c.sandbox ? ' (TESTE)' : '';
    if (status === 'PARCIAL') {
      const faltam = signatarios.filter(s => !s.assinado_em).map(s => s.nome).join(', ');
      await historico(db, c.ficha_id, 'AUTENTIQUE', 'CONTRATO_ASSINATURA', `Contrato v${c.versao}${teste}: assinatura parcial — falta ${faltam}`);
    }
    if (status === 'ASSINADO') {
      await historico(db, c.ficha_id, 'AUTENTIQUE', 'CONTRATO_ASSINADO', `Contrato v${c.versao}${teste} assinado por todos: ${signatarios.map(x => `${x.nome} (${ROTULO_PAPEL[x.papel] || x.papel})`).join(', ')}`);
      registrarLogAuditoria({ usuario_nome: 'AUTENTIQUE', acao: 'CONTRATO DE LOCAÇÃO ASSINADO', setor: 'LOCACOES', equipamento_nome: `${num} v${c.versao}${teste}` });
    }
    if (status === 'REJEITADO') {
      await historico(db, c.ficha_id, 'AUTENTIQUE', 'CONTRATO_RECUSADO', `Contrato v${c.versao}${teste} recusado na Autentique`);
      registrarLogAuditoria({ usuario_nome: 'AUTENTIQUE', acao: 'CONTRATO DE LOCAÇÃO RECUSADO', setor: 'LOCACOES', equipamento_nome: `${num} v${c.versao}${teste}` });
    }
  }
  return true;
}

export async function atualizarContratoPelaAutentique(db: Db, contratoId: number): Promise<StatusContrato | null> {
  const { data: c } = await db.from('locacao_contratos').select('autentique_doc_id').eq('id', contratoId).maybeSingle();
  if (!c?.autentique_doc_id) return null;
  await processarEventoContrato(db, c.autentique_doc_id);
  const { data } = await db.from('locacao_contratos').select('status').eq('id', contratoId).maybeSingle();
  return (data?.status as StatusContrato) || null;
}
