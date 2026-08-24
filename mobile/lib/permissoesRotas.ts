// mobile/lib/permissoesRotas.ts
// Quem pode ver cada aba condicional do app (Frota/Carga/Ponto/OP) vem de
// folha_paginas_permissoes — mesma tabela que já controla acesso de rota no
// /admin, editável em /admin/parametros/permissoes → aba "Páginas" — em vez
// de um array fixo no código. Rotas virtuais '/mobile/...' cadastradas por
// sql/frota_mobile_permissao.sql; ajustar quem acessa cada aba é só editar
// essas linhas pela tela de Permissões, sem precisar mexer em código.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const ROTAS_MOBILE = ['/mobile/frota', '/mobile/carga', '/mobile/ponto', '/mobile/op'] as const;
export type RotaMobile = (typeof ROTAS_MOBILE)[number];

const CHAVE_CACHE = '@rentech/permissoes-rotas';

export async function carregarPermissoesRotas(): Promise<Record<string, string[]>> {
  try {
    const { data, error } = await supabase
      .from('folha_paginas_permissoes')
      .select('endereco_route, permissoes_permitidas')
      .in('endereco_route', ROTAS_MOBILE);
    if (error) throw error;

    const mapa: Record<string, string[]> = {};
    (data || []).forEach((r: { endereco_route: string; permissoes_permitidas: string[] | null }) => {
      mapa[r.endereco_route] = r.permissoes_permitidas || [];
    });
    await AsyncStorage.setItem(CHAVE_CACHE, JSON.stringify(mapa));
    return mapa;
  } catch {
    // Offline ou erro de rede — usa o último mapa conhecido; sem cache
    // nenhum, {} (nenhuma aba condicional aparece, seguro por padrão).
    const cache = await AsyncStorage.getItem(CHAVE_CACHE);
    if (!cache) return {};
    try {
      return JSON.parse(cache);
    } catch {
      return {};
    }
  }
}
