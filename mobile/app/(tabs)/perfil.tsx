import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import {
  FingerprintIcon,
  BellIcon,
  GlobeIcon,
  CloudArrowDownIcon,
  LifebuoyIcon,
  CaretRightIcon,
  SignOutIcon,
} from 'phosphor-react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../constants/theme';
import { carregarPermissoesRotas } from '../../lib/permissoesRotas';
import { baixarParaOffline } from '../../lib/baixarOffline';

const SUPORTE_EMAIL = 'contato@locadorarentech.com.br';
const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return '?';
  if (partes.length === 1) return partes[0][0].toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export default function Perfil() {
  const {
    loading, session, perfil, signOut,
    biometriaSuportada, biometriaAtivada, ativarBiometria, desativarBiometria,
    notificacoesAtivadas, ativarNotificacoes, desativarNotificacoes,
  } = useAuth();
  const [alternandoNotificacoes, setAlternandoNotificacoes] = useState(false);
  const [baixando, setBaixando] = useState(false);
  const [naoLidas, setNaoLidas] = useState(0);

  useFocusEffect(useCallback(() => {
    if (!session || !SITE_URL) return;
    fetch(`${SITE_URL}/api/portal/notificacoes?filtro=nao-lidas`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(res => res.json())
      .then(json => { if (json.ok) setNaoLidas(json.info.length); })
      .catch(() => {});
  }, [session]));

  if (loading || !session) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const nome = perfil?.nome || session.user.email || 'Usuário';
  const cargoRotulo = perfil?.tipo === 'PORTAL' ? 'Colaborador' : (perfil?.permissaoNormalizada ?? '—');

  async function alternarBiometria(valor: boolean) {
    if (valor) {
      const resultado = await ativarBiometria();
      if (!resultado.ok) {
        // Falha silenciosa é ok aqui: o Switch simplesmente volta pro estado
        // anterior porque biometriaAtivada não muda quando ativarBiometria falha.
        return;
      }
    } else {
      await desativarBiometria();
    }
  }

  function abrirSistemaWeb() {
    router.push({ pathname: '/webview', params: { url: perfil?.tipo === 'PORTAL' ? '/portal' : '/admin' } });
  }

  async function alternarNotificacoes(valor: boolean) {
    setAlternandoNotificacoes(true);
    if (valor) {
      const resultado = await ativarNotificacoes();
      if (!resultado.ok) Alert.alert('Notificações', resultado.erro || 'Não foi possível ativar agora.');
    } else {
      await desativarNotificacoes();
    }
    setAlternandoNotificacoes(false);
  }

  async function baixarOffline() {
    if (!session || !perfil) return;
    setBaixando(true);
    const permissoesRotas = await carregarPermissoesRotas();
    const resultado = await baixarParaOffline(session.access_token, perfil, permissoesRotas);
    setBaixando(false);
    Alert.alert('Baixar para uso offline', resultado.resumo);
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.cabecalhoPerfil}>
        <View style={styles.avatar}>
          <Text style={styles.avatarTexto}>{iniciais(nome)}</Text>
        </View>
        <Text style={styles.nome}>{nome}</Text>
        <Text style={styles.cargo}>{perfil?.cargoExibicao || cargoRotulo}</Text>
        <View style={styles.tags}>
          <View style={styles.tag}><Text style={styles.tagTexto}>{cargoRotulo}</Text></View>
          {perfil?.matriculaEsocial ? (
            <View style={styles.tag}><Text style={styles.tagTexto}>Matrícula {perfil.matriculaEsocial}</Text></View>
          ) : null}
        </View>
      </View>

      <View style={styles.lista}>
        <View style={styles.linha}>
          <FingerprintIcon size={18} color={colors.accent} weight="regular" />
          <Text style={styles.linhaTexto}>Entrar com biometria</Text>
          {biometriaSuportada ? (
            <Switch value={biometriaAtivada} onValueChange={alternarBiometria} />
          ) : (
            <Text style={styles.linhaNota}>Indisponível</Text>
          )}
        </View>

        <View style={styles.linha}>
          <BellIcon size={18} color={colors.accent} weight="regular" />
          <Text style={styles.linhaTexto}>Notificações</Text>
          {alternandoNotificacoes ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Switch value={notificacoesAtivadas} onValueChange={alternarNotificacoes} />
          )}
        </View>

        <Pressable style={styles.linha} onPress={() => router.push('/notificacoes')}>
          <BellIcon size={18} color={colors.accent} weight="regular" />
          <Text style={styles.linhaTexto}>Ver notificações</Text>
          {naoLidas > 0 ? (
            <View style={styles.badge}><Text style={styles.badgeTexto}>{naoLidas}</Text></View>
          ) : null}
          <CaretRightIcon size={16} color={colors.textMuted} weight="regular" />
        </Pressable>

        <Pressable style={styles.linha} onPress={abrirSistemaWeb}>
          <GlobeIcon size={18} color={colors.accent} weight="regular" />
          <Text style={styles.linhaTexto}>Abrir o sistema web</Text>
          <CaretRightIcon size={16} color={colors.textMuted} weight="regular" />
        </Pressable>

        <Pressable style={styles.linha} onPress={baixarOffline} disabled={baixando}>
          <CloudArrowDownIcon size={18} color={colors.accent} weight="regular" />
          <Text style={styles.linhaTexto}>Baixar para uso offline</Text>
          {baixando ? <ActivityIndicator color={colors.accent} /> : <CaretRightIcon size={16} color={colors.textMuted} weight="regular" />}
        </Pressable>

        <Pressable style={styles.linha} onPress={() => Linking.openURL(`mailto:${SUPORTE_EMAIL}`)}>
          <LifebuoyIcon size={18} color={colors.accent} weight="regular" />
          <Text style={styles.linhaTexto}>Suporte</Text>
          <CaretRightIcon size={16} color={colors.textMuted} weight="regular" />
        </Pressable>
      </View>

      <Pressable style={styles.botaoSair} onPress={signOut}>
        <SignOutIcon size={16} color={colors.danger} weight="regular" />
        <Text style={styles.botaoSairTexto}>Sair da conta</Text>
      </Pressable>

      <Text style={styles.versao}>Rentech · v{Constants.expoConfig?.version ?? '0.1.0'}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 22 },
  cabecalhoPerfil: { alignItems: 'center', gap: 6 },
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  avatarTexto: { color: colors.white, fontSize: 18, fontWeight: '800' },
  nome: { fontSize: 17, fontWeight: '700', color: colors.white, textAlign: 'center' },
  cargo: { fontSize: 12.5, color: colors.textMuted },
  tags: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tag: { borderRadius: 6, paddingVertical: 3, paddingHorizontal: 10, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.surfaceBorder },
  tagTexto: { fontSize: 11, color: colors.textSecondary, fontWeight: '600' },
  lista: {
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    overflow: 'hidden',
  },
  linha: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.surfaceBorder,
  },
  linhaTexto: { flex: 1, fontSize: 14, color: colors.white },
  linhaTextoDesabilitado: { color: colors.textMuted },
  linhaNota: { fontSize: 11, color: colors.textSubtle },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  badgeTexto: { fontSize: 10.5, fontWeight: '800', color: colors.white },
  botaoSair: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botaoSairTexto: { color: colors.danger, fontWeight: '700', fontSize: 13 },
  versao: { textAlign: 'center', fontSize: 11, color: colors.textSubtle },
});
