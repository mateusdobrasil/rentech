"use server";

// app/portal/actions/actions-home.ts
// Carrega tudo que a home do Portal (/portal) precisa num único round-trip:
// crachá, documentos, holerites e permissão de dirigir. Antes, a página
// chamava 4 Server Actions em paralelo e cada uma resolvia a sessão de novo
// (resolverFuncionarioPortal -> supabase.auth.getUser, uma chamada de rede
// real pro Auth do Supabase, diferente de getSession() que lê local) — 4
// verificações de sessão + 4 invocações de função a cada carregamento, em
// vez de 1. Aqui a sessão é resolvida uma única vez e as 4 consultas seguem
// em paralelo com o nome do funcionário já em mãos.
import { supabaseAdmin } from '../../lib/supabase';
import { resolverFuncionarioPortal } from './actions-acesso';
import { buscarCrachaDados } from './actions-cracha';
import { carregarDocumentosPorNome, carregarHoleritesPorNome } from './actions-documentos';
import { exigirPermissaoDirigir } from './actions-checklist-veiculo';

type Resultado = { ok: boolean; erro?: string; info?: any };

const ERRO_SESSAO = 'Sessão inválida ou expirada. Faça login novamente.';

export async function carregarPortalHomeAction(accessToken: string): Promise<Resultado> {
  const func = await resolverFuncionarioPortal(accessToken);
  if (!func) return { ok: false, erro: ERRO_SESSAO };

  const db = supabaseAdmin();

  // Cada seção falha isolada — mesmo comportamento de antes, quando cada
  // Server Action tinha seu próprio try/catch: um erro no crachá, por
  // exemplo, não pode derrubar documentos/holerites/checklist.
  const [cracha, docs, holerites, podeDirigir] = await Promise.all([
    buscarCrachaDados(db, func.funcionarioNome).catch(() => null),
    carregarDocumentosPorNome(db, func.funcionarioNome)
      .then(documentos => ({ documentos, erro: null as string | null }))
      .catch((e: any) => ({ documentos: [] as any[], erro: e.message || 'Erro ao carregar documentos.' })),
    carregarHoleritesPorNome(db, func.funcionarioNome).catch(() => []),
    exigirPermissaoDirigir(db, func.funcionarioNome).catch(() => false),
  ]);

  return {
    ok: true,
    info: {
      cracha,
      documentos: docs.documentos,
      erroDocumentos: docs.erro,
      holerites,
      podeDirigir,
    }
  };
}
