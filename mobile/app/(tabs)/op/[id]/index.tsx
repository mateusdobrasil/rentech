import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { Cabecalho } from '../../../../components/Cabecalho';
import { useAuth } from '../../../../context/AuthContext';
import { colors } from '../../../../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface OP {
  id: string;
  numero_op: number;
  responsavel_nome: string;
  natureza_pagamento: string;
  empresa_recebedora: string;
  tipo_pagamento: string;
  chave_pix: string;
  dados_pagamento: string;
  total_geral: number;
  data_vencimento: string;
  status: string;
  file_url: string;
  file_urls?: string[];
  recibo_url?: string;
}

function formatarMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function formatarDataBR(iso: string): string {
  if (!iso) return '';
  return iso.slice(0, 10).split('-').reverse().join('/');
}

export default function DetalheOP() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [op, setOp] = useState<OP | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aprovando, setAprovando] = useState(false);

  const carregar = useCallback(async () => {
    if (!session || !id) return;
    setCarregando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/op/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.ok) setOp(json.info);
    } catch {
      // sem rede
    }
    setCarregando(false);
  }, [session, id]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  async function aprovar() {
    if (!session || !op) return;
    const suportada = (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
    if (suportada) {
      const resultado = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirme pra aprovar o pagamento' });
      if (!resultado.success) return;
    }
    setAprovando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/op/aprovar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ opId: op.id }),
      });
      const json = await res.json();
      if (json.ok) {
        Alert.alert('Pagamento aprovado', 'A OP foi marcada como paga.');
        carregar();
      } else {
        Alert.alert('Aprovar pagamento', json.erro || 'Não foi possível aprovar agora.');
      }
    } catch {
      Alert.alert('Aprovar pagamento', 'Sem conexão. Tente novamente.');
    }
    setAprovando(false);
  }

  function verNoSistema() {
    router.push({ pathname: '/webview', params: { url: '/admin/financeiro/ops', titulo: 'Ordens de pagamento' } });
  }

  if (carregando && !op) {
    return (
      <View style={styles.screen}>
        <Cabecalho titulo="Ordem de pagamento" />
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (!op) {
    return (
      <View style={styles.screen}>
        <Cabecalho titulo="Ordem de pagamento" />
        <View style={styles.vazio}>
          <Text style={styles.vazioTexto}>Não foi possível carregar esta OP.</Text>
        </View>
      </View>
    );
  }

  const anexos = op.file_urls && op.file_urls.length > 0 ? op.file_urls : op.file_url ? [op.file_url] : [];

  return (
    <View style={styles.screen}>
      <Cabecalho titulo={`OP #${op.numero_op}`} subtitulo={op.empresa_recebedora} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.valor}>{formatarMoeda(op.total_geral)}</Text>

        <View style={styles.card}>
          <Campo rotulo="Favorecido" valor={op.empresa_recebedora} />
          <Campo rotulo="Serviço" valor={op.natureza_pagamento} />
          <Campo rotulo="Solicitante" valor={op.responsavel_nome} />
          <Campo rotulo="Forma de pagamento" valor={`${op.tipo_pagamento}${op.chave_pix ? ` · ${op.chave_pix}` : op.dados_pagamento ? ` · ${op.dados_pagamento}` : ''}`} />
          <Campo rotulo="Vencimento" valor={formatarDataBR(op.data_vencimento)} />
          <Campo rotulo="Status" valor={op.status} />
        </View>

        {op.recibo_url ? (
          <Pressable style={styles.anexo} onPress={() => Linking.openURL(op.recibo_url!)}>
            <Text style={styles.anexoTexto}>Ver recibo assinado</Text>
          </Pressable>
        ) : null}

        {anexos.map((url, i) => (
          <Pressable key={url} style={styles.anexo} onPress={() => Linking.openURL(url)}>
            <Text style={styles.anexoTexto}>Ver anexo {anexos.length > 1 ? i + 1 : ''}</Text>
          </Pressable>
        ))}

        <Text style={styles.nota}>Recibo vai para assinatura na Autentique, feito manualmente pelo Financeiro.</Text>

        <Pressable style={styles.botaoSecundario} onPress={verNoSistema}>
          <Text style={styles.botaoSecundarioTexto}>Ver no sistema</Text>
        </Pressable>

        {op.status === 'PENDENTE' ? (
          <Pressable style={styles.botaoAprovar} onPress={aprovar} disabled={aprovando}>
            {aprovando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>Aprovar pagamento</Text>}
          </Pressable>
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
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  vazioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  valor: { fontSize: 28, fontWeight: '700', color: colors.white, textAlign: 'center', marginTop: 6 },
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
  botaoSecundario: {
    height: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center',
  },
  botaoSecundarioTexto: { fontSize: 14, fontWeight: '700', color: colors.textSecondary },
  botaoAprovar: { height: 48, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { fontSize: 14, fontWeight: '700', color: colors.white },
});
