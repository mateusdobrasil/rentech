import { WebViewScreen } from '../../components/WebViewScreen';

// Módulo público — não requer sessão. Reusa as páginas /simulador/* do
// Next.js (web/) via WebView em vez de reimplementar a UI de
// drag-and-drop/grid nativamente — mesma lógica, sem duplicação.
export default function Simuladores() {
  return <WebViewScreen path="/simulador" />;
}
