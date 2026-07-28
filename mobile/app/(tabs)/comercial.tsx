import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AcessoRestrito } from '../../components/AcessoRestrito';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../constants/theme';

export default function Comercial() {
  const { session } = useAuth();
  if (!session) return <AcessoRestrito />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.titulo}>Comercial</Text>
      <View style={styles.card}>
        <Text style={styles.cardTexto}>Em breve por aqui.</Text>
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
  },
  cardTexto: { fontSize: 13, color: colors.textSecondary },
});
