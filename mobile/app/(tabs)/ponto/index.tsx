import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { AcessoRestrito } from '../../../components/AcessoRestrito';
import { useAuth } from '../../../context/AuthContext';
import { colors } from '../../../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface Solicitacao {
  id: number;
  tipo: 'JUSTIFICATIVA_BATIDA' | 'ABONO_DIA' | 'FOLGA_DIA';
  funcionario_nome: string;
  data_referencia: string;
  data_referencia_fim: string | null;
  tipo_batida: string | null;
  horario_solicitado: string | null;
  motivo: string;
  anexo_nome: string | null;
  criado_em: string;
  status?: 'PENDENTE' | 'APROVADA' | 'REJEITADA';
  resolvido_por?: string | null;
  resolvido_em?: string | null;
  motivo_rejeicao?: string | null;
}

const ROTULO_TIPO: Record<string, string> = {
  JUSTIFICATIVA_BATIDA: 'Justificativa',
  ABONO_DIA: 'Abono',
  FOLGA_DIA: 'Folga',
};

function formatarDataBR(iso: string): string {
  return iso.split('-').reverse().join('/');
}

export default function AprovacoesPonto() {
  const { session } = useAuth();
  const [filtro, setFiltro] = useState<'pendentes' | 'resolvidas'>('pendentes');
  const [lista, setLista] = useState<Solicitacao[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (!session) return;
    setCarregando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/aprovacoes-ponto?filtro=${filtro}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.ok) setLista(json.info);
    } catch {
      // sem rede — mantém a última lista carregada
    }
    setCarregando(false);
  }, [session, filtro]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  if (!session) return <AcessoRestrito />;

  function abrir(s: Solicitacao) {
    router.push({
      pathname: '/(tabs)/ponto/[id]',
      params: {
        id: String(s.id),
        tipo: s.tipo,
        funcionario_nome: s.funcionario_nome,
        data_referencia: s.data_referencia,
        data_referencia_fim: s.data_referencia_fim || '',
        tipo_batida: s.tipo_batida || '',
        horario_solicitado: s.horario_solicitado || '',
        motivo: s.motivo,
        anexo_nome: s.anexo_nome || '',
        criado_em: s.criado_em,
        status: s.status || 'PENDENTE',
        resolvido_por: s.resolvido_por || '',
        motivo_rejeicao: s.motivo_rejeicao || '',
      },
    });
  }

  return (
    <View style={styles.screen}>
      <View style={styles.chips}>
        <Pressable style={[styles.chip, filtro === 'pendentes' && styles.chipAtivo]} onPress={() => setFiltro('pendentes')}>
          <Text style={[styles.chipTexto, filtro === 'pendentes' && styles.chipTextoAtivo]}>Pendentes</Text>
        </Pressable>
        <Pressable style={[styles.chip, filtro === 'resolvidas' && styles.chipAtivo]} onPress={() => setFiltro('resolvidas')}>
          <Text style={[styles.chipTexto, filtro === 'resolvidas' && styles.chipTextoAtivo]}>Resolvidas</Text>
        </Pressable>
      </View>

      {carregando && lista.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : lista.length === 0 ? (
        <View style={styles.vazio}>
          <Text style={styles.vazioTexto}>
            {filtro === 'pendentes' ? 'Nada pendente. As próximas chegam por push.' : 'Nenhuma solicitação resolvida ainda.'}
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.container}>
          {lista.map(s => (
            <Pressable key={s.id} style={styles.linha} onPress={() => abrir(s)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.nome}>{s.funcionario_nome}</Text>
                <Text style={styles.resumo} numberOfLines={2}>{s.motivo}</Text>
                <Text style={styles.meta}>
                  {formatarDataBR(s.data_referencia)}
                  {s.data_referencia_fim && s.data_referencia_fim !== s.data_referencia ? ` a ${formatarDataBR(s.data_referencia_fim)}` : ''}
                  {' · WhatsApp · bot de ponto'}
                </Text>
              </View>
              <View style={[styles.tag, s.status === 'REJEITADA' && styles.tagRejeitada, s.status === 'APROVADA' && styles.tagAprovada]}>
                <Text style={styles.tagTexto}>{ROTULO_TIPO[s.tipo] || s.tipo}</Text>
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
  chips: { flexDirection: 'row', gap: 8, padding: 17, paddingBottom: 0 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.surfaceBorder },
  chipAtivo: { borderColor: colors.accent, backgroundColor: 'rgba(51,102,153,0.2)' },
  chipTexto: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextoAtivo: { color: colors.white },
  container: { padding: 17, gap: 10 },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  vazioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  linha: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 14,
  },
  nome: { fontSize: 15, fontWeight: '700', color: colors.white },
  resumo: { fontSize: 12.5, color: colors.textSecondary, marginTop: 2 },
  meta: { fontSize: 11, color: colors.textMuted, marginTop: 6 },
  tag: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: 'rgba(51,102,153,0.25)', borderWidth: 1, borderColor: colors.accent },
  tagAprovada: { backgroundColor: 'rgba(0,0,0,0.2)', borderColor: colors.surfaceBorder },
  tagRejeitada: { backgroundColor: 'rgba(192,57,43,0.15)', borderColor: colors.danger },
  tagTexto: { fontSize: 11, fontWeight: '700', color: colors.white },
});
