import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { WifiSlashIcon } from 'phosphor-react-native';
import { colors } from '../constants/theme';

interface Props {
  /** Quantos itens estão na fila de sincronização local, se a tela tiver uma. */
  naFila?: number;
}

// Faixa fixa logo abaixo do Cabecalho, só aparece sem rede (README, seção
// "Cabeçalho e navegação"). Detecta a conexão sozinha via NetInfo — a tela
// só passa `naFila` quando tem uma fila de verdade (hoje só Checklist de
// Veículo; Carga/Ponto/OP exigem rede e nunca enfileiram).
export function FaixaOffline({ naFila = 0 }: Props) {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const cancelar = NetInfo.addEventListener(estado => setOnline(!!estado.isConnected));
    return cancelar;
  }, []);

  if (online) return null;

  return (
    <View style={styles.faixa}>
      <WifiSlashIcon size={14} color={colors.textMuted} weight="regular" />
      <Text style={styles.texto}>Sem rede{naFila > 0 ? ` — ${naFila} na fila, sobe quando voltar` : ''}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  faixa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 17,
    paddingVertical: 7,
    backgroundColor: 'rgba(192,57,43,0.12)',
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  texto: { fontSize: 10.5, color: colors.textMuted },
});
