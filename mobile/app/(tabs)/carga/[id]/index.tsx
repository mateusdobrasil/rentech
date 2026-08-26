import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { CheckIcon, MinusIcon, PlusIcon } from 'phosphor-react-native';
import { Cabecalho } from '../../../../components/Cabecalho';
import { useAuth } from '../../../../context/AuthContext';
import { colors } from '../../../../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

type Etapa = 'SAIDA' | 'RETORNO';

interface Checklist {
  id: string;
  numero: number;
  evento_feira: string | null;
  local: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  status: 'RASCUNHO' | 'SAIDA_CONFERIDA' | 'FINALIZADO';
}

interface ItemChecklist {
  id: string;
  ordem: number;
  secao: string;
  descricao: string;
  qtd_prevista: string | null;
  saida_ok: boolean;
  saida_qtd: number | null;
  retorno_ok: boolean;
  retorno_qtd: number | null;
}

function qtdNumerica(v: string | null): number {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function formatarDataBR(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10).split('-').reverse().join('/');
}

export default function ConferenciaCarga() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useAuth();
  const [checklist, setChecklist] = useState<Checklist | null>(null);
  const [itens, setItens] = useState<ItemChecklist[]>([]);
  const [etapa, setEtapa] = useState<Etapa>('SAIDA');
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [quantidades, setQuantidades] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    if (!session || !id) return;
    setCarregando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/checklist-carga/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.ok) {
        setChecklist(json.info.checklist);
        setItens(json.info.itens);
        const etapaAtual: Etapa = json.info.checklist.status === 'RASCUNHO' ? 'SAIDA' : 'RETORNO';
        setEtapa(etapaAtual);
      }
    } catch {
      // sem rede
    }
    setCarregando(false);
  }, [session, id]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  useEffect(() => {
    const novosMarcados: Record<string, boolean> = {};
    const novasQuantidades: Record<string, number> = {};
    itens.forEach(item => {
      const ok = etapa === 'SAIDA' ? item.saida_ok : item.retorno_ok;
      const qtd = etapa === 'SAIDA' ? item.saida_qtd : item.retorno_qtd;
      novosMarcados[item.id] = ok;
      novasQuantidades[item.id] = qtd != null ? qtd : qtdNumerica(item.qtd_prevista);
    });
    setMarcados(novosMarcados);
    setQuantidades(novasQuantidades);
  }, [itens, etapa]);

  const secoes = useMemo(() => {
    const mapa = new Map<string, ItemChecklist[]>();
    itens.forEach(item => {
      const chave = item.secao || 'Geral';
      if (!mapa.has(chave)) mapa.set(chave, []);
      mapa.get(chave)!.push(item);
    });
    return Array.from(mapa.entries());
  }, [itens]);

  const divergentes = useMemo(() => {
    return itens.filter(item => {
      if (!marcados[item.id]) return false;
      const previsto = qtdNumerica(item.qtd_prevista);
      const real = quantidades[item.id];
      return item.qtd_prevista != null && real !== previsto;
    }).length;
  }, [itens, marcados, quantidades]);

  const podeEditar = checklist ? (etapa === 'SAIDA' ? checklist.status === 'RASCUNHO' : checklist.status === 'SAIDA_CONFERIDA') : false;
  const retornoHabilitado = checklist ? checklist.status !== 'RASCUNHO' : false;

  function verNoSistema() {
    if (!checklist) return;
    router.push({ pathname: '/webview', params: { url: `/admin/estoque/expedicao?id=${checklist.id}`, titulo: 'Carga' } });
  }

  function alternar(itemId: string) {
    if (!podeEditar) return;
    setMarcados(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  }

  function ajustarQtd(itemId: string, delta: number) {
    if (!podeEditar) return;
    setQuantidades(prev => ({ ...prev, [itemId]: Math.max(0, (prev[itemId] || 0) + delta) }));
  }

  async function salvar() {
    if (!session || !checklist) return;
    setSalvando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/checklist-carga/conferir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          checklistId: checklist.id,
          tipo: etapa,
          itens: itens.map(item => ({ id: item.id, ok: !!marcados[item.id], qtd: marcados[item.id] ? quantidades[item.id] : null })),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        if (etapa === 'RETORNO') {
          Alert.alert('Checklist finalizado', 'O checklist foi finalizado com sucesso.', [
            { text: 'OK', onPress: () => router.replace('/(tabs)/carga') },
          ]);
        } else {
          Alert.alert('Conferência salva', 'Saída conferida.');
          carregar();
        }
      } else {
        Alert.alert('Salvar conferência', json.erro || 'Não foi possível salvar agora.');
      }
    } catch {
      Alert.alert('Salvar conferência', 'Sem conexão. Tente novamente.');
    }
    setSalvando(false);
  }

  if (carregando && !checklist) {
    return (
      <View style={styles.screen}>
        <Cabecalho titulo="Checklist de carga" />
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (!checklist) {
    return (
      <View style={styles.screen}>
        <Cabecalho titulo="Checklist de carga" />
        <View style={styles.vazio}>
          <Text style={styles.vazioTexto}>Não foi possível carregar este checklist.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Cabecalho
        titulo={`CKL-${String(checklist.numero).padStart(6, '0')}`}
        subtitulo={`${checklist.evento_feira || 'Sem evento'} · ${checklist.local || 'Local não informado'}${checklist.periodo_inicio ? ` · ${formatarDataBR(checklist.periodo_inicio)}` : ''}`}
      />

      <View style={styles.chips}>
        <Pressable style={[styles.chip, etapa === 'SAIDA' && styles.chipAtivo]} onPress={() => setEtapa('SAIDA')}>
          <Text style={[styles.chipTexto, etapa === 'SAIDA' && styles.chipTextoAtivo]}>Saída</Text>
        </Pressable>
        <Pressable
          style={[styles.chip, etapa === 'RETORNO' && styles.chipAtivo, !retornoHabilitado && styles.chipDesabilitado]}
          onPress={() => retornoHabilitado && setEtapa('RETORNO')}
          disabled={!retornoHabilitado}
        >
          <Text style={[styles.chipTexto, etapa === 'RETORNO' && styles.chipTextoAtivo]}>Retorno</Text>
        </Pressable>
      </View>

      {divergentes > 0 ? (
        <View style={styles.faixaDivergencia}>
          <Text style={styles.faixaDivergenciaTexto}>{divergentes} {divergentes === 1 ? 'item com quantidade diferente' : 'itens com quantidade diferente'} do previsto.</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.container}>
        <Pressable style={styles.botaoSecundario} onPress={verNoSistema}>
          <Text style={styles.botaoSecundarioTexto}>Ver no sistema</Text>
        </Pressable>
        <Text style={styles.nota}>Importar itens das OS's vinculadas ao evento só dá pra fazer no sistema web — abre este mesmo checklist lá e usa "Importar Itens das OS's".</Text>

        {secoes.map(([secao, itensSecao]) => (
          <View key={secao} style={{ gap: 8 }}>
            <Text style={styles.secaoTitulo}>{secao}</Text>
            {itensSecao.map(item => (
              <View key={item.id} style={styles.linha}>
                <Pressable style={[styles.checkbox, marcados[item.id] && styles.checkboxMarcado]} onPress={() => alternar(item.id)} disabled={!podeEditar}>
                  {marcados[item.id] ? <CheckIcon size={14} color={colors.white} weight="bold" /> : null}
                </Pressable>
                <View style={{ flex: 1 }}>
                  <Text style={styles.descricao}>{item.descricao}</Text>
                  <Text style={styles.previsto}>previsto {item.qtd_prevista ?? '—'}</Text>
                </View>
                <View style={styles.stepper}>
                  <Pressable style={styles.stepperBotao} onPress={() => ajustarQtd(item.id, -1)} disabled={!podeEditar || !marcados[item.id]}>
                    <MinusIcon size={14} color={colors.white} weight="bold" />
                  </Pressable>
                  <Text style={styles.stepperValor}>{quantidades[item.id] ?? 0}</Text>
                  <Pressable style={styles.stepperBotao} onPress={() => ajustarQtd(item.id, 1)} disabled={!podeEditar || !marcados[item.id]}>
                    <PlusIcon size={14} color={colors.white} weight="bold" />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>

      {podeEditar ? (
        <View style={styles.rodape}>
          <Pressable style={styles.botao} onPress={salvar} disabled={salvando}>
            {salvando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>Salvar conferência de {etapa === 'SAIDA' ? 'saída' : 'retorno'}</Text>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  vazioTexto: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  chips: { flexDirection: 'row', gap: 8, padding: 17, paddingBottom: 0 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.surfaceBorder },
  chipAtivo: { borderColor: colors.accent, backgroundColor: 'rgba(51,102,153,0.2)' },
  chipDesabilitado: { opacity: 0.4 },
  chipTexto: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextoAtivo: { color: colors.white },
  faixaDivergencia: {
    marginHorizontal: 17, marginTop: 10, borderRadius: 8, backgroundColor: 'rgba(192,57,43,0.15)',
    borderWidth: 1, borderColor: colors.danger, padding: 10,
  },
  faixaDivergenciaTexto: { fontSize: 12, color: colors.white, fontWeight: '600' },
  container: { padding: 17, gap: 16, paddingBottom: 100 },
  secaoTitulo: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  linha: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 10,
  },
  checkbox: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxMarcado: { backgroundColor: colors.accent, borderColor: colors.accent },
  descricao: { fontSize: 13.5, color: colors.white },
  previsto: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperBotao: {
    width: 34, height: 38, borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.2)',
  },
  stepperValor: { fontSize: 14, fontWeight: '700', color: colors.white, minWidth: 24, textAlign: 'center' },
  rodape: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: 17,
    backgroundColor: colors.background, borderTopWidth: 1, borderTopColor: colors.surfaceBorder,
  },
  botao: { height: 48, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { fontSize: 14, fontWeight: '700', color: colors.white },
  botaoSecundario: {
    height: 44, borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center', justifyContent: 'center',
  },
  botaoSecundarioTexto: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
  nota: { fontSize: 11.5, color: colors.textMuted, lineHeight: 16, marginTop: -6 },
});
