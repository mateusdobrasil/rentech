import './globals.css';
import Navbar from '../components/Navbar'; // Importando o componente

export const metadata = {
  title: 'Rentech - Ecossistema Digital',
  description: 'Engenharia Audiovisual para Grandes Eventos'
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="scroll-smooth">
      
      {/* O fundo preto padrão do ecossistema já pode ficar no body */}
      <body className="bg-[#000000] text-slate-50 font-sans antialiased">
        
        {/* O Navbar agora aparece em TODAS as páginas automaticamente */}
        <Navbar />
        
        {/* Aqui é onde o Next.js renderiza o conteúdo específico de cada página */}
        <div className="pt-20"> {/* pt-20 compensa a altura do Navbar fixo */}
          {children}
        </div>
        
      </body>
    </html>
  );
}