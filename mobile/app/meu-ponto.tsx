import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { CaretLeftIcon, CaretRightIcon } from 'phosphor-react-native';
import { Cabecalho } from '../components/Cabecalho';
import { useAuth } from '../context/AuthContext';
import { colors } from '../constants/theme';
import {
  DIAS_SEMANA,
  calcularTotais,
  diasSeguintesBatidas,
  hhmm,
  hhmmBatida,
  mesAtualSaoPaulo,
  montarLinhas,
  type RegistroDia,
} from '../lib/espelhoPonto';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

interface EspelhoDoMes {
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  registros: RegistroDia[];
  feriados: string[];
}

function chaveCache(funcionarioNome: string, mes: string) {
  return `espelho:${funcionarioNome}:${mes}`;
}

function mesAnterior(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(ano, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function mesSeguinte(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  const d = new Date(ano, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function rotuloMes(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(ano, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function horaCurta(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function MeuPonto() {
  const { session, perfil } = useAuth();
  const mesAtual = mesAtualSaoPaulo();
  const [mes, setMes] = useState(mesAtual);
  const [dados, setDados] = useState<EspelhoDoMes | null>(null);
  const [fonte, setFonte] = useState<'rede' | 'cache' | null>(null);
  const [atualizadoEm, setAtualizadoEm] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const funcionarioNome = perfil?.funcionarioNome;

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      setCarregando(true);
      setDados(null);
      setFonte(null);
      setAtualizadoEm(null);

      if (!funcionarioNome) { setCarregando(false); return; }

      const chave = chaveCache(funcionarioNome, mes);
      const cacheRaw = await AsyncStorage.getItem(chave);
      if (cacheRaw && ativo) {
        try {
          const cache = JSON.parse(cacheRaw);
          setDados(cache.dados);
          setAtualizadoEm(cache.atualizadoEm);
          setFonte('cache');
        } catch {
          // cache corrompido, ignora
        }
      }

      const estadoRede = await NetInfo.fetch();
      if (!estadoRede.isConnected || !SITE_URL || !session) {
        if (ativo) setCarregando(false);
        return;
      }

      try {
        const res = await fetch(`${SITE_URL}/api/portal/espelho-ponto?mes=${mes}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (ativo && json.ok) {
          setDados(json.info);
          const agora = new Date().toISOString();
          setAtualizadoEm(agora);
          setFonte('rede');
          await AsyncStorage.setItem(chave, JSON.stringify({ dados: json.info, atualizadoEm: agora }));
        }
      } catch {
        // sem rede de fato ou falha na API — fica com o que já tinha de cache
      } finally {
        if (ativo) setCarregando(false);
      }
    }

    carregar();
    return () => { ativo = false; };
  }, [mes, funcionarioNome, session]);

  const linhas = useMemo(() => {
    if (!dados) return [];
    return montarLinhas(dados.registros, dados.feriados, dados.dataAdmissao, dados.dataDesligamento, mes);
  }, [dados, mes]);

  const totais = useMemo(() => calcularTotais(linhas), [linhas]);

  if (perfil && perfil.tipo !== 'PORTAL') {
    return (
      <View style={styles.screen}>
        <Cabecalho titulo="Meu Ponto" />
        <View style={styles.centro}>
          <Text style={styles.erroTexto}>Meu Ponto está disponível pra contas do Portal do Funcionário.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <Cabecalho titulo="Meu Ponto" subtitulo="Espelho do mês" />

      <View style={styles.seletorMes}>
        <Pressable style={styles.seletorBotao} onPress={() => setMes(mesAnterior(mes))} hitSlop={8}>
          <CaretLeftIcon size={16} color={colors.white} weight="bold" />
        </Pressable>
        <Text style={styles.seletorTexto}>{rotuloMes(mes)}</Text>
        <Pressable
          style={[styles.seletorBotao, mes >= mesAtual && styles.seletorBotaoDesabilitado]}
          onPress={() => mes < mesAtual && setMes(mesSeguinte(mes))}
          disabled={mes >= mesAtual}
          hitSlop={8}
        >
          <CaretRightIcon size={16} color={mes >= mesAtual ? colors.textSubtle : colors.white} weight="bold" />
        </Pressable>
      </View>

      {fonte === 'cache' && atualizadoEm && (
        <View style={styles.banner}>
          <Text style={styles.bannerTexto}>Dados de {horaCurta(atualizadoEm)} — sem rede pra atualizar.</Text>
        </View>
      )}

      {carregando && !dados ? (
        <View style={styles.centro}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : !dados ? (
        <View style={styles.centro}>
          <Text style={styles.erroTexto}>Sem dados guardados pra este mês. Conecte à internet pra carregar.</Text>
        </View>
      ) : (
        <>
          <ScrollView style={styles.lista} contentContainerStyle={styles.listaConteudo}>
            {linhas.map((l) => {
              const diasL = diasSeguintesBatidas(
                l.reg?.entrada_1 || null,
                l.reg?.saida_1 || null,
                l.reg?.entrada_2 || null,
                l.reg?.saida_2 || null
              );
              const batidas = [l.reg?.entrada_1 || null, l.reg?.saida_1 || null, l.reg?.entrada_2 || null, l.reg?.saida_2 || null];
              return (
                <View key={l.dataIso} style={styles.cartaoDia}>
                  <View style={styles.cartaoTopo}>
                    <Text style={styles.cartaoData}>
                      {l.dataIso.split('-').reverse().slice(0, 2).join('/')} · {DIAS_SEMANA[l.diaSemana]}
                    </Text>
                    <Text style={styles.cartaoTotal}>{l.reg?.minutosTrabalhados ? hhmm(l.reg.minutosTrabalhados) : '-'}</Text>
                  </View>
                  <View style={styles.batidasLinha}>
                    {batidas.map((v, i) => (
                      <View key={i} style={styles.batidaBox}>
                        <Text style={styles.batidaTexto}>{hhmmBatida(v)}</Text>
                        {diasL[i] && <Text style={styles.diaSeguinte}>dia seguinte</Text>}
                      </View>
                    ))}
                  </View>
                  {l.observacao ? (
                    <Text style={[styles.observacao, l.alerta && styles.observacaoAlerta]}>{l.observacao}</Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          <View style={styles.rodapeFixo}>
            <Text style={styles.rodapeItem}>Trabalhado <Text style={styles.rodapeValor}>{hhmm(totais.trabalhado)}</Text></Text>
            <Text style={styles.rodapeItem}>Abonado <Text style={styles.rodapeValor}>{hhmm(totais.abonado)}</Text></Text>
            <Text style={[styles.rodapeItem, totais.faltas > 0 && styles.rodapeFaltas]}>Faltas <Text style={[styles.rodapeValor, totais.faltas > 0 && styles.rodapeFaltas]}>{totais.faltas}</Text></Text>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  erroTexto: { textAlign: 'center', color: colors.textMuted, fontSize: 13 },
  seletorMes: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 17,
    paddingVertical: 11,
  },
  seletorBotao: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  seletorBotaoDesabilitado: { opacity: 0.4 },
  seletorTexto: { fontSize: 14, fontWeight: '700', color: colors.white, textTransform: 'capitalize' },
  banner: { paddingHorizontal: 17, paddingVertical: 8, backgroundColor: colors.surface },
  bannerTexto: { fontSize: 11, color: colors.textMuted },
  lista: { flex: 1 },
  listaConteudo: { padding: 17, gap: 8 },
  cartaoDia: {
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: 12,
    gap: 8,
  },
  cartaoTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cartaoData: { fontSize: 13, fontWeight: '700', color: colors.white },
  cartaoTotal: { fontSize: 13, fontWeight: '700', color: colors.white },
  batidasLinha: { flexDirection: 'row', gap: 6 },
  batidaBox: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingVertical: 6,
    alignItems: 'center',
  },
  batidaTexto: { fontSize: 11, fontWeight: '700', color: colors.white },
  diaSeguinte: { fontSize: 8, fontWeight: '800', color: '#c99a2e', textTransform: 'uppercase', marginTop: 2 },
  observacao: { fontSize: 10.5, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  observacaoAlerta: { color: colors.danger },
  rodapeFixo: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 12,
    paddingHorizontal: 17,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.surfaceBorder,
  },
  rodapeItem: { fontSize: 12, fontWeight: '700', color: colors.white },
  rodapeValor: { color: colors.accent },
  rodapeFaltas: { color: colors.danger },
});
