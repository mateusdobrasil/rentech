import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useFocusEffect } from 'expo-router';
import { colors } from '../constants/theme';

interface Props {
  /** Caminho a partir de EXPO_PUBLIC_SITE_URL, ex.: "/simulador". */
  path: string;
}

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

export function WebViewScreen({ path }: Props) {
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

  if (!SITE_URL) {
    return (
      <View style={styles.centro}>
        <Text style={styles.erroTexto}>EXPO_PUBLIC_SITE_URL não configurado. Veja mobile/.env.example.</Text>
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
        source={{ uri: `${SITE_URL}${path}` }}
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
