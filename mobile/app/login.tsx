import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { FingerprintIcon } from 'phosphor-react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../constants/theme';
import { somenteDigitos, formatarCpf } from '../lib/cpf';

const SITE_URL = process.env.EXPO_PUBLIC_SITE_URL;

type Modo = 'equipe' | 'colaborador';

function traduzErro(erro: string): string {
  if (erro.includes('Invalid login credentials')) return 'E-mail/CPF ou senha incorretos.';
  return erro;
}

export default function LoginScreen() {
  const { session, locked } = useAuth();
  // Biometria "desbloqueia a sessão guardada" (README) — só faz sentido quando
  // já existe uma sessão persistida esperando desbloqueio. Sem sessão nenhuma
  // não há o que desbloquear, então essa tela mostra o formulário completo.
  if (session && locked) return <DesbloqueioBiometria />;
  return <FormularioLogin />;
}

function DesbloqueioBiometria() {
  const { desbloquearComBiometria } = useAuth();
  const [erro, setErro] = useState('');
  const [tentando, setTentando] = useState(false);
  const [usarSenha, setUsarSenha] = useState(false);

  async function tentar() {
    setErro('');
    setTentando(true);
    const resultado = await desbloquearComBiometria();
    setTentando(false);
    if (!resultado.ok) setErro(resultado.erro || 'Não foi possível confirmar sua identidade.');
  }

  useEffect(() => { tentar(); }, []);

  if (usarSenha) return <FormularioLogin />;

  return (
    <View style={styles.screen}>
      <View style={styles.painel}>
        <Image source={require('../assets/images/logo_pb.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.iconeBiometria}>
          <FingerprintIcon size={40} color={colors.accent} weight="regular" />
        </View>
        <Text style={styles.titulo}>Sessão guardada</Text>
        <Text style={styles.subtitulo}>Confirme sua identidade pra continuar</Text>

        {erro ? <Text style={styles.erro}>{erro}</Text> : null}

        <Pressable style={styles.botao} onPress={tentar} disabled={tentando}>
          <Text style={styles.botaoTexto}>{tentando ? 'CONFIRMANDO...' : 'TENTAR DE NOVO'}</Text>
        </Pressable>
        <Pressable onPress={() => setUsarSenha(true)}>
          <Text style={styles.link}>Usar e-mail/CPF e senha</Text>
        </Pressable>
      </View>
    </View>
  );
}

function FormularioLogin() {
  const { signInEquipe, signInColaborador } = useAuth();
  const [modo, setModo] = useState<Modo>('equipe');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleEntrar() {
    setErro('');
    setEnviando(true);
    const resultado = modo === 'equipe' ? await signInEquipe(email, senha) : await signInColaborador(cpf, senha);
    setEnviando(false);
    if (resultado.error) setErro(traduzErro(resultado.error));
  }

  const identificadorPreenchido = modo === 'equipe' ? email.trim().length > 0 : somenteDigitos(cpf).length === 11;

  return (
    <View style={styles.screen}>
      <View style={styles.painel}>
        <Image source={require('../assets/images/logo_pb.png')} style={styles.logo} resizeMode="contain" />
        <Text style={styles.rodapeTopo}>Ecossistema digital · acesso interno</Text>

        <View style={styles.segmentado}>
          <Pressable
            style={[styles.segmentoBotao, modo === 'equipe' && styles.segmentoBotaoAtivo]}
            onPress={() => setModo('equipe')}
          >
            <Text style={[styles.segmentoTexto, modo === 'equipe' && styles.segmentoTextoAtivo]}>Equipe</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentoBotao, modo === 'colaborador' && styles.segmentoBotaoAtivo]}
            onPress={() => setModo('colaborador')}
          >
            <Text style={[styles.segmentoTexto, modo === 'colaborador' && styles.segmentoTextoAtivo]}>Colaborador</Text>
          </Pressable>
        </View>

        {modo === 'equipe' ? (
          <View style={styles.campo}>
            <Text style={styles.rotulo}>E-mail Corporativo</Text>
            <TextInput
              style={styles.input}
              placeholder="seu.nome@rentech.com.br"
              placeholderTextColor={colors.textSubtle}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
            />
          </View>
        ) : (
          <View style={styles.campo}>
            <Text style={styles.rotulo}>CPF</Text>
            <TextInput
              style={styles.input}
              placeholder="000.000.000-00"
              placeholderTextColor={colors.textSubtle}
              keyboardType="number-pad"
              value={formatarCpf(cpf)}
              onChangeText={(t) => setCpf(somenteDigitos(t))}
              maxLength={14}
            />
          </View>
        )}

        <View style={styles.campo}>
          <Text style={styles.rotulo}>Senha de Acesso</Text>
          <TextInput
            style={styles.input}
            placeholder="••••••••"
            placeholderTextColor={colors.textSubtle}
            secureTextEntry
            value={senha}
            onChangeText={setSenha}
          />
        </View>

        {erro ? <Text style={styles.erro}>{erro}</Text> : null}

        <Pressable
          style={[styles.botao, (!identificadorPreenchido || !senha || enviando) && styles.botaoDesabilitado]}
          onPress={handleEntrar}
          disabled={!identificadorPreenchido || !senha || enviando}
        >
          {enviando ? <ActivityIndicator color={colors.white} /> : <Text style={styles.botaoTexto}>ENTRAR</Text>}
        </Pressable>

        {modo === 'colaborador' && SITE_URL && (
          <Pressable onPress={() => Linking.openURL(`${SITE_URL}/portal/login`)}>
            <Text style={styles.link}>Primeiro acesso? Crie sua conta pelo navegador</Text>
          </Pressable>
        )}

        <Text style={styles.rodape}>
          A sessão fica no aparelho. Mesma conta do sistema web ou do Portal do Funcionário — o que você
          tem define o que aparece no app.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  painel: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(12, 29, 77, 0.2)',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    borderRadius: 20,
    padding: 28,
    gap: 4,
  },
  logo: { width: '100%', height: 56, marginBottom: 8 },
  rodapeTopo: { fontSize: 12, color: colors.textMuted, opacity: 0.55, textAlign: 'center', marginBottom: 20 },
  iconeBiometria: { alignItems: 'center', marginBottom: 8 },
  titulo: { fontSize: 20, fontWeight: '900', color: colors.white, textAlign: 'center', textTransform: 'uppercase' },
  subtitulo: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  segmentado: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: 3,
    marginBottom: 18,
  },
  segmentoBotao: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  segmentoBotaoAtivo: { backgroundColor: colors.primary },
  segmentoTexto: { fontSize: 12, fontWeight: '800', color: colors.textMuted, letterSpacing: 0.5 },
  segmentoTextoAtivo: { color: colors.white },
  campo: { marginBottom: 14, gap: 6 },
  rotulo: { fontSize: 10, fontWeight: '900', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(40, 75, 140, 0.5)',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 46,
    color: colors.white,
  },
  erro: { color: colors.danger, fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  botao: {
    marginTop: 8,
    minHeight: 48,
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoDesabilitado: { opacity: 0.5 },
  botaoTexto: { color: colors.white, fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  botaoSecundario: {
    marginTop: 12,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  botaoSecundarioTexto: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  link: { color: colors.accent, fontWeight: '600', fontSize: 12, textAlign: 'center', marginTop: 16 },
  rodape: { fontSize: 12, color: colors.textSubtle, textAlign: 'center', marginTop: 20, lineHeight: 17 },
});
