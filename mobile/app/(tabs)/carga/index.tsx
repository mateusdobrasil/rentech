import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AcessoRestrito } from '../../../components/AcessoRestrito';
import { useAuth } from '../../../context/AuthContext';
import { colors } from '../../../constants/theme';

export default function Carga() {
  const { session } = useAuth();
  if (!session) return <AcessoRestrito />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.cardTitulo}>Checklist de carga</Text>
        <Text style={styles.cardTexto}>Conferência de equipamento chega na Fase 3. Placeholder por enquanto.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 12 },
  titulo: { fontSize: 24, fontWeight: '800', color: colors.white, marginBottom: 8 },
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    gap: 4,
  },
  cardTitulo: { fontSize: 15, fontWeight: '700', color: colors.white },
  cardTexto: { fontSize: 13, color: colors.textSecondary },
});
