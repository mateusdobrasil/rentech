import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { PlusIcon } from 'phosphor-react-native';
import { AcessoRestrito } from '../../../components/AcessoRestrito';
import { useAuth } from '../../../context/AuthContext';
import { colors } from '../../../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface Checklist {
  id: string;
  numero: number;
  evento_feira: string | null;
  cliente: string | null;
  local: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  status: 'RASCUNHO' | 'SAIDA_CONFERIDA' | 'FINALIZADO';
  divergencias: number;
}

const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: 'Aguardando saída',
  SAIDA_CONFERIDA: 'Em campo',
  FINALIZADO: 'Finalizado',
};

function formatarDataBR(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10).split('-').reverse().join('/');
}

export default function ChecklistDeCarga() {
  const { session } = useAuth();
  const [lista, setLista] = useState<Checklist[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!session) return;
    setCarregando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/checklist-carga`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.ok) setLista(json.info);
    } catch {
      // sem rede — mantém a última lista carregada
    }
    setCarregando(false);
  }, [session]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  const resumo = useMemo(() => {
    const abertos = lista.filter(c => c.status !== 'FINALIZADO').length;
    const comDivergencia = lista.filter(c => c.divergencias > 0).length;
    return { abertos, comDivergencia };
  }, [lista]);

  if (!session) return <AcessoRestrito />;

  function abrir(c: Checklist) {
    router.push({ pathname: '/(tabs)/carga/[id]', params: { id: c.id } });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.resumo}>
        <View style={styles.resumoTag}>
          <Text style={styles.resumoValor}>{resumo.abertos}</Text>
          <Text style={styles.resumoRotulo}>abertos</Text>
        </View>
        <View style={styles.resumoTag}>
          <Text style={styles.resumoValor}>{resumo.comDivergencia}</Text>
          <Text style={styles.resumoRotulo}>com divergência</Text>
        </View>
      </View>

      {carregando && lista.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : lista.length === 0 ? (
        <View style={styles.vazio}>
          <Text style={styles.vazioTexto}>Nenhum checklist de carga ainda. Toque em + pra criar o primeiro.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          {lista.map(c => (
            <Pressable key={c.id} style={styles.linha} onPress={() => abrir(c)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.numero}>CKL-{String(c.numero).padStart(6, '0')}</Text>
                <Text style={styles.evento}>{c.evento_feira || 'Sem nome de evento'}</Text>
                <Text style={styles.meta}>
                  {c.local || 'Local não informado'}
                  {c.periodo_inicio ? ` · ${formatarDataBR(c.periodo_inicio)}${c.periodo_fim && c.periodo_fim !== c.periodo_inicio ? ` a ${formatarDataBR(c.periodo_fim)}` : ''}` : ''}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={[styles.tag, c.status === 'FINALIZADO' && styles.tagFinalizado]}>
                  <Text style={styles.tagTexto}>{ROTULO_STATUS[c.status] || c.status}</Text>
                </View>
                {c.divergencias > 0 ? (
                  <View style={styles.tagDivergencia}>
                    <Text style={styles.tagTexto}>{c.divergencias} diverg.</Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Pressable style={styles.fab} onPress={() => router.push('/(tabs)/carga/novo')} hitSlop={8}>
        <PlusIcon size={24} color={colors.white} weight="bold" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  resumo: { flexDirection: 'row', gap: 10, padding: 17, paddingBottom: 0 },
  resumoTag: {
    flex: 1, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder,
    padding: 12, alignItems: 'center', gap: 2,
  },
  resumoValor: { fontSize: 17, fontWeight: '700', color: colors.white },
  resumoRotulo: { fontSize: 11, color: colors.textMuted },
  container: { padding: 17, paddingBottom: 90, gap: 10 },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  vazioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  linha: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 14,
  },
  numero: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  evento: { fontSize: 15, fontWeight: '700', color: colors.white, marginTop: 2 },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  tag: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: 'rgba(51,102,153,0.25)', borderWidth: 1, borderColor: colors.accent },
  tagFinalizado: { backgroundColor: 'rgba(0,0,0,0.2)', borderColor: colors.surfaceBorder },
  tagDivergencia: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: 'rgba(192,57,43,0.15)', borderWidth: 1, borderColor: colors.danger },
  tagTexto: { fontSize: 11, fontWeight: '700', color: colors.white },
  fab: {
    position: 'absolute', right: 20, bottom: 24, width: 52, height: 52, borderRadius: 26,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
});
