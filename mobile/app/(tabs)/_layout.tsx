import { Tabs } from 'expo-router';
import { HouseIcon, TruckIcon, PackageIcon, ClipboardTextIcon, ReceiptIcon, UserIcon } from 'phosphor-react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../constants/theme';

// Abas além de Início/Perfil (sempre visíveis). Contas PORTAL nunca batem em
// nenhuma regra aqui — permissaoNormalizada delas é o sentinela 'PORTAL', que
// não aparece em nenhum array — então caem sempre no conjunto Início+Perfil,
// sem checagem especial. Regras normalizadas por normalizarPermissao() (mesma
// regra do web/, veja app/lib/permissoes.ts).
const REGRAS_ACESSO = {
  frota: ['OPERACIONAL'],
  carga: ['OPERACIONAL'],
  ponto: ['ADMINISTRATIVO', 'ADMINISTRADOR'],
  op: ['ADMINISTRATIVO', 'ADMINISTRADOR'],
};

type RotaComRegra = keyof typeof REGRAS_ACESSO;

function podeAcessar(rota: RotaComRegra, autenticado: boolean, permissaoNormalizada?: string): boolean {
  if (!autenticado) return false;
  return permissaoNormalizada ? REGRAS_ACESSO[rota].includes(permissaoNormalizada) : false;
}

export default function TabsLayout() {
  const { session, perfil } = useAuth();
  const autenticado = !!session;

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { color: colors.white },
        headerTintColor: colors.white,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.surfaceBorder },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Início', tabBarIcon: ({ color }) => <HouseIcon size={21} color={color} weight="regular" /> }}
      />
      {/* headerShown: false nestas quatro — cada pasta tem seu próprio
          _layout.tsx (Stack) que já mostra o cabeçalho, senão duplicava. */}
      <Tabs.Screen
        name="frota"
        options={{
          title: 'Frota',
          headerShown: false,
          tabBarIcon: ({ color }) => <TruckIcon size={21} color={color} weight="regular" />,
          href: podeAcessar('frota', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="carga"
        options={{
          title: 'Carga',
          headerShown: false,
          tabBarIcon: ({ color }) => <PackageIcon size={21} color={color} weight="regular" />,
          href: podeAcessar('carga', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="ponto"
        options={{
          title: 'Ponto',
          headerShown: false,
          tabBarIcon: ({ color }) => <ClipboardTextIcon size={21} color={color} weight="regular" />,
          href: podeAcessar('ponto', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="op"
        options={{
          title: 'OP',
          headerShown: false,
          tabBarIcon: ({ color }) => <ReceiptIcon size={21} color={color} weight="regular" />,
          href: podeAcessar('op', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      {/* Simuladores fica fora desta leva (decisão do brief) — arquivo continua
          no repo pra quando a feature voltar, mas nunca linkado numa aba. */}
      <Tabs.Screen name="simuladores" options={{ href: null }} />
      <Tabs.Screen
        name="perfil"
        options={{ title: 'Perfil', tabBarIcon: ({ color }) => <UserIcon size={21} color={color} weight="regular" /> }}
      />
    </Tabs>
  );
}
