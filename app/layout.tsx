import './globals.css';
import Navbar from '../components/Navbar'; // Importando o componente

export const metadata = {
  title: 'Rentech - Ecossistema Digital',
  description: 'Engenharia Audiovisual para Grandes Eventos'
};

// Acesso white-label pelo subdomínio da AlfaLight (portal.alfalight.com.br/login):
// esconde a Navbar da Rentech antes da primeira pintura, sem servidor precisar
// saber o host (isso manteria o site inteiro em SSR dinâmico). Script roda
// antes da hidratação, então não há flash da Navbar aparecendo e sumindo.
const HIDE_NAVBAR_SCRIPT = `
  try {
    if (location.hostname === 'portal.alfalight.com.br' && location.pathname === '/login') {
      document.documentElement.classList.add('white-label-hide-navbar');
    }
  } catch (e) {}
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="scroll-smooth">

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