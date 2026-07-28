import { Tabs } from 'expo-router';
import { useAuth } from '../../context/AuthContext';

// Quem pode ver cada aba além de Início/Simuladores (que são públicas).
// 'qualquer-autenticado' = todo funcionário logado (RH é holerite/ponto/docs,
// de interesse de qualquer um). As demais exigem um dos cargos normalizados
// por normalizarPermissao() (mesma regra do web/, veja app/lib/permissoes.ts).
// Ajuste esses arrays conforme as regras reais forem definidas em
// folha_paginas_permissoes.
const REGRAS_ACESSO = {
  rh: 'qualquer-autenticado' as const,
  frota: ['ADMINISTRADOR', 'ADMINISTRATIVO', 'OPERACIONAL'],
  comercial: ['ADMINISTRADOR', 'ADMINISTRATIVO', 'FINANCEIRO'],
};

type RotaComRegra = keyof typeof REGRAS_ACESSO;

function podeAcessar(rota: RotaComRegra, autenticado: boolean, permissaoNormalizada?: string): boolean {
  if (!autenticado) return false;
  const regra = REGRAS_ACESSO[rota];
  if (regra === 'qualquer-autenticado') return true;
  return permissaoNormalizada ? regra.includes(permissaoNormalizada) : false;
}

export default function TabsLayout() {
  const { session, perfil } = useAuth();
  const autenticado = !!session;

  return (
    <Tabs screenOptions={{ headerShown: true }}>
      <Tabs.Screen name="index" options={{ title: 'Início' }} />
      <Tabs.Screen name="simuladores" options={{ title: 'Simuladores' }} />
      <Tabs.Screen
        name="rh"
        options={{
          title: 'RH',
          href: podeAcessar('rh', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="frota"
        options={{
          title: 'Frota',
          href: podeAcessar('frota', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="comercial"
        options={{
          title: 'Comercial',
          href: podeAcessar('comercial', autenticado, perfil?.permissaoNormalizada) ? undefined : null,
        }}
      />
      <Tabs.Screen name="perfil" options={{ title: autenticado ? 'Perfil' : 'Entrar' }} />
    </Tabs>
  );
}
