import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../constants/theme';

export default function Inicio() {
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/logo_pb.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.subtitulo}>Ecossistema digital Rentech</Text>
      </View>

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
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 24, gap: 16 },
  header: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  logo: { width: '80%', height: 64 },
  subtitulo: { fontSize: 13, color: colors.textMuted, fontWeight: '600', letterSpacing: 0.5 },
  card: {
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    gap: 4,
  },
  cardTitulo: { fontSize: 16, fontWeight: '800', color: colors.white },
  cardTexto: { fontSize: 13, color: colors.textSecondary },
});
