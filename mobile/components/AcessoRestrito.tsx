import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../constants/theme';

// Fallback para quando alguém chega numa aba protegida por deep link direto
// (a Tabs._layout já esconde a aba do usuário sem permissão, mas a rota
// continua existindo).
export function AcessoRestrito() {
  return (
    <View style={styles.container}>
      <Text style={styles.titulo}>Acesso restrito</Text>
      <Text style={styles.texto}>Você precisa estar logado com o perfil correto para ver esta área.</Text>
      <Link href="/login" style={styles.link}>
        Ir para Entrar
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
    backgroundColor: colors.background,
  },
  titulo: { fontSize: 18, fontWeight: '700', color: colors.white },
  texto: { textAlign: 'center', color: colors.textMuted },
  link: { marginTop: 12, color: colors.accent, fontWeight: '600' },
});
