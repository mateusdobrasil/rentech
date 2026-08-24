import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { HouseIcon, TruckIcon, PackageIcon, ClipboardTextIcon, ReceiptIcon, UserIcon } from 'phosphor-react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../constants/theme';
import { carregarPermissoesRotas, type RotaMobile } from '../../lib/permissoesRotas';

function podeAcessar(
  mapa: Record<string, string[]>,
  rota: RotaMobile,
  autenticado: boolean,
  permissaoNormalizada?: string,
  podeDirigir?: boolean
): boolean {
  if (!autenticado) return false;
  // Colaborador comum (Portal) não passa por folha_paginas_permissoes — essa
  // tabela é de cargo de equipe. Quem libera a Frota pra ele é a mesma flag
  // que já libera o Checklist de Veículo no Portal web
  // (folha_funcionarios.pode_dirigir), só pra essa rota.
  if (rota === '/mobile/frota' && podeDirigir) return true;
  if (!permissaoNormalizada) return false;
  return (mapa[rota] || []).includes(permissaoNormalizada);
}

export default function TabsLayout() {
  const { session, perfil } = useAuth();
  const autenticado = !!session;
  const [permissoesRotas, setPermissoesRotas] = useState<Record<string, string[]>>({});

  // Contas PORTAL não passam por folha_paginas_permissoes (é regra de cargo
  // de equipe) — Frota pra elas é liberada à parte por pode_dirigir, ver
  // podeAcessar() acima. Só busca essa tabela pra contas STAFF.
  useEffect(() => {
    if (perfil?.tipo !== 'STAFF') return;
    carregarPermissoesRotas().then(setPermissoesRotas);
  }, [perfil?.tipo, perfil?.permissaoNormalizada]);

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
          href: podeAcessar(permissoesRotas, '/mobile/frota', autenticado, perfil?.permissaoNormalizada, perfil?.podeDirigir) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="carga"
        options={{
          title: 'Carga',
          headerShown: false,
          tabBarIcon: ({ color }) => <PackageIcon size={21} color={color} weight="regular" />,
          href: podeAcessar(permissoesRotas, '/mobile/carga', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="ponto"
        options={{
          title: 'Ponto',
          headerShown: false,
          tabBarIcon: ({ color }) => <ClipboardTextIcon size={21} color={color} weight="regular" />,
          href: podeAcessar(permissoesRotas, '/mobile/ponto', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="op"
        options={{
          title: 'OP',
          headerShown: false,
          tabBarIcon: ({ color }) => <ReceiptIcon size={21} color={color} weight="regular" />,
          href: podeAcessar(permissoesRotas, '/mobile/op', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
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
