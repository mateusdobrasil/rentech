// mobile/lib/baixarOffline.ts
// "Baixar para uso offline" no Perfil — não cria cache novo nenhum, só
// dispara sob demanda os mesmos dois caches que já existem e já são lidos
// organicamente ao visitar Frota e Meu Ponto/Início.
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PerfilUsuario } from '../context/AuthContext';
import { calcularModulosAcessiveis } from './permissoesRotas';
import { salvarVeiculosCache, salvarItensModeloCache } from './veiculosCache';
import { mesAtualSaoPaulo } from './espelhoPonto';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

export async function baixarParaOffline(
  accessToken: string,
  perfil: PerfilUsuario,
  permissoesRotas: Record<string, string[]>
): Promise<{ ok: boolean; resumo: string }> {
  if (!SITE_URL) return { ok: false, resumo: 'EXPO_PUBLIC_SITE_URL não configurado.' };

  const partes: string[] = [];
  const modulos = calcularModulosAcessiveis(permissoesRotas, perfil.permissaoNormalizada, perfil.podeDirigir);
  const temFrota = modulos.some(m => m.rota === '/mobile/frota');

  if (temFrota) {
    try {
      const res = await fetch(`${SITE_URL}/api/portal/checklist-veiculo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json.ok) {
        await salvarVeiculosCache(json.info.veiculos);
        await salvarItensModeloCache(json.info.itensModeloSaida, json.info.itensModeloRetorno);
        partes.push('veículos');
      }
    } catch {
      // sem rede — segue sem atualizar esse cache, o resto tenta normalmente
    }
  }

  if (perfil.tipo === 'PORTAL' && perfil.funcionarioNome) {
    try {
      const mes = mesAtualSaoPaulo();
      const res = await fetch(`${SITE_URL}/api/portal/espelho-ponto?mes=${mes}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const json = await res.json();
      if (json.ok) {
        const chave = `espelho:${perfil.funcionarioNome}:${mes}`;
        await AsyncStorage.setItem(chave, JSON.stringify({ dados: json.info, atualizadoEm: new Date().toISOString() }));
        partes.push('ponto do mês');
      }
    } catch {
      // sem rede
    }
  }

  if (partes.length === 0) {
    return { ok: false, resumo: 'Nada pra baixar além do que você já vê aqui, ou sem rede pra atualizar agora.' };
  }
  return { ok: true, resumo: `Atualizado: ${partes.join(' e ')}.` };
}
