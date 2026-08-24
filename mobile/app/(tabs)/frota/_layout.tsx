import { Stack } from 'expo-router';
import { colors } from '../../../constants/theme';

// Torna "frota/" um grupo de rota de verdade (não só um arquivo solto) —
// necessário pra <Tabs.Screen name="frota"> do _layout.tsx pai casar com o
// filho, e é a mesma pilha que a Fase 2 vai estender com novo.tsx / [id].tsx.
export default function FrotaLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.white },
        headerTintColor: colors.white,
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Frota' }} />
    </Stack>
  );
}
