import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
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
} from 'phosphor-react-native';
import { useAuth, type PerfilUsuario } from '../../context/AuthContext';
import { colors } from '../../constants/theme';
import { hhmmBatida, mesAtualSaoPaulo } from '../../lib/espelhoPonto';

const WHATSAPP_BOT_NUMERO = process.env.EXPO_PUBLIC_WHATSAPP_BOT_NUMERO;

type Grupo = 'colaborador' | 'frota' | 'rh';

function grupoDoPerfil(perfil: PerfilUsuario | null): Grupo {
  if (!perfil || perfil.tipo === 'PORTAL') return 'colaborador';
  if (perfil.permissaoNormalizada === 'OPERACIONAL') return 'frota';
  if (perfil.permissaoNormalizada === 'ADMINISTRATIVO' || perfil.permissaoNormalizada === 'ADMINISTRADOR') return 'rh';
  // USUARIO genérico e Comercial (sem bucket próprio em normalizarPermissao()
  // ainda) ficam no mesmo conjunto do Colaborador nesta fase.
  return 'colaborador';
}

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

export default function Inicio() {
  const { perfil } = useAuth();
  const grupo = grupoDoPerfil(perfil);
  const [entradaHoje, setEntradaHoje] = useState<string | null>(null);

  // Cartão de ponto: número ao vivo só existe pra contas PORTAL, lendo o
  // cache que a tela Meu Ponto (app/meu-ponto.tsx) já escreve pro mês atual —
  // sem disparar fetch extra daqui. Contas STAFF não têm fonte de dado de
  // ponto ligada ao app nesta fase, então só veem a linha do WhatsApp.
  useEffect(() => {
    if (perfil?.tipo !== 'PORTAL' || !perfil.funcionarioNome) { setEntradaHoje(null); return; }
    const chave = `espelho:${perfil.funcionarioNome}:${mesAtualSaoPaulo()}`;
    AsyncStorage.getItem(chave).then((raw) => {
      if (!raw) return;
      try {
        const cache = JSON.parse(raw);
        const hoje = hojeSaoPauloIso();
        const registroHoje = (cache?.dados?.registros || []).find((r: any) => r.data === hoje);
        if (registroHoje?.entrada_1) setEntradaHoje(hhmmBatida(registroHoje.entrada_1));
      } catch {
        // cache corrompido, ignora
      }
    });
  }, [perfil?.tipo, perfil?.funcionarioNome]);

  const webviewPath = perfil?.tipo === 'PORTAL' ? '/portal' : '/admin';

  const modulos: Modulo[] = (() => {
    if (grupo === 'frota') {
      return [
        {
          key: 'checklist-veiculo',
          icone: <TruckIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Checklist de veículo',
          nota: 'saída e retorno com avaria',
          onPress: () => router.push('/frota'),
        },
        {
          key: 'checklist-carga',
          icone: <PackageIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Checklist de carga',
          nota: 'conferência de equipamento',
          onPress: () => router.push('/carga'),
        },
      ];
    }

    if (grupo === 'rh') {
      return [
        {
          key: 'aprovacoes',
          icone: <CheckSquareIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Aprovações',
          nota: 'ponto, abono, justificativa',
          onPress: () => router.push('/ponto'),
        },
        {
          key: 'op',
          icone: <ReceiptIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Ordens de pagamento',
          nota: 'aprovar e acompanhar',
          onPress: () => router.push('/op'),
        },
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

    // Colaborador: Holerite/Documentos/Meu Ponto são autoatendimento real,
    // que só existe pra contas PORTAL (/portal, com seu próprio login por
    // CPF). Contas STAFF sem cargo especial não têm essa página de
    // autoatendimento no /admin ainda — ver conta plano de implementação.
    if (perfil?.tipo === 'PORTAL') {
      return [
        {
          key: 'holerite',
          icone: <FileTextIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Holerite',
          nota: 'último fechamento e assinatura',
          onPress: () => router.push({ pathname: '/webview', params: { url: webviewPath, titulo: 'Holerite' } }),
        },
        {
          key: 'documentos',
          icone: <FileTextIcon size={21} color={colors.accent} weight="regular" />,
          titulo: 'Documentos',
          nota: 'ASO, ficha, contrato',
          onPress: () => router.push({ pathname: '/webview', params: { url: webviewPath, titulo: 'Documentos' } }),
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

    return [
      {
        key: 'sistema-web',
        icone: <GlobeIcon size={21} color={colors.accent} weight="regular" />,
        titulo: 'Sistema web',
        nota: 'acesse o painel completo',
        onPress: () => router.push({ pathname: '/webview', params: { url: '/admin', titulo: 'Sistema web' } }),
      },
    ];
  })();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.cartaoPonto}>
        <Text style={styles.rotuloSecao}>PONTO DE HOJE</Text>
        {entradaHoje && (
          <View style={styles.entradaLinha}>
            <Text style={styles.entradaNumero}>{entradaHoje}</Text>
            <Text style={styles.entradaRotulo}>entrada registrada</Text>
          </View>
        )}
        {entradaHoje && <View style={styles.divisor} />}
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
  entradaLinha: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
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
});
