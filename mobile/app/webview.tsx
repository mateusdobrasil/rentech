import { useLocalSearchParams } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { LockSimpleIcon } from 'phosphor-react-native';
import { Cabecalho } from '../components/Cabecalho';
import { WebViewScreen } from '../components/WebViewScreen';
import { colors } from '../constants/theme';

export default function WebViewRoute() {
  const { url, titulo } = useLocalSearchParams<{ url?: string; titulo?: string }>();
  const path = url || '/';

  return (
    <View style={styles.screen}>
      <Cabecalho titulo={titulo || 'Sistema web'} subtitulo={path} />
      <View style={styles.faixa}>
        <LockSimpleIcon size={13} color={colors.textMuted} weight="fill" />
        <Text style={styles.faixaTexto}>Módulo do sistema web, aberto com a sessão do app. Sem segunda senha.</Text>
      </View>
      <WebViewScreen path={path} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 17,
    paddingVertical: 8,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  faixaTexto: { flex: 1, fontSize: 10.5, color: colors.textMuted },
});
