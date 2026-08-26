import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { HouseIcon, TruckIcon, PackageIcon, ClipboardTextIcon, ReceiptIcon, UserIcon } from 'phosphor-react-native';
import { useAuth } from '../../context/AuthContext';
import { colors } from '../../constants/theme';
import { calcularModulosAcessiveis, carregarPermissoesRotas, type RotaMobile } from '../../lib/permissoesRotas';

export default function TabsLayout() {
  const { session, perfil } = useAuth();
  const autenticado = !!session;
  const [permissoesRotas, setPermissoesRotas] = useState<Record<string, string[]>>({});

  // Contas PORTAL não passam por folha_paginas_permissoes (é regra de cargo
  // de equipe) — Frota pra elas é liberada à parte por pode_dirigir, ver
  // calcularModulosAcessiveis(). Só busca essa tabela pra contas STAFF.
  useEffect(() => {
    if (perfil?.tipo !== 'STAFF') return;
    carregarPermissoesRotas().then(setPermissoesRotas);
  }, [perfil?.tipo, perfil?.permissaoNormalizada]);

  // Máximo 3 módulos como aba (+ Início e Perfil = 5) — cargos com acesso
  // amplo (ex.: ADMINISTRADOR, hoje liberado em Frota+Carga+Ponto+OP) não
  // veem as 4 ao mesmo tempo; o que passa do limite fica só como card na
  // Início (ver (tabs)/index.tsx).
  const modulos = autenticado
    ? calcularModulosAcessiveis(permissoesRotas, perfil?.permissaoNormalizada, perfil?.podeDirigir)
    : [];
  const comoAba = (rota: RotaMobile): boolean => modulos.some(m => m.rota === rota && m.comoAba);

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
          href: comoAba('/mobile/frota') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="carga"
        options={{
          title: 'Carga',
          headerShown: false,
          tabBarIcon: ({ color }) => <PackageIcon size={21} color={color} weight="regular" />,
          href: comoAba('/mobile/carga') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="ponto"
        options={{
          title: 'Ponto',
          headerShown: false,
          tabBarIcon: ({ color }) => <ClipboardTextIcon size={21} color={color} weight="regular" />,
          href: comoAba('/mobile/ponto') ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="op"
        options={{
          title: 'OP',
          headerShown: false,
          tabBarIcon: ({ color }) => <ReceiptIcon size={21} color={color} weight="regular" />,
          href: comoAba('/mobile/op') ? undefined : null,
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
