import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Cabecalho } from '../../../../components/Cabecalho';
import { useAuth } from '../../../../context/AuthContext';
import { colors } from '../../../../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

const ROTULO_TIPO: Record<string, string> = {
  JUSTIFICATIVA_BATIDA: 'Justificativa de batida',
  ABONO_DIA: 'Abono de dia',
  FOLGA_DIA: 'Folga',
};

function formatarDataBR(iso: string): string {
  return iso.split('-').reverse().join('/');
}

function formatarDataHoraBR(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function DetalheAprovacaoPonto() {
  const params = useLocalSearchParams<{
    id: string; tipo: string; funcionario_nome: string; data_referencia: string; data_referencia_fim: string;
    tipo_batida: string; horario_solicitado: string; motivo: string; anexo_nome: string; criado_em: string;
    status: string; resolvido_por: string; motivo_rejeicao: string;
  }>();
  const { session } = useAuth();
  const [processando, setProcessando] = useState(false);
  const [mostrarRejeicao, setMostrarRejeicao] = useState(false);
  const [motivoRejeicao, setMotivoRejeicao] = useState('');
  const [buscandoAnexo, setBuscandoAnexo] = useState(false);

  const pendente = params.status === 'PENDENTE' || !params.status;

  async function abrirAnexo() {
    if (!session) return;
    setBuscandoAnexo(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/aprovacoes-ponto/anexo?id=${params.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.ok && json.info) {
        Linking.openURL(json.info);
      } else {
        Alert.alert('Anexo', json.erro || 'Não foi possível abrir o anexo.');
      }
    } catch {
      Alert.alert('Anexo', 'Sem conexão para abrir o anexo agora.');
    }
    setBuscandoAnexo(false);
  }

  async function aprovar() {
    if (!session) return;
    setProcessando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/aprovacoes-ponto/aprovar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: params.id }),
      });
      const json = await res.json();
      if (json.ok) {
        router.back();
      } else {
        Alert.alert('Aprovar', json.erro || 'Não foi possível aprovar agora.');
      }
    } catch {
      Alert.alert('Aprovar', 'Sem conexão. Tente novamente.');
    }
    setProcessando(false);
  }

  async function rejeitar() {
    if (!session) return;
    if (!motivoRejeicao.trim()) {
      Alert.alert('Rejeitar', 'Descreva o motivo da rejeição.');
      return;
    }
    setProcessando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/aprovacoes-ponto/rejeitar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ id: params.id, motivoRejeicao: motivoRejeicao.trim() }),
      });
      const json = await res.json();
      if (json.ok) {
        router.back();
      } else {
        Alert.alert('Rejeitar', json.erro || 'Não foi possível rejeitar agora.');
      }
    } catch {
      Alert.alert('Rejeitar', 'Sem conexão. Tente novamente.');
    }
    setProcessando(false);
  }

  return (
    <View style={styles.screen}>
      <Cabecalho titulo={params.funcionario_nome} subtitulo={ROTULO_TIPO[params.tipo] || params.tipo} />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.card}>
          <Campo rotulo="Pedido" valor={ROTULO_TIPO[params.tipo] || params.tipo} />
          <Campo
            rotulo="Data"
            valor={
              formatarDataBR(params.data_referencia) +
              (params.data_referencia_fim && params.data_referencia_fim !== params.data_referencia
                ? ` a ${formatarDataBR(params.data_referencia_fim)}`
                : '')
            }
          />
          {params.tipo_batida ? <Campo rotulo="Batida" valor={`${params.tipo_batida}${params.horario_solicitado ? ` · ${params.horario_solicitado}` : ''}`} /> : null}
          <Campo rotulo="Texto" valor={params.motivo} />
          <Campo rotulo="Recebido" valor={formatarDataHoraBR(params.criado_em)} />
          {!pendente && params.status === 'REJEITADA' && params.motivo_rejeicao ? (
            <Campo rotulo="Motivo da rejeição" valor={params.motivo_rejeicao} />
          ) : null}
          {!pendente && params.resolvido_por ? <Campo rotulo="Resolvido por" valor={params.resolvido_por} /> : null}
        </View>

        {params.anexo_nome ? (
          <Pressable style={styles.anexo} onPress={abrirAnexo} disabled={buscandoAnexo}>
            {buscandoAnexo ? <ActivityIndicator color={colors.accent} /> : <Text style={styles.anexoTexto}>Ver anexo · {params.anexo_nome}</Text>}
          </Pressable>
        ) : null}

        <Text style={styles.nota}>
          Aprovar grava no livro-razão de ponto e avisa o colaborador pelo WhatsApp. Nada é aprovado automaticamente.
        </Text>

        {pendente ? (
          <>
            {mostrarRejeicao ? (
              <View style={styles.rejeicaoBox}>
                <TextInput
                  style={styles.input}
                  placeholder="Motivo da rejeição"
                  placeholderTextColor={colors.textMuted}
                  value={motivoRejeicao}
                  onChangeText={setMotivoRejeicao}
                  multiline
                />
                <View style={styles.botoes}>
                  <Pressable style={styles.botaoSecundario} onPress={() => setMostrarRejeicao(false)} disabled={processando}>
                    <Text style={styles.botaoSecundarioTexto}>Cancelar</Text>
                  </Pressable>
                  <Pressable style={styles.botaoRejeitar} onPress={rejeitar} disabled={processando}>
                    {processando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>Confirmar rejeição</Text>}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.botoes}>
                <Pressable style={styles.botaoSecundario} onPress={() => setMostrarRejeicao(true)} disabled={processando}>
                  <Text style={styles.botaoSecundarioTexto}>Rejeitar</Text>
                </Pressable>
                <Pressable style={styles.botaoAprovar} onPress={aprovar} disabled={processando}>
                  {processando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>Aprovar</Text>}
                </Pressable>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={styles.campo}>
      <Text style={styles.campoRotulo}>{rotulo}</Text>
      <Text style={styles.campoValor}>{valor}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 17, gap: 14 },
  card: {
    borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 14, gap: 12,
  },
  campo: { gap: 2 },
  campoRotulo: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' },
  campoValor: { fontSize: 14, color: colors.white },
  anexo: {
    borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder, paddingVertical: 12, alignItems: 'center',
  },
  anexoTexto: { fontSize: 13, color: colors.accent, fontWeight: '600' },
  nota: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  rejeicaoBox: { gap: 10 },
  input: {
    borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
    color: colors.white, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: 'top',
  },
  botoes: { flexDirection: 'row', gap: 10 },
  botaoSecundario: {
    flex: 1, height: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center',
  },
  botaoSecundarioTexto: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  botaoAprovar: { flex: 1, height: 48, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  botaoRejeitar: { flex: 1, height: 48, borderRadius: 8, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { fontSize: 14, fontWeight: '700', color: colors.white },
});
