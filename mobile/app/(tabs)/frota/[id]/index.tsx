import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import NetInfo from '@react-native-community/netinfo';
import { MapPinIcon, CameraIcon } from 'phosphor-react-native';
import { Cabecalho } from '../../../../components/Cabecalho';
import { AcessoRestrito } from '../../../../components/AcessoRestrito';
import { FaixaOffline } from '../../../../components/FaixaOffline';
import { useAuth } from '../../../../context/AuthContext';
import { colors } from '../../../../constants/theme';
import { capturarGps, type GpsCaptura } from '../../../../lib/gps';
import { capturarFotoAvaria } from '../../../../lib/fotoAvaria';
import { lerItensModeloCache } from '../../../../lib/veiculosCache';
import {
  obter,
  salvarRascunho,
  enfileirar,
  processarFila,
  criarRascunhoRetorno,
  listarPendentes,
  type ChecklistLocal,
  type ChecklistLocalSaida,
  type ChecklistLocalRetorno,
  type ItemMarcado,
  type AvariaLocal,
  type Etapa,
} from '../../../../lib/filaFrota';

const COMBUSTIVEL_CHIPS = ['CHEIO', '3/4', '1/2', '1/4', 'RESERVA'];
const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

export default function ChecklistVeiculoTela() {
  const { session, perfil } = useAuth();
  const { id, etapa: etapaParam } = useLocalSearchParams<{ id: string; etapa?: Etapa }>();
  const etapa: Etapa = etapaParam === 'RETORNO' ? 'RETORNO' : 'SAIDA';

  const [carregando, setCarregando] = useState(true);
  const [registro, setRegistro] = useState<ChecklistLocal | null>(null);
  const [saidaRef, setSaidaRef] = useState<{ veiculoLabel: string; destino: string; kmInicial: number } | null>(null);
  const [salvando, setSalvando] = useState(false);

  // Campos editáveis (espelham o registro, salvos de volta no filaFrota a cada mudança)
  const [kmCampo, setKmCampo] = useState('');
  const [combustivel, setCombustivel] = useState('CHEIO');
  const [destino, setDestino] = useState('');
  const [observacoes, setObservacoes] = useState('');
  const [itens, setItens] = useState<ItemMarcado[]>([]);
  const [avarias, setAvarias] = useState<AvariaLocal[]>([]);
  const [novaAvariaDescricao, setNovaAvariaDescricao] = useState('');
  const [gps, setGps] = useState<GpsCaptura | null>(null);
  const [gpsCarregando, setGpsCarregando] = useState(true);
  const [naFila, setNaFila] = useState(0);

  useEffect(() => {
    listarPendentes().then(p => setNaFila(p.length));
  }, [registro]);

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      setCarregando(true);

      let atual: ChecklistLocal | null = null;
      if (etapa === 'SAIDA') {
        atual = await obter(id);
      } else {
        // Procura um rascunho de RETORNO já existente pra este checklist
        // (local ou já sincronizado); cria um novo se ainda não tiver.
        const registroExistente = await obter(id);
        const saida = registroExistente?.tipo === 'SAIDA' ? (registroExistente as ChecklistLocalSaida) : null;

        // Sem saída local (id é um UUID real do servidor — checklist aberto
        // sincronizado, ex.: app reinstalado ou criado noutro aparelho):
        // busca os dados de exibição na mesma rota que a tela Frota usa.
        let veiculoLabelResolvido = saida?.veiculoLabel || '';
        let destinoResolvido = saida?.destino || '';
        let kmInicialResolvido = saida?.kmInicial || 0;
        if (!saida && session) {
          try {
            const res = await fetch(`${SITE_URL}/api/portal/checklist-veiculo`, { headers: { Authorization: `Bearer ${session.access_token}` } });
            const json = await res.json();
            if (json.ok && json.info.checklistAberto?.id === id) {
              const veiculo = json.info.veiculos.find((v: { id: string }) => v.id === json.info.checklistAberto.veiculo_id);
              veiculoLabelResolvido = veiculo ? `${veiculo.apelido} · ${veiculo.placa}` : '';
              destinoResolvido = json.info.checklistAberto.destino || '';
              kmInicialResolvido = json.info.checklistAberto.km_inicial || 0;
            }
          } catch {
            // sem rede — segue sem esses dados de exibição, não bloqueia o retorno
          }
        }
        setSaidaRef({ veiculoLabel: veiculoLabelResolvido, destino: destinoResolvido, kmInicial: kmInicialResolvido });

        // procura entre os pendentes por um retorno já ligado a este id
        const pendentesRaw = await listarPendentes();
        const retornoExistente = pendentesRaw.find(
          (r): r is ChecklistLocalRetorno => r.tipo === 'RETORNO' && (r.refLocalId === id || r.refChecklistId === id)
        );
        if (retornoExistente) {
          atual = retornoExistente;
        } else {
          const motoristaNome = perfil?.tipo === 'PORTAL' ? (perfil.funcionarioNome ?? perfil.nome) : (perfil?.nome ?? '');
          atual = await criarRascunhoRetorno({
            motoristaNome,
            refLocalId: saida ? id : null,
            refChecklistId: saida ? null : id,
            veiculoLabel: veiculoLabelResolvido,
            kmFinal: 0,
          });
        }
      }

      if (!ativo || !atual) { setCarregando(false); return; }
      setRegistro(atual);

      if (atual.tipo === 'SAIDA') {
        setKmCampo(String(atual.kmInicial));
        setCombustivel(atual.combustivelSaida);
        setDestino(atual.destino);
        setObservacoes(atual.observacoesSaida);
      } else {
        setKmCampo(atual.kmFinal ? String(atual.kmFinal) : '');
        setCombustivel(atual.combustivelRetorno);
        setObservacoes(atual.observacoesRetorno);
      }
      setItens(atual.itens);
      setAvarias(atual.avarias);
      setGps(atual.gps);

      if (atual.itens.length === 0) {
        const modelo = await lerItensModeloCache(etapa);
        setItens(modelo.map(m => ({ descricao: m.descricao, ordem: m.ordem, marcado: false })));
      }

      setCarregando(false);

      // GPS capturado uma vez ao abrir, pra etapa atual — se o registro já
      // tinha (reabertura do mesmo rascunho), não recaptura.
      if (!atual.gps) {
        setGpsCarregando(true);
        const capturado = await capturarGps();
        if (ativo) { setGps(capturado); setGpsCarregando(false); }
      } else {
        setGpsCarregando(false);
      }
    }

    carregar();
    return () => { ativo = false; };
  }, [id, etapa, perfil]);

  // Write-through: qualquer edição já persiste no rascunho local.
  useEffect(() => {
    if (!registro || carregando) return;
    const atualizado: ChecklistLocal = registro.tipo === 'SAIDA'
      ? { ...registro, kmInicial: Number(kmCampo) || 0, combustivelSaida: combustivel, destino, observacoesSaida: observacoes, itens, avarias, gps }
      : { ...registro, kmFinal: Number(kmCampo) || 0, combustivelRetorno: combustivel, observacoesRetorno: observacoes, itens, avarias, gps };
    setRegistro(atualizado);
    salvarRascunho(atualizado);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kmCampo, combustivel, destino, observacoes, itens, avarias, gps]);

  const totalMarcados = useMemo(() => itens.filter(i => i.marcado).length, [itens]);

  if (!session) return <AcessoRestrito />;
  if (carregando || !registro) {
    return (
      <View style={styles.screen}>
        <Cabecalho titulo="Checklist de veículo" />
        <View style={styles.centro}><ActivityIndicator color={colors.accent} /></View>
      </View>
    );
  }

  function alternarItem(ordem: number) {
    setItens(prev => prev.map(i => (i.ordem === ordem ? { ...i, marcado: !i.marcado } : i)));
  }

  async function adicionarAvaria() {
    if (!registro) return;
    const fotoUri = await capturarFotoAvaria(registro.localId);
    setAvarias(prev => [...prev, { descricao: novaAvariaDescricao || 'Sem descrição', fotoUri }]);
    setNovaAvariaDescricao('');
  }

  async function salvar() {
    if (!registro || salvando) return;
    setSalvando(true);
    await enfileirar(registro.localId);
    if (session) await processarFila(session.access_token);
    router.replace({ pathname: '/(tabs)/frota/[id]/salvo', params: { id: registro.localId } });
  }

  const veiculoLabel = registro.veiculoLabel;
  const motoristaLabel = perfil?.tipo === 'PORTAL' ? (perfil.funcionarioNome ?? perfil.nome) : perfil?.nome;

  return (
    <View style={styles.screen}>
      <Cabecalho titulo="Checklist de veículo" subtitulo={veiculoLabel} />
      <FaixaOffline naFila={naFila} />

      <View style={styles.chipsEtapa}>
        <View style={[styles.chipEtapa, etapa === 'SAIDA' && styles.chipEtapaAtivo]}>
          <Text style={[styles.chipEtapaTexto, etapa === 'SAIDA' && styles.chipEtapaTextoAtivo]}>Saída</Text>
        </View>
        <View style={[styles.chipEtapa, etapa === 'RETORNO' && styles.chipEtapaAtivo]}>
          <Text style={[styles.chipEtapaTexto, etapa === 'RETORNO' && styles.chipEtapaTextoAtivo]}>Retorno</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.cartaoGps}>
          <MapPinIcon size={18} color={colors.accent} weight="regular" />
          <View style={{ flex: 1 }}>
            {gpsCarregando ? (
              <Text style={styles.gpsTexto}>Capturando localização...</Text>
            ) : gps ? (
              <>
                <Text style={styles.gpsTexto}>{gps.local || `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`}</Text>
                <Text style={styles.gpsHora}>{gps.lat.toFixed(4)}, {gps.lng.toFixed(4)} · capturado às {new Date(gps.capturadoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>
              </>
            ) : (
              <Text style={styles.gpsTexto}>Localização não disponível — permissão negada</Text>
            )}
          </View>
        </View>

        <View style={styles.camposLado}>
          <View style={styles.campo}>
            <Text style={styles.rotulo}>{etapa === 'SAIDA' ? 'KM inicial' : 'KM final'}</Text>
            <TextInput style={styles.input} keyboardType="number-pad" value={kmCampo} onChangeText={setKmCampo} placeholderTextColor={colors.textSubtle} />
          </View>
          <View style={styles.campo}>
            <Text style={styles.rotulo}>Motorista</Text>
            <View style={[styles.input, styles.inputDesabilitado]}><Text style={styles.inputDesabilitadoTexto} numberOfLines={1}>{motoristaLabel}</Text></View>
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

        {etapa === 'SAIDA' && (
          <View style={styles.campo}>
            <Text style={styles.rotulo}>Destino</Text>
            <TextInput style={styles.input} value={destino} onChangeText={setDestino} placeholderTextColor={colors.textSubtle} />
          </View>
        )}

        <View style={styles.linhaProgresso}>
          <Text style={styles.rotuloSecao}>ITENS · ETAPA {etapa}</Text>
          <Text style={styles.progressoTexto}>{totalMarcados} de {itens.length}</Text>
        </View>
        <View style={styles.barraFundo}>
          <View style={[styles.barraPreenchida, { width: itens.length ? `${(totalMarcados / itens.length) * 100}%` : '0%' }]} />
        </View>
        {itens.length === 0 && <Text style={styles.vazio}>Sem itens em cache — abra a Frota com internet ao menos uma vez.</Text>}
        {itens.map(item => (
          <Pressable key={item.ordem} style={styles.linhaItem} onPress={() => alternarItem(item.ordem)}>
            <View style={[styles.caixa, item.marcado && styles.caixaMarcada]} />
            <Text style={styles.itemTexto}>{item.descricao}</Text>
          </Pressable>
        ))}

        <Text style={styles.rotuloSecao}>AVARIAS</Text>
        {avarias.map((a, i) => (
          <View key={i} style={styles.cartaoAvaria}>
            {a.fotoUri ? <Image source={{ uri: a.fotoUri }} style={styles.avariaFoto} /> : <View style={[styles.avariaFoto, styles.avariaFotoVazia]} />}
            <View style={{ flex: 1 }}>
              <Text style={styles.avariaDescricao}>{a.descricao}</Text>
              <Text style={styles.avariaMeta}>{etapa} · agora</Text>
            </View>
          </View>
        ))}
        <TextInput
          style={styles.input}
          value={novaAvariaDescricao}
          onChangeText={setNovaAvariaDescricao}
          placeholder="Descreva a avaria antes de fotografar"
          placeholderTextColor={colors.textSubtle}
        />
        <Pressable style={styles.botaoAvaria} onPress={adicionarAvaria}>
          <CameraIcon size={18} color={colors.accent} weight="regular" />
          <Text style={styles.botaoAvariaTexto}>Registrar avaria com foto</Text>
        </Pressable>

        <Text style={styles.rotuloSecao}>OBSERVAÇÕES</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={observacoes}
          onChangeText={setObservacoes}
          multiline
          placeholderTextColor={colors.textSubtle}
        />

        <Pressable style={[styles.botaoSalvar, salvando && styles.botaoDesabilitado]} onPress={salvar} disabled={salvando}>
          <Text style={styles.botaoSalvarTexto}>
            {salvando ? 'SALVANDO...' : etapa === 'SAIDA' ? 'SALVAR SAÍDA E LIBERAR VEÍCULO' : 'FINALIZAR CHECKLIST'}
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 17, gap: 12, paddingBottom: 32 },
  chipsEtapa: { flexDirection: 'row', gap: 8, paddingHorizontal: 17, paddingTop: 11 },
  chipEtapa: { flex: 1, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: colors.surfaceBorder, alignItems: 'center' },
  chipEtapaAtivo: { borderColor: colors.accent, backgroundColor: 'rgba(51,102,153,0.2)' },
  chipEtapaTexto: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipEtapaTextoAtivo: { color: colors.white },
  cartaoGps: { flexDirection: 'row', gap: 10, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 14 },
  gpsTexto: { fontSize: 13, color: colors.white, fontWeight: '600' },
  gpsHora: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  camposLado: { flexDirection: 'row', gap: 12 },
  campo: { flex: 1, gap: 6 },
  rotulo: { fontSize: 10, fontWeight: '900', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  rotuloSecao: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  input: { minHeight: 46, borderWidth: 1, borderColor: colors.surfaceBorder, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 12, padding: 12, fontSize: 14, color: colors.white, justifyContent: 'center' },
  inputDesabilitado: { opacity: 0.7 },
  inputDesabilitadoTexto: { fontSize: 14, color: colors.textSecondary },
  textarea: { minHeight: 80, textAlignVertical: 'top' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: colors.surfaceBorder },
  chipAtivo: { borderColor: colors.accent, backgroundColor: 'rgba(51,102,153,0.25)' },
  chipTexto: { fontSize: 12, fontWeight: '700', color: colors.textMuted },
  chipTextoAtivo: { color: colors.white },
  linhaProgresso: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  progressoTexto: { fontSize: 11, color: colors.textMuted },
  barraFundo: { height: 3, borderRadius: 2, backgroundColor: colors.surfaceBorder, overflow: 'hidden' },
  barraPreenchida: { height: 3, backgroundColor: colors.accent },
  vazio: { fontSize: 12, color: colors.textMuted },
  linhaItem: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, paddingHorizontal: 12 },
  caixa: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.surfaceBorder },
  caixaMarcada: { backgroundColor: colors.accent, borderColor: colors.accent },
  itemTexto: { fontSize: 14, color: colors.white, flex: 1 },
  cartaoAvaria: { flexDirection: 'row', gap: 10, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder, padding: 10 },
  avariaFoto: { width: 58, height: 58, borderRadius: 8 },
  avariaFotoVazia: { backgroundColor: 'rgba(0,0,0,0.4)' },
  avariaDescricao: { fontSize: 13.5, color: colors.white },
  avariaMeta: { fontSize: 10.5, color: colors.textMuted, marginTop: 2 },
  botaoAvaria: { minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.accent, borderStyle: 'dashed', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  botaoAvariaTexto: { fontSize: 13, fontWeight: '700', color: colors.accent },
  botaoSalvar: { minHeight: 48, borderRadius: 12, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  botaoDesabilitado: { opacity: 0.5 },
  botaoSalvarTexto: { color: colors.white, fontWeight: '900', fontSize: 13, letterSpacing: 0.5 },
});
