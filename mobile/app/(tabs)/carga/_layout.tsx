import { Stack } from 'expo-router';
import { colors } from '../../../constants/theme';

// Ver frota/_layout.tsx — mesmo motivo (grupo de rota de verdade, pilha
// própria pra Fase 3 estender com novo.tsx / [id].tsx).
export default function CargaLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: true, title: 'Carga', headerStyle: { backgroundColor: colors.surface }, headerTitleStyle: { color: colors.white }, headerTintColor: colors.white }} />
      <Stack.Screen name="novo" />
      <Stack.Screen name="[id]/index" />
    </Stack>
  );
}
