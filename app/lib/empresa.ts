// Nome da empresa para uso DENTRO de mensagens (WhatsApp/e-mail) — o
// destinatário precisa ver a empresa dele, não uma fixa no texto.
//
// Prefere `empresas.nome_curto` ("Rentech") ao nome de cadastro
// ("RENTECH LOCADORA"), que é pesado no meio de uma frase. O nome de cadastro
// segue sendo o oficial pra contrato, holerite e documento.
import { supabaseAdmin } from './supabase';

export type MapaEmpresas = Map<number, string>;

interface LinhaEmpresa {
  id: number;
  nome?: string | null;
  nome_curto?: string | null;
}

// select('*') de propósito: `nome_curto` entra por migração, e pedir a coluna
// pelo nome faria TODO disparo falhar caso o código suba antes do SQL rodar.
// Com '*', se a coluna ainda não existe ela só não vem e o fallback assume.
export async function carregarNomesEmpresas(db: ReturnType<typeof supabaseAdmin>): Promise<MapaEmpresas> {
  const { data } = await db.from('empresas').select('*');
  const mapa: MapaEmpresas = new Map();
  for (const e of (data || []) as LinhaEmpresa[]) {
    const nome = (e.nome_curto || e.nome || '').trim();
    if (nome) mapa.set(e.id, nome);
  }
  return mapa;
}

// Qual empresa a mensagem deve citar: a do próprio destinatário quando
// conhecida — assim, num card "todas as empresas", cada funcionário recebe o
// nome da SUA empresa — caindo para a empresa presa ao card. Vazio se nenhuma
// das duas resolve, e aí o {{empresa}} simplesmente não aparece.
export function nomeEmpresaPara(
  mapa: MapaEmpresas,
  empresaFuncionario: number | null | undefined,
  empresaAutomacao: number | null | undefined,
): string {
  return (empresaFuncionario ? mapa.get(empresaFuncionario) : '')
    || (empresaAutomacao ? mapa.get(empresaAutomacao) : '')
    || '';
}
