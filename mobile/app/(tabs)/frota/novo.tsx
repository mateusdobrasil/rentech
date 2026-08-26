import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Cabecalho } from '../../../components/Cabecalho';
import { AcessoRestrito } from '../../../components/AcessoRestrito';
import { FaixaOffline } from '../../../components/FaixaOffline';
import { useAuth } from '../../../context/AuthContext';
import { colors } from '../../../constants/theme';
import { lerVeiculosCache, type VeiculoCache } from '../../../lib/veiculosCache';
import { criarRascunhoSaida, listarPendentes } from '../../../lib/filaFrota';

const COMBUSTIVEL_CHIPS = ['CHEIO', '3/4', '1/2', '1/4', 'RESERVA'];

export default function NovoChecklist() {
  const { session, perfil } = useAuth();
  const [veiculos, setVeiculos] = useState<VeiculoCache[]>([]);
  const [veiculoId, setVeiculoId] = useState<string | null>(null);
  const [kmInicial, setKmInicial] = useState('');
  const [combustivel, setCombustivel] = useState('CHEIO');
  const [destino, setDestino] = useState('');
  const [criando, setCriando] = useState(false);
  const [naFila, setNaFila] = useState(0);

  useEffect(() => {
    lerVeiculosCache().then(setVeiculos);
    listarPendentes().then(p => setNaFila(p.length));
  }, []);

  if (!session) return <AcessoRestrito />;

  const veiculoSelecionado = veiculos.find(v => v.id === veiculoId) || null;

  function selecionarVeiculo(v: VeiculoCache) {
    setVeiculoId(v.id);
    if (v.km_atual != null) setKmInicial(String(v.km_atual));
  }

  async function criar() {
    if (!veiculoSelecionado || !kmInicial || criando) return;
    setCriando(true);
    const motoristaNome = perfil?.tipo === 'PORTAL' ? (perfil.funcionarioNome ?? perfil.nome) : (perfil?.nome ?? '');
    // A tela 5 é quem grava de verdade no servidor (evita checklist órfão se
    // o usuário voltar sem terminar de preencher) — aqui só persiste o
    // rascunho local com o que já foi coletado.
    const rascunho = await criarRascunhoSaida({
      motoristaNome,
      veiculoId: veiculoSelecionado.id,
      veiculoLabel: `${veiculoSelecionado.apelido} · ${veiculoSelecionado.placa}`,
      kmInicial: Number(kmInicial),
      combustivelSaida: combustivel,
      destino,
    });
    router.replace({ pathname: '/(tabs)/frota/[id]', params: { id: rascunho.localId, etapa: 'SAIDA' } });
  }

  return (
    <View style={styles.screen}>
      <Cabecalho titulo="Novo checklist" subtitulo="Saída de veículo" />
      <FaixaOffline naFila={naFila} />
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.rotuloSecao}>VEÍCULO</Text>
        <View style={styles.lista}>
          {veiculos.length === 0 ? (
            <Text style={styles.vazio}>Nenhum veículo em cache. Abra a Frota com internet pelo menos uma vez.</Text>
          ) : (
            veiculos.map(v => (
              <Pressable key={v.id} style={styles.linha} onPress={() => selecionarVeiculo(v)}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.linhaTitulo}>{v.apelido}</Text>
                  <Text style={styles.linhaNota}>{v.placa} · {v.tipo}</Text>
                </View>
                <View style={[styles.marca, veiculoId === v.id && styles.marcaAtiva]} />
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.camposLado}>
          <View style={styles.campo}>
            <Text style={styles.rotulo}>KM inicial</Text>
            <TextInput
              style={styles.input}
              keyboardType="number-pad"
              value={kmInicial}
              onChangeText={setKmInicial}
              placeholder="0"
              placeholderTextColor={colors.textSubtle}
            />
          </View>
          <View style={styles.campo}>
            <Text style={styles.rotulo}>Motorista</Text>
            <View style={[styles.input, styles.inputDesabilitado]}>
              <Text style={styles.inputDesabilitadoTexto} numberOfLines={1}>
                {perfil?.tipo === 'PORTAL' ? (perfil.funcionarioNome ?? perfil.nome) : perfil?.nome}
              </Text>
            </View>
          </View>
        </View>

        <Text style={styles.rotuloSecao}>COMBUSTÍVEL</Text>
        <View style={styles.chips}>
          {COMBUSTIVEL_CHIPS.map(c => (
            <Pressable key={c} style={[styles.chip, combustivel === c && styles.chipAtivo]} onPress={() => setCombustivel(c)}>
              <Text style={[styles.chipTexto, combustivel === c && styles.chipTextoAtivo]}>{c}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.campo}>
          <Text style={styles.rotulo}>Destino</Text>
          <TextInput
            style={styles.input}
            value={destino}
            onChangeText={setDestino}
            placeholder="Ex.: Anhembi · Pavilhão 4"
            placeholderTextColor={colors.textSubtle}
          />
        </View>

        <Text style={styles.notaNumeracao}>
          Com rede, o número definitivo (CKL-VEI-######) vem do sistema ao salvar. Sem rede, o checklist
          fica com um número provisório até sincronizar.
        </Text>

        <Pressable
          style={[styles.botao, (!veiculoSelecionado || !kmInicial || criando) && styles.botaoDesabilitado]}
          onPress={criar}
          disabled={!veiculoSelecionado || !kmInicial || criando}
        >
          <Text style={styles.botaoTexto}>CRIAR E COMEÇAR A VISTORIA</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 17, gap: 14 },
  rotuloSecao: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  vazio: { fontSize: 12.5, color: colors.textMuted, padding: 12 },
  lista: { borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, overflow: 'hidden' },
  linha: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
  linhaTitulo: { fontSize: 14, fontWeight: '700', color: colors.white },
  linhaNota: { fontSize: 11, color: colors.textMuted },
  marca: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.surfaceBorder },
  marcaAtiva: { borderColor: colors.accent, backgroundColor: colors.accent },
  camposLado: { flexDirection: 'row', gap: 12 },
  campo: { flex: 1, gap: 6 },
  rotulo: { fontSize: 10, fontWeight: '900', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    color: colors.white,
    justifyContent: 'center',
  },
  inputDesabilitado: { opacity: 0.7 },
  inputDesabilitadoTexto: { fontSize: 14, color: colors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.surfaceBorder },
  chipAtivo: { borderColor: colors.accent, backgroundColor: 'rgba(51,102,153,0.25)' },
  chipTexto: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextoAtivo: { color: colors.white },
  notaNumeracao: { fontSize: 11, color: colors.textSubtle, lineHeight: 16 },
  botao: { minHeight: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  botaoDesabilitado: { opacity: 0.5 },
  botaoTexto: { color: colors.white, fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
});
