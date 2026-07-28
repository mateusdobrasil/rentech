import { ScrollView, StyleSheet, Text, View } from 'react-native';

export default function Inicio() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.titulo}>Rentech</Text>
      <Text style={styles.subtitulo}>Ecossistema digital Rentech</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitulo}>Simuladores</Text>
        <Text style={styles.cardTexto}>Disponível sem login, na aba ao lado.</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitulo}>RH, Frota e Comercial</Text>
        <Text style={styles.cardTexto}>Entre na aba Perfil para acessar as áreas do seu setor.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 16 },
  titulo: { fontSize: 28, fontWeight: '800' },
  subtitulo: { fontSize: 14, color: '#666', marginBottom: 8 },
  card: { padding: 16, borderRadius: 12, backgroundColor: '#f2f2f2', gap: 4 },
  cardTitulo: { fontSize: 16, fontWeight: '700' },
  cardTexto: { fontSize: 13, color: '#555' },
});
