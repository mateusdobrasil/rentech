import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Cabecalho } from '../components/Cabecalho';
import { useAuth } from '../context/AuthContext';
import { colors } from '../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface Notificacao {
  id: string;
  titulo: string;
  corpo: string;
  dados: { tipo?: 'ponto' | 'op' | 'carga' | 'frota'; id?: string } | null;
  lida: boolean;
  criado_em: string;
}

const DESTINO_POR_TIPO: Record<string, string> = {
  ponto: '/ponto',
  op: '/op',
  carga: '/carga',
  frota: '/frota',
};

function horaCurta(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function Notificacoes() {
  const { session } = useAuth();
  const [lista, setLista] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!session || !SITE_URL) return;
    setCarregando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/notificacoes`, {
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

  async function abrir(n: Notificacao) {
    if (!session || !SITE_URL) return;
    if (!n.lida) {
      setLista(prev => prev.map(item => (item.id === n.id ? { ...item, lida: true } : item)));
      fetch(`${SITE_URL}/api/portal/notificacoes/marcar-lida`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: n.id }),
      }).catch(() => {});
    }
    const destino = n.dados?.tipo ? DESTINO_POR_TIPO[n.dados.tipo] : null;
    if (destino) router.push(destino as never);
  }

  return (
    <View style={styles.screen}>
      <Cabecalho titulo="Notificações" />
      {carregando && lista.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : lista.length === 0 ? (
        <View style={styles.vazio}>
          <Text style={styles.vazioTexto}>Nenhuma notificação ainda.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          {lista.map(n => (
            <Pressable key={n.id} style={styles.linha} onPress={() => abrir(n)}>
              <View style={[styles.ponto, !n.lida && styles.pontoNaoLido]} />
              <View style={{ flex: 1 }}>
                <View style={styles.linhaTopo}>
                  <Text style={styles.titulo} numberOfLines={1}>{n.titulo}</Text>
                  <Text style={styles.hora}>{horaCurta(n.criado_em)}</Text>
                </View>
                <Text style={styles.corpo}>{n.corpo}</Text>
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
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  vazioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  container: { padding: 17, gap: 10 },
  linha: {
    flexDirection: 'row', gap: 10,
    borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 14,
  },
  ponto: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.surfaceBorder, marginTop: 5 },
  pontoNaoLido: { backgroundColor: colors.accent },
  linhaTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  titulo: { flex: 1, fontSize: 14, fontWeight: '700', color: colors.white },
  hora: { fontSize: 10.5, color: colors.textMuted },
  corpo: { fontSize: 12.5, color: colors.textSecondary, marginTop: 4 },
});
