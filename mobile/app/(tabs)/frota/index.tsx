import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { AcessoRestrito } from '../../../components/AcessoRestrito';
import { useAuth } from '../../../context/AuthContext';
import { colors } from '../../../constants/theme';
import { estadoVeiculo } from '../../../lib/frota';
import { salvarVeiculosCache, lerVeiculosCache, salvarItensModeloCache, type VeiculoCache } from '../../../lib/veiculosCache';
import { listarPendentes, processarFila, type ChecklistLocal } from '../../../lib/filaFrota';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface ChecklistAberto {
  id: string;
  numero: number;
  veiculo_id: string;
  destino: string | null;
  km_inicial: number;
  saida_em: string;
}

export default function Frota() {
  const { session } = useAuth();
  const [veiculos, setVeiculos] = useState<VeiculoCache[]>([]);
  const [checklistAberto, setChecklistAberto] = useState<ChecklistAberto | null>(null);
  const [pendentes, setPendentes] = useState<ChecklistLocal[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!session) return;
    setCarregando(true);

    const locais = await listarPendentes();
    setPendentes(locais);

    const estadoRede = await NetInfo.fetch();
    if (estadoRede.isConnected) {
      await processarFila(session.access_token);
      try {
        const res = await fetch(`${SITE_URL}/api/portal/checklist-veiculo`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (json.ok) {
          setVeiculos(json.info.veiculos);
          setChecklistAberto(json.info.checklistAberto);
          await salvarVeiculosCache(json.info.veiculos);
          await salvarItensModeloCache(json.info.itensModeloSaida, json.info.itensModeloRetorno);
          setPendentes(await listarPendentes()); // pode ter mudado depois do processarFila
        }
      } catch {
        setVeiculos(await lerVeiculosCache());
      }
    } else {
      setVeiculos(await lerVeiculosCache());
    }

    setCarregando(false);
  }, [session]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  if (!session) return <AcessoRestrito />;

  const temEmAndamento = pendentes.length > 0 || !!checklistAberto;
  const veiculosPendencia = veiculos.filter(v => estadoVeiculo(v).variante === 'acento').length;

  function abrirRetorno(idOuLocal: string) {
    router.push({ pathname: '/(tabs)/frota/[id]', params: { id: idOuLocal, etapa: 'RETORNO' } });
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.tags}>
        <View style={styles.tag}><Text style={styles.tagTexto}>{veiculos.length} veículos</Text></View>
        <View style={[styles.tag, veiculosPendencia > 0 && styles.tagAlerta]}>
          <Text style={styles.tagTexto}>{veiculosPendencia} com pendência</Text>
        </View>
      </View>

      {carregando && veiculos.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : (
        <>
          {temEmAndamento && (
            <>
              <Text style={styles.rotuloSecao}>CHECKLISTS EM ANDAMENTO</Text>
              {pendentes.map(p => {
                // SAÍDA ainda não sincronizada reabre na própria etapa SAÍDA
                // (continuar preenchendo ou reenviar) — RETORNO só faz
                // sentido depois que a saída já terminou de verdade (aí ela
                // some de "pendentes", vira SINCRONIZADO). Card de RETORNO
                // navega pelo checklist "dono" (refLocalId/refChecklistId),
                // nunca pelo próprio localId do registro de retorno.
                const alvoId = p.tipo === 'SAIDA' ? p.localId : (p.refLocalId || p.refChecklistId || p.localId);
                const alvoEtapa = p.tipo === 'SAIDA' ? 'SAIDA' : 'RETORNO';
                const titulo = p.tipo === 'SAIDA' ? p.numeroLocal : 'Retorno em preenchimento';
                return (
                  <Pressable
                    key={p.localId}
                    style={styles.cartaoAndamento}
                    onPress={() => router.push({ pathname: '/(tabs)/frota/[id]', params: { id: alvoId, etapa: alvoEtapa } })}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cartaoAndamentoTitulo}>{titulo}</Text>
                      <Text style={styles.cartaoAndamentoNota}>
                        {p.status === 'ERRO' ? `Erro ao sincronizar — ${p.erroUltimaTentativa || ''}` : p.status === 'FILA' ? 'Na fila, sobe quando voltar a rede' : 'Rascunho salvo no aparelho'}
                      </Text>
                    </View>
                    <View style={styles.tagRetorno}><Text style={styles.tagRetornoTexto}>EM ANDAMENTO</Text></View>
                  </Pressable>
                );
              })}
              {pendentes.length === 0 && checklistAberto && (
                <Pressable style={styles.cartaoAndamento} onPress={() => abrirRetorno(checklistAberto.id)}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cartaoAndamentoTitulo}>CKL-VEI-{String(checklistAberto.numero).padStart(6, '0')}</Text>
                    <Text style={styles.cartaoAndamentoNota}>Retorno pendente</Text>
                  </View>
                  <View style={styles.tagRetorno}><Text style={styles.tagRetornoTexto}>RETORNO</Text></View>
                </Pressable>
              )}
            </>
          )}

          <Pressable
            style={[styles.botaoNovo, temEmAndamento && styles.botaoDesabilitado]}
            disabled={temEmAndamento}
            onPress={() => router.push('/(tabs)/frota/novo')}
          >
            <Text style={styles.botaoNovoTexto}>NOVO CHECKLIST DE SAÍDA</Text>
          </Pressable>

          <Text style={styles.rotuloSecao}>VEÍCULOS</Text>
          {veiculos.map(v => {
            const estado = estadoVeiculo(v);
            return (
              <View key={v.id} style={styles.cartaoVeiculo}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.veiculoApelido}>{v.apelido}</Text>
                  <Text style={styles.veiculoModelo}>{v.tipo}</Text>
                  <Text style={styles.veiculoMeta}>{v.placa} · {v.km_atual != null ? `${v.km_atual} km` : 'km desconhecido'}</Text>
                </View>
                <View style={[styles.tagEstado, estado.variante === 'acento' && styles.tagEstadoAcento, estado.variante === 'contorno' && styles.tagEstadoContorno]}>
                  <Text style={styles.tagEstadoTexto}>{estado.texto}</Text>
                </View>
              </View>
            );
          })}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 17, gap: 12 },
  tags: { flexDirection: 'row', gap: 8 },
  tag: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  tagAlerta: { borderColor: colors.danger },
  tagTexto: { fontSize: 11, fontWeight: '700', color: colors.textSecondary },
  rotuloSecao: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  cartaoAndamento: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, backgroundColor: 'rgba(51,102,153,0.18)', borderWidth: 1, borderColor: colors.accent,
    padding: 14,
  },
  cartaoAndamentoTitulo: { fontSize: 14, fontWeight: '700', color: colors.white },
  cartaoAndamentoNota: { fontSize: 11.5, color: colors.textSecondary, marginTop: 2 },
  tagRetorno: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8, backgroundColor: colors.accent },
  tagRetornoTexto: { fontSize: 10, fontWeight: '800', color: colors.white },
  botaoNovo: { minHeight: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  botaoDesabilitado: { opacity: 0.45 },
  botaoNovoTexto: { color: colors.white, fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
  cartaoVeiculo: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 14,
  },
  veiculoApelido: { fontSize: 16, fontWeight: '700', color: colors.white },
  veiculoModelo: { fontSize: 12, color: colors.textSecondary },
  veiculoMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  tagEstado: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 8, borderWidth: 1, borderColor: colors.surfaceBorder },
  tagEstadoAcento: { borderColor: colors.danger, backgroundColor: 'rgba(192,57,43,0.15)' },
  tagEstadoContorno: { borderColor: colors.textSubtle },
  tagEstadoTexto: { fontSize: 10, fontWeight: '700', color: colors.textSecondary },
});
