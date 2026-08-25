import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AcessoRestrito } from '../../../components/AcessoRestrito';
import { useAuth } from '../../../context/AuthContext';
import { colors } from '../../../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface OP {
  id: string;
  numero_op: number;
  responsavel_nome: string;
  empresa_recebedora: string;
  total_geral: number;
  data_vencimento: string;
  status: string;
}

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10).split('-').reverse().join('/');
}

export default function OrdensDePagamento() {
  const { session } = useAuth();
  const [lista, setLista] = useState<OP[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!session) return;
    setCarregando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/op`, {
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
    const abertas = lista.filter(op => !op.status.includes('PAGO'));
    const valor = abertas.reduce((soma, op) => soma + (op.total_geral || 0), 0);
    return { qtd: abertas.length, valor };
  }, [lista]);

  if (!session) return <AcessoRestrito />;

  function abrir(op: OP) {
    router.push({
      pathname: '/(tabs)/op/[id]',
      params: { id: op.id },
    });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.resumo}>
        <View style={styles.resumoTag}>
          <Text style={styles.resumoValor}>{resumo.qtd}</Text>
          <Text style={styles.resumoRotulo}>em aberto</Text>
        </View>
        <View style={styles.resumoTag}>
          <Text style={styles.resumoValor}>{formatarMoeda(resumo.valor)}</Text>
          <Text style={styles.resumoRotulo}>somado</Text>
        </View>
      </View>

      {carregando && lista.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : lista.length === 0 ? (
        <View style={styles.vazio}>
          <Text style={styles.vazioTexto}>Nenhuma ordem de pagamento por aqui.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          {lista.map(op => (
            <Pressable key={op.id} style={styles.linha} onPress={() => abrir(op)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.numero}>#{op.numero_op}</Text>
                <Text style={styles.empresa}>{op.empresa_recebedora}</Text>
                <Text style={styles.meta}>vence {formatarDataBR(op.data_vencimento)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <View style={[styles.tag, op.status.includes('PAGO') && styles.tagPaga]}>
                  <Text style={styles.tagTexto}>{op.status}</Text>
                </View>
                <Text style={styles.total}>{formatarMoeda(op.total_geral)}</Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
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
  container: { padding: 17, gap: 10 },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  vazioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  linha: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 14,
  },
  numero: { fontSize: 11, color: colors.textMuted, fontWeight: '700' },
  empresa: { fontSize: 15, fontWeight: '700', color: colors.white, marginTop: 2 },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  total: { fontSize: 17, fontWeight: '700', color: colors.white },
  tag: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: 'rgba(51,102,153,0.25)', borderWidth: 1, borderColor: colors.accent },
  tagPaga: { backgroundColor: 'rgba(0,0,0,0.2)', borderColor: colors.surfaceBorder },
  tagTexto: { fontSize: 11, fontWeight: '700', color: colors.white },
});
