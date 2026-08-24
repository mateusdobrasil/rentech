import './globals.css';
import Navbar from '../components/Navbar'; // Importando o componente

export const metadata = {
  title: 'Rentech - Ecossistema Digital',
  description: 'Engenharia Audiovisual para Grandes Eventos'
};

// Esconde a Navbar da Rentech antes da primeira pintura, sem servidor
// precisar saber o host/origem (isso manteria o site inteiro em SSR
// dinâmico). Script roda antes da hidratação, então não há flash da Navbar
// aparecendo e sumindo. Dois casos, mesma classe:
// 1. Acesso white-label pelo subdomínio da AlfaLight (portal.alfalight.com.br/login).
// 2. WebView do app mobile (mobile/components/WebViewScreen.tsx) — a navegação
//    já é toda controlada pelo app nativo, então a Navbar do site (que levaria
//    pra outras páginas fora do que o app abriu de propósito) fica escondida.
//    A flag é marcada em localStorage por app/mobile-bridge/page.tsx, no
//    mesmo navegador/origem da WebView, antes de qualquer página do site
//    carregar.
const HIDE_NAVBAR_SCRIPT = `
  try {
    if (location.hostname === 'portal.alfalight.com.br' && location.pathname === '/login') {
      document.documentElement.classList.add('white-label-hide-navbar');
    }
    if (localStorage.getItem('rentech_app_mobile') === '1') {
      document.documentElement.classList.add('white-label-hide-navbar');
    }
  } catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // suppressHydrationWarning no <html> abaixo: HIDE_NAVBAR_SCRIPT muda a
  // className dele antes da hidratação de propósito (não dá pra saber no
  // servidor se é white-label/app mobile) — é o padrão recomendado pra esse
  // caso (ver https://react.dev/link/hydration-mismatch), não indica bug.
  // Sem isso, o Next mostra um overlay de erro em dev cobrindo a página
  // inteira, embora não afete build de produção.
  return (
    <html lang="pt-BR" className="scroll-smooth" suppressHydrationWarning>

      {/* O fundo preto padrão do ecossistema já pode ficar no body */}
      <body className="bg-[#000000] text-slate-50 font-sans antialiased">
        {/* Script clássico (não next/script) de propósito: precisa ser
            parser-blocking, primeiro filho do body, pra rodar antes da
            Navbar pintar na tela — next/script beforeInteractive enfileira
            e roda tarde demais pra evitar o flash. */}
        <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: HIDE_NAVBAR_SCRIPT }} />

        {/* O Navbar agora aparece em TODAS as páginas automaticamente */}
        <Navbar />

        {/* Aqui é onde o Next.js renderiza o conteúdo específico de cada página */}
        <div data-site-content className="pt-20"> {/* pt-20 compensa a altura do Navbar fixo */}
          {children}
        </div>

      </body>
    </html>
  );
}