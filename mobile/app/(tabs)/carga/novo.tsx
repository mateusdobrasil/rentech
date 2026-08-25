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

export default function NovoChecklistCarga() {
  const { session } = useAuth();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState<number | null>(null);
  const [eventoFeira, setEventoFeira] = useState('');
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
      <ScrollView contentContainerStyle={styles.container}>
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

        <Campo rotulo="Evento / feira" valor={eventoFeira} onChangeText={setEventoFeira} placeholder="Ex.: Feira XYZ 2026" />
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
  botao: { height: 48, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  botaoTexto: { fontSize: 14, fontWeight: '700', color: colors.white },
});
