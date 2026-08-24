"use server";

// app/portal/actions/actions-ponto.ts
// Espelho de ponto do PRÓPRIO funcionário logado, só leitura. Mesma lógica de
// montagem dia a dia usada em actions-assinatura.ts (gerarEspelhoPontoBytes),
// mas devolvendo os dados prontos para a tabela do Portal e, opcionalmente,
// o PDF gerado sob demanda (não há PDF arquivado fora do fluxo de assinatura
// de holerite — aqui ele é gerado na hora, não persistido).
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';
import { gerarEspelhoPontoPdf } from '../../lib/gerarEspelhoPontoPdf';
import { montarEspelhoDoMes } from '../lib/espelhoPonto';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';

export async function buscarMeuEspelhoPontoAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const espelho = await montarEspelhoDoMes(db, func.funcionarioNome, mesReferencia);
    return { ok: true, info: espelho };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}

export async function baixarMeuEspelhoPontoPdfAction(accessToken: string, mesReferencia: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();
  try {
    const espelho = await montarEspelhoDoMes(db, func.funcionarioNome, mesReferencia);
    const bytes = await gerarEspelhoPontoPdf({
      nome: func.funcionarioNome,
      cpf: espelho.cpf,
      mesReferencia,
      registros: espelho.registros,
      feriados: espelho.feriados,
      dataAdmissao: espelho.dataAdmissao,
      dataDesligamento: espelho.dataDesligamento,
      empresaNome: espelho.empresaNome,
    });
    return { ok: true, info: { pdfBase64: Buffer.from(bytes).toString('base64') } };
  } catch (e: any) {
    return { ok: false, erro: e.message };
  }
}
