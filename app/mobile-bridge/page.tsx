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

      // Só aceita destino relativo — nunca redireciona pra fora do próprio site.
      if (!redirect.startsWith('/') || redirect.startsWith('//')) {
        setErro('Destino de redirecionamento inválido.');
        return;
      }

      // A WebView já pode ter uma sessão válida guardada de uma visita
      // anterior à ponte (o storage é compartilhado entre instâncias de
      // WebView do app, e o client daqui já cuida de renová-la sozinho via
      // autoRefreshToken). Chamar setSession() de novo com o refresh_token
      // que o app mandou nesse caso é o que quebra: refresh token do
      // Supabase é de uso único (rotaciona a cada renovação) — o token que o
      // app mobile guarda pode já ter sido consumido pela própria WebView, e
      // reenviá-lo dá "Auth session missing!". Só chama setSession() quando
      // ainda NÃO há sessão utilizável aqui.
      const { data: existente } = await supabase.auth.getSession();
      const expiraEm = existente.session?.expires_at;
      const jaTemSessaoValida = !!existente.session && !!expiraEm && expiraEm * 1000 > Date.now();

      let accessTokenAtivo = existente.session?.access_token || null;

      if (!jaTemSessaoValida) {
        if (!accessToken || !refreshToken) {
          setErro('Link de acesso inválido: faltam credenciais de sessão.');
          return;
        }

        const { data: novaSessao, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
        if (error) {
          setErro('Não foi possível validar sua sessão: ' + error.message);
          return;
        }
        accessTokenAtivo = novaSessao.session?.access_token || accessToken;
      }

      // Marca que este navegador é a WebView do app mobile — app/layout.tsx lê
      // isso (mesmo mecanismo já usado pro white-label da AlfaLight) pra
      // esconder a Navbar do site, já que a navegação é toda controlada pelo
      // app nativo, não faz sentido abrir outras páginas do site por aqui.
      try {
        localStorage.setItem('rentech_app_mobile', '1');
      } catch {
        // localStorage indisponível (raro numa WebView) — segue sem a flag,
        // só não esconde a Navbar
      }

      // Mesmo cookie que app/login/page.tsx grava no login normal do site —
      // proxy.ts confere isso pra liberar /admin/op/:path* (o "Ver no
      // sistema" da tela de OP não aponta pra lá hoje, mas fechar essa
      // pendência agora custa uma linha e evita surpresa se algum link futuro
      // apontar pra dentro de /admin/op).
      if (accessTokenAtivo) {
        document.cookie = `sb-access-token=${accessTokenAtivo}; path=/; max-age=86400; SameSite=Lax`;
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
