import { ScrollView, StyleSheet, Text, View } from 'react-native';

// Módulo público — não requer sessão. Placeholder até os simuladores reais
// (que devem reusar a lógica de packages/calc quando ela existir) serem
// implementados.
export default function Simuladores() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.titulo}>Simuladores</Text>
      <View style={styles.card}>
        <Text style={styles.cardTexto}>Em breve por aqui.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  titulo: { fontSize: 24, fontWeight: '800' },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f2' },
  cardTexto: { fontSize: 13, color: '#555' },
});
