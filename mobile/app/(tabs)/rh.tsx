import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AcessoRestrito } from '../../components/AcessoRestrito';
import { useAuth } from '../../context/AuthContext';

export default function RH() {
  const { session } = useAuth();
  if (!session) return <AcessoRestrito />;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.titulo}>RH</Text>
      {['Holerite', 'Ponto', 'Documentos'].map((item) => (
        <View key={item} style={styles.card}>
          <Text style={styles.cardTitulo}>{item}</Text>
          <Text style={styles.cardTexto}>Em breve por aqui.</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  titulo: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 4 },
  cardTitulo: { fontSize: 15, fontWeight: '700' },
  cardTexto: { fontSize: 13, color: '#555' },
});
