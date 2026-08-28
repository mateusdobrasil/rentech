import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { TrashIcon } from 'phosphor-react-native';
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

// Swipe pra esquerda descarta a notificação — sem gesture-handler/reanimated
// (não instalados no projeto ainda), só Animated + PanResponder do próprio
// React Native, pra essa tela poder ir por OTA update sem exigir rebuild nativo.
function LinhaSwipeable({ children, onDescartar }: { children: React.ReactNode; onDescartar: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, gesto) => Math.abs(gesto.dx) > 8 && Math.abs(gesto.dx) > Math.abs(gesto.dy),
      onPanResponderMove: (_e, gesto) => {
        if (gesto.dx < 0) translateX.setValue(gesto.dx);
      },
      onPanResponderRelease: (_e, gesto) => {
        if (gesto.dx < -90) {
          Animated.timing(translateX, { toValue: -500, duration: 180, useNativeDriver: true }).start(() => onDescartar());
        } else {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        }
      },
    })
  ).current;

  return (
    <View style={styles.swipeWrapper}>
      <View style={styles.swipeFundo}>
        <TrashIcon size={18} color={colors.white} weight="bold" />
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
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

  function descartar(id: string) {
    if (!session || !SITE_URL) return;
    setLista(prev => prev.filter(item => item.id !== id));
    fetch(`${SITE_URL}/api/portal/notificacoes/excluir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  function marcarTodasComoLidas() {
    if (!session || !SITE_URL) return;
    setLista(prev => prev.map(item => ({ ...item, lida: true })));
    fetch(`${SITE_URL}/api/portal/notificacoes/marcar-lida`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ todas: true }),
    }).catch(() => {});
  }

  const temNaoLida = lista.some(n => !n.lida);

  return (
    <View style={styles.screen}>
      <Cabecalho titulo="Notificações" />
      {temNaoLida && (
        <View style={styles.acoes}>
          <Pressable onPress={marcarTodasComoLidas} hitSlop={8}>
            <Text style={styles.acaoTexto}>Marcar todas como lida</Text>
          </Pressable>
        </View>
      )}
      {carregando && lista.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : lista.length === 0 ? (
        <View style={styles.vazio}>
          <Text style={styles.vazioTexto}>Nenhuma notificação ainda.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          {lista.map(n => (
            <LinhaSwipeable key={n.id} onDescartar={() => descartar(n.id)}>
              <Pressable style={styles.linha} onPress={() => abrir(n)}>
                <View style={[styles.ponto, !n.lida && styles.pontoNaoLido]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.linhaTopo}>
                    <Text style={styles.titulo} numberOfLines={1}>{n.titulo}</Text>
                    <Text style={styles.hora}>{horaCurta(n.criado_em)}</Text>
                  </View>
                  <Text style={styles.corpo}>{n.corpo}</Text>
                </View>
              </Pressable>
            </LinhaSwipeable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  acoes: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 17, paddingTop: 12 },
  acaoTexto: { fontSize: 12.5, fontWeight: '700', color: colors.accent },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  vazioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  container: { padding: 17, gap: 10 },
  swipeWrapper: { borderRadius: 14, overflow: 'hidden' },
  swipeFundo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.danger,
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingRight: 20,
  },
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
