import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CaretLeftIcon, BellIcon } from 'phosphor-react-native';
import { colors } from '../constants/theme';

interface Props {
  titulo: string;
  subtitulo?: string;
  /** Esconde o botão voltar em telas-raiz (ex.: Início). Default: true. */
  mostrarVoltar?: boolean;
  /**
   * Sino de notificações. Fase 1 não tem push/inbox ainda (expo-notifications
   * fica pra depois) — por padrão o sino não aparece; passe onPress quando a
   * rota /notificacoes existir.
   */
  onNotificacoesPress?: () => void;
  naoLidas?: boolean;
}

export function Cabecalho({ titulo, subtitulo, mostrarVoltar = true, onNotificacoesPress, naoLidas }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top + 11 }]}>
      {mostrarVoltar ? (
        <Pressable style={styles.voltar} onPress={() => router.back()} hitSlop={8}>
          <CaretLeftIcon size={18} color={colors.white} weight="bold" />
        </Pressable>
      ) : (
        <View style={styles.voltarEspaco} />
      )}

      <View style={styles.titulos}>
        <Text style={styles.titulo} numberOfLines={1}>{titulo}</Text>
        {subtitulo ? <Text style={styles.subtitulo} numberOfLines={1}>{subtitulo}</Text> : null}
      </View>

      {onNotificacoesPress ? (
        <Pressable style={styles.notificacoes} onPress={onNotificacoesPress} hitSlop={8}>
          <BellIcon size={18} color={colors.white} weight="regular" />
          {naoLidas ? <View style={styles.ponto} /> : null}
        </Pressable>
      ) : (
        <View style={styles.notificacoesEspaco} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 17,
    paddingVertical: 11,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
    gap: 11,
  },
  voltar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  voltarEspaco: { width: 34, height: 34 },
  titulos: { flex: 1, gap: 2 },
  titulo: { fontSize: 19, fontWeight: '700', color: colors.white },
  subtitulo: { fontSize: 11, color: colors.textMuted },
  notificacoes: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  notificacoesEspaco: { width: 38, height: 38 },
  ponto: {
    position: 'absolute',
    top: 6,
    right: 7,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
});
