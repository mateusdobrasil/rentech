import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CheckCircleIcon } from 'phosphor-react-native';
import { colors } from '../../../../constants/theme';
import { obter, type ChecklistLocal } from '../../../../lib/filaFrota';

export default function ChecklistSalvo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [registro, setRegistro] = useState<ChecklistLocal | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    obter(id).then(r => { setRegistro(r); setCarregando(false); });
  }, [id]);

  if (carregando || !registro) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const sincronizado = registro.status === 'SINCRONIZADO';
  const numero = registro.tipo === 'SAIDA' ? (sincronizado ? `CKL-VEI-${String(registro.numeroRemoto).padStart(6, '0')}` : registro.numeroLocal) : null;
  const veiculo = registro.veiculoLabel || '—';

  let titulo: string;
  let explicacao: string;
  let statusExibicao: string;

  if (!sincronizado) {
    titulo = 'Guardado no aparelho';
    explicacao = 'Fica na fila e sobe sozinha quando o sinal voltar. Você pode seguir para o próximo veículo.';
    statusExibicao = registro.status === 'ERRO' ? 'Erro — tentando de novo' : 'Na fila';
  } else if (registro.tipo === 'SAIDA') {
    titulo = 'Saída registrada';
    explicacao = 'Status EM_ANDAMENTO no sistema web. O retorno reabre este mesmo checklist para a etapa RETORNO.';
    statusExibicao = 'EM_ANDAMENTO';
  } else {
    titulo = 'Checklist finalizado';
    explicacao = 'Status FINALIZADO. KM do veículo atualizado e as avarias ficam na ficha, com foto no storage.';
    statusExibicao = 'FINALIZADO';
  }

  return (
    <View style={styles.screen}>
      <View style={styles.icone}>
        <CheckCircleIcon size={46} color={colors.accent} weight="regular" />
      </View>
      <Text style={styles.titulo}>{titulo}</Text>
      <Text style={styles.explicacao}>{explicacao}</Text>

      <View style={styles.cartao}>
        {numero && (
          <View style={styles.linha}><Text style={styles.linhaRotulo}>Checklist</Text><Text style={styles.linhaValor}>{numero}</Text></View>
        )}
        <View style={styles.linha}><Text style={styles.linhaRotulo}>Veículo</Text><Text style={styles.linhaValor}>{veiculo}</Text></View>
        <View style={styles.linha}><Text style={styles.linhaRotulo}>Status</Text><Text style={styles.linhaValor}>{statusExibicao}</Text></View>
        <View style={styles.linha}><Text style={styles.linhaRotulo}>Avarias</Text><Text style={styles.linhaValor}>{registro.avarias.length}</Text></View>
      </View>

      <Pressable style={styles.botao} onPress={() => router.replace('/(tabs)/frota')}>
        <Text style={styles.botaoTexto}>Voltar para a frota</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 28, gap: 8 },
  icone: { marginBottom: 12 },
  titulo: { fontSize: 19, fontWeight: '800', color: colors.white, textAlign: 'center' },
  explicacao: { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 19, marginTop: 6, marginBottom: 20 },
  cartao: { width: '100%', borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 16, gap: 10, marginBottom: 24 },
  linha: { flexDirection: 'row', justifyContent: 'space-between' },
  linhaRotulo: { fontSize: 12, color: colors.textMuted },
  linhaValor: { fontSize: 13, fontWeight: '700', color: colors.white },
  botao: { minHeight: 48, minWidth: '100%', borderRadius: 12, borderWidth: 1, borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { color: colors.accent, fontWeight: '700', fontSize: 13 },
});
