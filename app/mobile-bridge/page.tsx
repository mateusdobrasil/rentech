"use client";

// app/mobile-bridge/page.tsx
// Ponte de autenticação usada pela WebView do app mobile (mobile/components/WebViewScreen.tsx).
// A WebView é um contexto de storage isolado do app React Native — não enxerga
// a sessão guardada no AsyncStorage do app. Tanto /admin (app/admin/layout.tsx)
// quanto /portal (app/portal/page.tsx) autenticam 100% client-side, lendo
// supabase.auth.getSession() do client do próprio navegador. Esta página recebe
// os tokens da sessão do app pelo fragment da URL (nunca vai pro servidor),
// estabelece a sessão nesse client via setSession(), e só então navega pra
// página de destino — garantindo que o getSession() dela já encontre sessão.
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function MobileBridgePage() {
  const [erro, setErro] = useState('');

  useEffect(() => {
    async function autenticar() {
      const hash = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const accessToken = params.get('access_token');
      const refreshToken = params.get('refresh_token');
      const redirect = params.get('redirect') || '/';

      if (!accessToken || !refreshToken) {
        setErro('Link de acesso inválido: faltam credenciais de sessão.');
        return;
      }

      // Só aceita destino relativo — nunca redireciona pra fora do próprio site.
      if (!redirect.startsWith('/') || redirect.startsWith('//')) {
        setErro('Destino de redirecionamento inválido.');
        return;
      }

      const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (error) {
        setErro('Não foi possível validar sua sessão: ' + error.message);
        return;
      }

      // Hard navigation (não router.push): garante que a página de destino monte
      // do zero e leia a sessão recém-persistida via getSession().
      window.location.replace(redirect);
    }
    autenticar();
  }, []);

  if (erro) {
    return (
      <div style={estilos.centro}>
        <div style={estilos.card}>
          <p style={estilos.erro}>{erro}</p>
          <p style={estilos.dica}>Volte pro app e tente abrir esta tela de novo.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={estilos.centro}>
      <div style={estilos.card}>
        <p style={estilos.texto}>Entrando...</p>
      </div>
    </div>
  );
}

const estilos: Record<string, React.CSSProperties> = {
  centro: { display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#000000', margin: 0 },
  card: { textAlign: 'center', padding: 24 },
  texto: { color: '#B3B3B3', fontSize: 14, fontFamily: 'Arial, sans-serif' },
  erro: { color: '#c0392b', fontSize: 14, fontWeight: 700, fontFamily: 'Arial, sans-serif' },
  dica: { color: '#999999', fontSize: 12, marginTop: 8, fontFamily: 'Arial, sans-serif' },
};
