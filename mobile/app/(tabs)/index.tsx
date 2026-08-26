import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ClockIcon,
  WhatsappLogoIcon,
  TruckIcon,
  PackageIcon,
  FileTextIcon,
  GlobeIcon,
  CheckSquareIcon,
  ReceiptIcon,
  PenNibIcon,
  CalculatorIcon,
  CaretRightIcon,
} from 'phosphor-react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../constants/theme';
import { hhmmBatida, mesAtualSaoPaulo } from '../../lib/espelhoPonto';
import { calcularModulosAcessiveis, carregarPermissoesRotas, type RotaMobile } from '../../lib/permissoesRotas';

const WHATSAPP_BOT_NUMERO = process.env.EXPO_PUBLIC_WHATSAPP_BOT_NUMERO;
const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

function hojeSaoPauloIso(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

interface Modulo {
  key: string;
  icone: React.ReactNode;
  titulo: string;
  nota: string;
  onPress: () => void;
}

interface Pendencia {
  key: string;
  contagem: number;
  titulo: string;
  nota: string;
  onPress: () => void;
}

// Metadados de exibição dos 4 módulos condicionais (frota/carga/ponto/op) —
// QUEM acessa cada um vem de calcularModulosAcessiveis() (folha_paginas_permissoes),
// nunca mais hardcoded por cargo aqui. Aparecem como card mesmo quando não
// couberam como aba (ver README: "Máximo 5 abas. O que não cabe vira card
// na tela Início.").
const METADADOS_MODULO: Record<RotaMobile, Modulo> = {
  '/mobile/frota': {
    key: 'checklist-veiculo',
    icone: <TruckIcon size={21} color={colors.accent} weight="regular" />,
    titulo: 'Checklist de veículo',
    nota: 'saída e retorno com avaria',
    onPress: () => router.push('/frota'),
  },
  '/mobile/carga': {
    key: 'checklist-carga',
    icone: <PackageIcon size={21} color={colors.accent} weight="regular" />,
    titulo: 'Checklist de carga',
    nota: 'conferência de equipamento',
    onPress: () => router.push('/carga'),
  },
  '/mobile/ponto': {
    key: 'aprovacoes',
    icone: <CheckSquareIcon size={21} color={colors.accent} weight="regular" />,
    titulo: 'Aprovações',
    nota: 'ponto, abono, folga, justificativa',
    onPress: () => router.push('/ponto'),
  },
  '/mobile/op': {
    key: 'op',
    icone: <ReceiptIcon size={21} color={colors.accent} weight="regular" />,
    titulo: 'Ordens de pagamento',
    nota: 'aprovar e acompanhar',
    onPress: () => router.push('/op'),
  },
};

interface PontoHoje {
  entrada: string | null;
  saida: string | null;
}

export default function Inicio() {
  const { perfil, session } = useAuth();
  const [pontoHoje, setPontoHoje] = useState<PontoHoje | null>(null);
  const [permissoesRotas, setPermissoesRotas] = useState<Record<string, string[]>>({});
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);

  // Cartão de ponto: entrada + saída do dia só existe pra contas PORTAL
  // (colaborador comum) — decisão confirmada: Equipe continua só com a linha
  // do WhatsApp, sem tentar casar perfis_usuarios com folha_funcionarios pelo
  // nome (mesmo risco de homonímia já descartado pra Meu Ponto completo).
  // Busca direto (mesma rota que Meu Ponto usa) toda vez que a Início ganha
  // foco — não dá pra só ler o cache que Meu Ponto escreve, porque a batida
  // de hoje pode chegar pelo bot de WhatsApp sem o usuário nunca ter aberto
  // aquela tela nesta sessão. Sem rede, cai pro último cache salvo (por
  // qualquer uma das duas telas, é a mesma chave).
  const carregarPontoHoje = useCallback(async () => {
    if (perfil?.tipo !== 'PORTAL' || !perfil.funcionarioNome) { setPontoHoje(null); return; }
    const mes = mesAtualSaoPaulo();
    const chave = `espelho:${perfil.funcionarioNome}:${mes}`;
    const hoje = hojeSaoPauloIso();

    // "Saída" mostra a última batida de saída do dia, seja ela a saída pro
    // almoço (saida_1, se ainda não voltou) ou a saída final (saida_2) — não
    // trava só em saida_2, senão um dia sem batida de retorno de almoço ainda
    // registrada nunca mostra nada em "saída".
    const extrair = (registroHoje: { entrada_1: string | null; saida_1: string | null; saida_2: string | null } | undefined): PontoHoje | null => {
      if (!registroHoje?.entrada_1) return null;
      const ultimaSaida = registroHoje.saida_2 || registroHoje.saida_1 || null;
      return { entrada: hhmmBatida(registroHoje.entrada_1), saida: ultimaSaida ? hhmmBatida(ultimaSaida) : null };
    };
    // A data do registro pode vir com hora (timestamp) dependendo da coluna —
    // compara só os 10 primeiros caracteres (YYYY-MM-DD) dos dois lados.
    const ehHoje = (r: { data: string }) => String(r.data).slice(0, 10) === hoje;

    if (session && SITE_URL) {
      try {
        const res = await fetch(`${SITE_URL}/api/portal/espelho-ponto?mes=${mes}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = await res.json();
        if (json.ok) {
          const registroHoje = (json.info?.registros || []).find(ehHoje);
          setPontoHoje(extrair(registroHoje));
          await AsyncStorage.setItem(chave, JSON.stringify({ dados: json.info, atualizadoEm: new Date().toISOString() }));
          return;
        }
      } catch {
        // sem rede ou falha na API — cai pro cache abaixo
      }
    }

    const raw = await AsyncStorage.getItem(chave);
    if (!raw) return;
    try {
      const cache = JSON.parse(raw);
      const registroHoje = (cache?.dados?.registros || []).find(ehHoje);
      setPontoHoje(extrair(registroHoje));
    } catch {
      // cache corrompido, ignora
    }
  }, [perfil?.tipo, perfil?.funcionarioNome, session]);

  useFocusEffect(useCallback(() => { carregarPontoHoje(); }, [carregarPontoHoje]));

  useEffect(() => {
    if (perfil?.tipo !== 'STAFF') return;
    carregarPermissoesRotas().then(setPermissoesRotas);
  }, [perfil?.tipo, perfil?.permissaoNormalizada]);

  const modulosAcesso = useMemo(
    () => (perfil ? calcularModulosAcessiveis(permissoesRotas, perfil.permissaoNormalizada, perfil.podeDirigir) : []),
    [permissoesRotas, perfil?.permissaoNormalizada, perfil?.podeDirigir]
  );
  const temPontoOuOp = modulosAcesso.some(m => m.rota === '/mobile/ponto' || m.rota === '/mobile/op');

  // "Precisa de você" — só busca contagem dos módulos que o usuário
  // realmente acessa (nunca chama uma rota que ele não tem permissão de
  // ver). Some do bloco inteiro quando não há nada pendente.
  const carregarPendencias = useCallback(async () => {
    if (!session) { setPendencias([]); return; }
    const tarefas: Promise<Pendencia | null>[] = [];

    if (modulosAcesso.some(m => m.rota === '/mobile/ponto')) {
      tarefas.push((async () => {
        try {
          const res = await fetch(`${SITE_URL}/api/portal/aprovacoes-ponto?filtro=pendentes`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const json = await res.json();
          const n = json.ok ? json.info.length : 0;
          if (n === 0) return null;
          return { key: 'pend-ponto', contagem: n, titulo: 'Aprovações de ponto', nota: 'aguardando decisão', onPress: () => router.push('/ponto') };
        } catch { return null; }
      })());
    }

    if (modulosAcesso.some(m => m.rota === '/mobile/op')) {
      tarefas.push((async () => {
        try {
          const res = await fetch(`${SITE_URL}/api/portal/op`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const json = await res.json();
          const n = json.ok ? json.info.filter((op: { status: string }) => !op.status.includes('PAGO')).length : 0;
          if (n === 0) return null;
          return { key: 'pend-op', contagem: n, titulo: 'Ordens de pagamento', nota: 'em aberto', onPress: () => router.push('/op') };
        } catch { return null; }
      })());
    }

    if (modulosAcesso.some(m => m.rota === '/mobile/carga')) {
      tarefas.push((async () => {
        try {
          const res = await fetch(`${SITE_URL}/api/portal/checklist-carga`, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          const json = await res.json();
          const n = json.ok ? json.info.filter((c: { divergencias: number }) => c.divergencias > 0).length : 0;
          if (n === 0) return null;
          return { key: 'pend-carga', contagem: n, titulo: 'Checklists de carga', nota: 'com divergência', onPress: () => router.push('/carga') };
        } catch { return null; }
      })());
    }

    const resultados = await Promise.all(tarefas);
    setPendencias(resultados.filter((p): p is Pendencia => p !== null));
  }, [session, modulosAcesso]);

  useFocusEffect(useCallback(() => { carregarPendencias(); }, [carregarPendencias]));

  const modulosDinamicos: Modulo[] = modulosAcesso.map(m => METADADOS_MODULO[m.rota]);

  const modulosExtras: Modulo[] = (() => {
    if (perfil?.tipo === 'PORTAL') {
      return [
        {
          key: 'holerite',
          icone: <FileTextIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Holerite',
          nota: 'último fechamento e assinatura',
          onPress: () => router.push({ pathname: '/webview', params: { url: '/portal?aba=holerites', titulo: 'Holerite' } }),
        },
        {
          key: 'documentos',
          icone: <FileTextIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Documentos',
          nota: 'ASO, ficha, contrato',
          onPress: () => router.push({ pathname: '/webview', params: { url: '/portal?aba=documentos', titulo: 'Documentos' } }),
        },
        {
          key: 'meu-ponto',
          icone: <ClockIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Meu ponto',
          nota: 'espelho do mês, funciona offline',
          onPress: () => router.push('/meu-ponto'),
        },
      ];
    }
    // Assinaturas/Folha não são rotas /mobile/... controladas por
    // folha_paginas_permissoes — são um atalho editorial pra quem já
    // acessa Ponto ou OP (mesmo público de RH/Financeiro/Diretoria). A
    // página web de destino se autovalida de qualquer forma.
    if (temPontoOuOp) {
      return [
        {
          key: 'assinaturas',
          icone: <PenNibIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Assinaturas',
          nota: 'Autentique, status ao vivo',
          onPress: () => router.push({ pathname: '/webview', params: { url: '/admin/rh/assinaturas', titulo: 'Assinaturas' } }),
        },
        {
          key: 'folha',
          icone: <CalculatorIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Folha',
          nota: 'fechamento no sistema web',
          onPress: () => router.push({ pathname: '/webview', params: { url: '/admin/rh/holerite', titulo: 'Folha' } }),
        },
      ];
    }
    return [];
  })();

  const modulosCombinados = [...modulosDinamicos, ...modulosExtras];
  // Fallback: STAFF sem nenhum módulo condicional e sem bucket de RH
  // (USUARIO genérico, Comercial) — só o link pro sistema web completo.
  const modulos: Modulo[] = modulosCombinados.length > 0 || perfil?.tipo === 'PORTAL'
    ? modulosCombinados
    : [{
        key: 'sistema-web',
        icone: <GlobeIcon size={21} color={colors.accent} weight="regular" />,
        titulo: 'Sistema web',
        nota: 'acesse o painel completo',
        onPress: () => router.push({ pathname: '/webview', params: { url: '/admin', titulo: 'Sistema web' } }),
      }];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      {perfil?.tipo === 'PORTAL' && (
        <View style={styles.cartaoPonto}>
          <Text style={styles.rotuloSecao}>PONTO DE HOJE</Text>
          {pontoHoje && (
            <View style={styles.entradaLinha}>
              <View style={styles.entradaBloco}>
                <Text style={styles.entradaNumero}>{pontoHoje.entrada}</Text>
                <Text style={styles.entradaRotulo}>entrada</Text>
              </View>
              <View style={styles.entradaBloco}>
                <Text style={styles.entradaNumero}>{pontoHoje.saida ?? '--:--'}</Text>
                <Text style={styles.entradaRotulo}>saída</Text>
              </View>
            </View>
          )}
          {pontoHoje && <View style={styles.divisor} />}
          <View style={styles.whatsappLinha}>
            <WhatsappLogoIcon size={18} color={colors.accent} weight="regular" />
            <Text style={styles.whatsappTexto}>Batida e justificativa seguem pelo bot no WhatsApp</Text>
            {WHATSAPP_BOT_NUMERO && (
              <Pressable onPress={() => Linking.openURL(`https://wa.me/${WHATSAPP_BOT_NUMERO}`)}>
                <Text style={styles.abrirLink}>Abrir</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      <Text style={styles.rotuloSecao}>SEUS MÓDULOS</Text>
      <View style={styles.grid}>
        {modulos.map((m) => (
          <Pressable key={m.key} style={styles.moduloCard} onPress={m.onPress}>
            {m.icone}
            <Text style={styles.moduloTitulo}>{m.titulo}</Text>
            <Text style={styles.moduloNota}>{m.nota}</Text>
          </Pressable>
        ))}
      </View>

      {pendencias.length > 0 && (
        <>
          <Text style={styles.rotuloSecao}>PRECISA DE VOCÊ</Text>
          <View style={styles.listaPendencias}>
            {pendencias.map((p) => (
              <Pressable key={p.key} style={styles.linhaPendencia} onPress={p.onPress}>
                <View style={styles.tagContagem}>
                  <Text style={styles.tagContagemTexto}>{p.contagem}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendenciaTitulo}>{p.titulo}</Text>
                  <Text style={styles.pendenciaNota}>{p.nota}</Text>
                </View>
                <CaretRightIcon size={16} color={colors.textMuted} weight="regular" />
              </Pressable>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 17, gap: 17 },
  rotuloSecao: { fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  cartaoPonto: {
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: 17,
    gap: 11,
  },
  entradaLinha: { flexDirection: 'row', gap: 22 },
  entradaBloco: { gap: 2 },
  entradaNumero: { fontSize: 34, fontWeight: '700', color: colors.white },
  entradaRotulo: { fontSize: 12.5, color: colors.textSecondary },
  divisor: { height: 1, backgroundColor: colors.surfaceBorder },
  whatsappLinha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  whatsappTexto: { flex: 1, fontSize: 12.5, color: colors.textSecondary },
  abrirLink: { fontSize: 13, fontWeight: '700', color: colors.accent },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11 },
  moduloCard: {
    width: '47%',
    minHeight: 96,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: 14,
    gap: 6,
    justifyContent: 'center',
  },
  moduloTitulo: { fontSize: 14, fontWeight: '700', color: colors.white },
  moduloNota: { fontSize: 11, color: colors.textMuted },
  listaPendencias: {
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    overflow: 'hidden',
  },
  linhaPendencia: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  tagContagem: {
    minWidth: 26,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagContagemTexto: { fontSize: 11, fontWeight: '800', color: colors.white },
  pendenciaTitulo: { fontSize: 14, fontWeight: '700', color: colors.white },
  pendenciaNota: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
});
