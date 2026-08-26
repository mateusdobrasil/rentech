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

export interface ModuloAcesso {
  rota: RotaMobile;
  /** true = cabe na tab bar; false = passou do limite de 5 abas (Início +
   * Perfil + 3), vira só card na Início (README: "Máximo 5 abas. O que não
   * cabe vira card na tela Início."). */
  comoAba: boolean;
}

const LIMITE_ABAS_MODULO = 3; // Início + Perfil já ocupam 2 das 5 possíveis

// Calcula, na mesma ordem de ROTAS_MOBILE (Frota, Carga, Ponto, OP), quais
// módulos o usuário acessa e quais cabem como aba — usado tanto por
// (tabs)/_layout.tsx (pra decidir a tab bar) quanto por (tabs)/index.tsx
// (pra saber o que virar card na Início, inclusive o que foi demovido da
// tab bar). Cargos com acesso amplo (ex.: ADMINISTRADOR, hoje liberado nas
// 4 rotas) não devem nunca ver mais de 3 abas de módulo ao mesmo tempo.
export function calcularModulosAcessiveis(
  mapa: Record<string, string[]>,
  permissaoNormalizada: string | undefined,
  podeDirigir: boolean | undefined
): ModuloAcesso[] {
  const acessiveis = ROTAS_MOBILE.filter(rota => {
    if (rota === '/mobile/frota' && podeDirigir) return true;
    if (!permissaoNormalizada) return false;
    return (mapa[rota] || []).includes(permissaoNormalizada);
  });
  return acessiveis.map((rota, indice) => ({ rota, comoAba: indice < LIMITE_ABAS_MODULO }));
}

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
