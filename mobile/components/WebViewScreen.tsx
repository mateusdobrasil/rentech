import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { colors } from '../constants/theme';

interface Props {
  /** Caminho a partir de EXPO_PUBLIC_SITE_URL, ex.: "/simulador". */
  path: string;
}

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

export function WebViewScreen({ path }: Props) {
  const { session } = useAuth();
  const webviewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Botão físico de voltar do Android navega o histórico da WebView antes de
  // sair da aba (senão a primeira tentativa de "voltar" fecharia o app).
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (canGoBack) {
          webviewRef.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [canGoBack])
  );

  // A WebView é um contexto de storage isolado do AsyncStorage do app RN — não
  // enxerga a sessão do app. /mobile-bridge (web/) recebe os tokens pelo
  // fragment da URL (nunca vai pro servidor), estabelece a sessão do lado do
  // navegador via supabase.auth.setSession(), e só então navega pro destino —
  // ver app/mobile-bridge/page.tsx no repo web/.
  //
  // useMemo (e não recalcular direto no corpo do componente) é essencial
  // aqui: react-native-webview trata `source={{uri}}` como uma navegação nova
  // sempre que o OBJETO muda de referência — mesmo com a mesma string de uri.
  // Sem isso, qualquer re-render do componente (frequente: AuthContext,
  // navegação, etc.) recarregava a ponte do zero, cancelando o
  // setSession()+redirect ainda em andamento antes de completar — a WebView
  // ficava presa recarregando /mobile-bridge sem nunca chegar no destino.
  const bridgeUri = useMemo(() => {
    if (!SITE_URL || !session) return null;
    return (
      `${SITE_URL}/mobile-bridge` +
      `#access_token=${encodeURIComponent(session.access_token)}` +
      `&refresh_token=${encodeURIComponent(session.refresh_token)}` +
      `&redirect=${encodeURIComponent(path)}`
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token, session?.refresh_token, path]);

  const source = useMemo(() => (bridgeUri ? { uri: bridgeUri } : undefined), [bridgeUri]);

  if (!SITE_URL) {
    return (
      <View style={styles.centro}>
        <Text style={styles.erroTexto}>EXPO_PUBLIC_SITE_URL não configurado. Veja mobile/.env.example.</Text>
      </View>
    );
  }

  // Não deveria ser alcançável (a rota /webview só existe atrás do gate de
  // autenticação em app/_layout.tsx), mas defensivo: sem sessão não há token
  // pra passar pra ponte, e abrir a WebView sem sessão deixaria a página alvo
  // cair no próprio /login ou /portal/login dela.
  if (!session) {
    return (
      <View style={styles.centro}>
        <Text style={styles.erroTexto}>Sem sessão ativa. Volte e entre de novo.</Text>
      </View>
    );
  }

  if (erro) {
    return (
      <View style={styles.centro}>
        <Text style={styles.erroTexto}>Não foi possível carregar. Verifique sua conexão.</Text>
        <Pressable
          style={styles.botao}
          onPress={() => {
            setErro(false);
            setLoading(true);
            setReloadKey((k) => k + 1);
          }}
        >
          <Text style={styles.botaoTexto}>Tentar de novo</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <WebView
        key={reloadKey}
        ref={webviewRef}
        source={source}
        onLoadEnd={() => setLoading(false)}
        onError={() => setErro(true)}
        onHttpError={() => setErro(true)}
        onNavigationStateChange={(nav: WebViewNavigation) => setCanGoBack(nav.canGoBack)}
        startInLoadingState={false}
      />
      {loading && (
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  centro: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: colors.background,
  },
  erroTexto: { textAlign: 'center', color: colors.textMuted },
  botao: { backgroundColor: colors.primary, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  botaoTexto: { color: colors.white, fontWeight: '700' },
});
