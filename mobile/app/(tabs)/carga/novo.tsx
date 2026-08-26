import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Cabecalho } from '../../../components/Cabecalho';
import { useAuth } from '../../../context/AuthContext';
import { colors } from '../../../constants/theme';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface Empresa {
  id: number;
  nome: string;
}

interface EventoFeira {
  nome: string;
  local: string | null;
  data_inicial: string | null;
  data_final: string | null;
}

function formatarDataBR(iso: string | null): string {
  if (!iso) return '';
  return iso.slice(0, 10).split('-').reverse().join('/');
}

export default function NovoChecklistCarga() {
  const { session } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [eventoFeira, setEventoFeira] = useState('');
  const [eventoSelecionado, setEventoSelecionado] = useState<EventoFeira | null>(null);
  const [resultadosEvento, setResultadosEvento] = useState<EventoFeira[]>([]);
  const [buscandoEvento, setBuscandoEvento] = useState(false);
  const [cliente, setCliente] = useState('');
  const [local, setLocal] = useState('');
  const [periodoInicio, setPeriodoInicio] = useState('');
  const [periodoFim, setPeriodoFim] = useState('');
  const [carregandoEmpresas, setCarregandoEmpresas] = useState(true);
  const [salvando, setSalvando] = useState(false);

  const carregarEmpresas = useCallback(async () => {
    if (!session) return;
    setCarregandoEmpresas(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/checklist-carga/empresas`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const json = await res.json();
      if (json.ok) {
        setEmpresas(json.info);
        if (json.info.length === 1) setEmpresaId(json.info[0].id);
      }
    } catch {
      // sem rede
    }
    setCarregandoEmpresas(false);
  }, [session]);

  useEffect(() => { carregarEmpresas(); }, [carregarEmpresas]);

  // Busca eventos_feiras (mesma tabela sincronizada do PrimeStart que o
  // /admin/estoque/expedicao usa) — escolher um daqui em vez de digitar
  // garante que o nome bate exatamente com o que "Importar Itens das OS's"
  // no desktop procura depois (ilike exato contra fichas_reserva.evento_feira).
  useEffect(() => {
    if (!session || eventoSelecionado) {
      setResultadosEvento([]);
      return;
    }
    const termo = eventoFeira.trim();
    if (termo.length < 2) {
      setResultadosEvento([]);
      return;
    }
    setBuscandoEvento(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`${SITE_URL}/api/portal/checklist-carga/eventos?q=${encodeURIComponent(termo)}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (json.ok) setResultadosEvento(json.info);
      } catch {
        // sem rede — busca de sugestão não é crítica, segue com texto livre
      }
      setBuscandoEvento(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [eventoFeira, eventoSelecionado, session]);

  function alterarEventoTexto(v: string) {
    setEventoFeira(v);
    if (eventoSelecionado) setEventoSelecionado(null);
  }

  function selecionarEvento(ev: EventoFeira) {
    setEventoSelecionado(ev);
    setEventoFeira(ev.nome);
    setResultadosEvento([]);
    if (ev.local) setCliente(prev => prev || ev.local || '');
    if (ev.data_inicial) setPeriodoInicio(ev.data_inicial);
    if (ev.data_final) setPeriodoFim(ev.data_final);
  }

  async function criar() {
    if (!session) return;
    if (!empresaId) {
      Alert.alert('Criar checklist', 'Selecione a empresa.');
      return;
    }
    if (!eventoFeira.trim()) {
      Alert.alert('Criar checklist', 'Informe o evento ou feira.');
      return;
    }
    setSalvando(true);
    try {
      const res = await fetch(`${SITE_URL}/api/portal/checklist-carga/abrir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          empresaId,
          eventoFeira: eventoFeira.trim(),
          cliente: cliente.trim(),
          local: local.trim(),
          periodoInicio: periodoInicio.trim() || null,
          periodoFim: periodoFim.trim() || null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        router.replace({ pathname: '/(tabs)/carga/[id]', params: { id: json.info.id } });
      } else {
        Alert.alert('Criar checklist', json.erro || 'Não foi possível criar agora.');
      }
    } catch {
      Alert.alert('Criar checklist', 'Sem conexão. Tente novamente.');
    }
    setSalvando(false);
  }

  return (
    <View style={styles.screen}>
      <Cabecalho titulo="Novo checklist" subtitulo="Carga" />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={styles.rotulo}>Empresa</Text>
        {carregandoEmpresas ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <View style={styles.chips}>
            {empresas.map(e => (
              <Pressable key={e.id} style={[styles.chip, empresaId === e.id && styles.chipAtivo]} onPress={() => setEmpresaId(e.id)}>
                <Text style={[styles.chipTexto, empresaId === e.id && styles.chipTextoAtivo]}>{e.nome}</Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={{ gap: 6 }}>
          <Text style={styles.rotulo}>Evento / feira</Text>
          <TextInput
            style={styles.input}
            value={eventoFeira}
            onChangeText={alterarEventoTexto}
            placeholder="Busque pelo nome já cadastrado no PrimeStart"
            placeholderTextColor={colors.textMuted}
          />
          {eventoSelecionado ? (
            <Text style={styles.eventoVinculado}>
              Vinculado a {eventoSelecionado.nome}{eventoSelecionado.data_inicial ? ` · ${formatarDataBR(eventoSelecionado.data_inicial)}` : ''} — "Importar das OS's" no sistema web vai encontrar este evento.
            </Text>
          ) : (
            <Text style={styles.nota}>
              Se o evento não aparecer na busca, pode digitar livre — mas depois não vai dar pra importar os itens das OS's pelo sistema web (o nome precisa bater exatamente).
            </Text>
          )}
          {buscandoEvento ? <ActivityIndicator color={colors.accent} style={{ alignSelf: 'flex-start' }} /> : null}
          {resultadosEvento.length > 0 ? (
            <View style={styles.sugestoes}>
              {resultadosEvento.map(ev => (
                <Pressable key={ev.nome} style={styles.sugestaoLinha} onPress={() => selecionarEvento(ev)}>
                  <Text style={styles.sugestaoNome}>{ev.nome}</Text>
                  <Text style={styles.sugestaoMeta}>{ev.local || 'Local não informado'}{ev.data_inicial ? ` · ${formatarDataBR(ev.data_inicial)}` : ''}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        <Campo rotulo="Cliente" valor={cliente} onChangeText={setCliente} placeholder="Nome do cliente" />
        <Campo rotulo="Local" valor={local} onChangeText={setLocal} placeholder="Endereço ou pavilhão" />
        <View style={styles.linhaDupla}>
          <View style={{ flex: 1 }}>
            <Campo rotulo="Início" valor={periodoInicio} onChangeText={setPeriodoInicio} placeholder="AAAA-MM-DD" />
          </View>
          <View style={{ flex: 1 }}>
            <Campo rotulo="Fim" valor={periodoFim} onChangeText={setPeriodoFim} placeholder="AAAA-MM-DD" />
          </View>
        </View>

        <Text style={styles.nota}>Os itens do modelo padrão entram automaticamente. Importar das OS's fica no sistema web.</Text>

        <Pressable style={styles.botao} onPress={criar} disabled={salvando}>
          {salvando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>Criar checklist</Text>}
        </Pressable>
      </ScrollView>
    </View>
  );
}

function Campo({ rotulo, valor, onChangeText, placeholder }: { rotulo: string; valor: string; onChangeText: (v: string) => void; placeholder: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.rotulo}>{rotulo}</Text>
      <TextInput
        style={styles.input}
        value={valor}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 17, gap: 14 },
  rotulo: { fontSize: 11, color: colors.textMuted, textTransform: 'uppercase' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: colors.surfaceBorder },
  chipAtivo: { borderColor: colors.accent, backgroundColor: 'rgba(51,102,153,0.2)' },
  chipTexto: { fontSize: 13, fontWeight: '700', color: colors.textMuted },
  chipTextoAtivo: { color: colors.white },
  input: {
    height: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface,
    color: colors.white, paddingHorizontal: 12, fontSize: 14,
  },
  linhaDupla: { flexDirection: 'row', gap: 10 },
  nota: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  eventoVinculado: { fontSize: 12, color: colors.accent, lineHeight: 17, fontWeight: '600' },
  sugestoes: {
    borderRadius: 8, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: colors.surface, overflow: 'hidden',
  },
  sugestaoLinha: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  sugestaoNome: { fontSize: 13.5, fontWeight: '700', color: colors.white },
  sugestaoMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  botao: { height: 48, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { fontSize: 14, fontWeight: '700', color: colors.white },
});
