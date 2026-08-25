import { Stack } from 'expo-router';
import { colors } from '../../../constants/theme';

// Ver frota/_layout.tsx — mesmo motivo (grupo de rota de verdade, pilha
// própria pra Fase 3 estender com [id].tsx).
export default function PontoLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" options={{ headerShown: true, title: 'Aprovações de ponto', headerStyle: { backgroundColor: colors.surface }, headerTitleStyle: { color: colors.white }, headerTintColor: colors.white }} />
      <Stack.Screen name="[id]/index" />
    </Stack>
  );
}
