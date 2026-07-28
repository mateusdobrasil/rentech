import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../constants/theme';

export default function Perfil() {
  const { loading, session, perfil, signOut } = useAuth();

  if (loading) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (session) {
    return (
      <View style={styles.screen}>
        <View style={styles.painel}>
          <Text style={styles.titulo}>{perfil?.nome || session.user.email}</Text>
          <Text style={styles.texto}>{perfil?.email}</Text>
          <Text style={styles.texto}>Perfil: {perfil?.permissaoNormalizada ?? '—'}</Text>

          <Pressable style={styles.botaoSecundario} onPress={signOut}>
            <Text style={styles.botaoSecundarioTexto}>Sair</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return <FormularioLogin />;
}

function FormularioLogin() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleLogin() {
    setErro('');
    setEnviando(true);
    const { error } = await signIn(email, senha);
    setEnviando(false);
    if (error) {
      setErro(error.includes('Invalid login credentials') ? 'E-mail ou senha incorretos.' : error);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.painel}>
        <Image
          source={require('../../assets/images/logo_pb.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.titulo}>Acesso Restrito</Text>
        <Text style={styles.subtitulo}>Identifique-se para entrar no ecossistema</Text>

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

        <Pressable style={styles.botao} onPress={handleLogin} disabled={enviando}>
          <Text style={styles.botaoTexto}>{enviando ? 'AUTENTICANDO...' : 'ENTRAR NO SISTEMA'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
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
  logo: { width: '100%', height: 56, marginBottom: 20 },
  titulo: { fontSize: 20, fontWeight: '900', color: colors.white, textAlign: 'center', textTransform: 'uppercase' },
  subtitulo: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  texto: { fontSize: 14, color: colors.textSecondary },
  campo: { marginBottom: 14, gap: 6 },
  rotulo: {
    fontSize: 10,
    fontWeight: '900',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(40, 75, 140, 0.5)',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    color: colors.white,
  },
  erro: { color: colors.danger, fontSize: 12, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  botao: {
    marginTop: 8,
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  botaoTexto: { color: colors.white, fontWeight: '900', fontSize: 13, letterSpacing: 1 },
  botaoSecundario: {
    marginTop: 20,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  botaoSecundarioTexto: { color: colors.danger, fontWeight: '700' },
});
