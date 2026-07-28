import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';

export default function Perfil() {
  const { loading, session, perfil, signIn, signOut } = useAuth();

  if (loading) {
    return (
      <View style={styles.centro}>
        <ActivityIndicator />
      </View>
    );
  }

  if (session) {
    return (
      <View style={styles.container}>
        <Text style={styles.titulo}>{perfil?.nome || session.user.email}</Text>
        <Text style={styles.texto}>{perfil?.email}</Text>
        <Text style={styles.texto}>Perfil: {perfil?.permissaoNormalizada ?? '—'}</Text>

        <Pressable style={styles.botaoSecundario} onPress={signOut}>
          <Text style={styles.botaoSecundarioTexto}>Sair</Text>
        </Pressable>
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
    <View style={styles.container}>
      <Text style={styles.titulo}>Entrar</Text>

      <TextInput
        style={styles.input}
        placeholder="seu.nome@rentech.com.br"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Senha"
        secureTextEntry
        value={senha}
        onChangeText={setSenha}
      />

      {erro ? <Text style={styles.erro}>{erro}</Text> : null}

      <Pressable style={styles.botao} onPress={handleLogin} disabled={enviando}>
        <Text style={styles.botaoTexto}>{enviando ? 'Entrando...' : 'Entrar'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  centro: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, padding: 24, gap: 12, justifyContent: 'center' },
  titulo: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  texto: { fontSize: 14, color: '#555' },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
  },
  erro: { color: '#c0392b', fontSize: 13 },
  botao: {
    marginTop: 8,
    backgroundColor: '#284B8C',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  botaoTexto: { color: '#fff', fontWeight: '700' },
  botaoSecundario: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#c0392b',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
  },
  botaoSecundarioTexto: { color: '#c0392b', fontWeight: '700' },
});
