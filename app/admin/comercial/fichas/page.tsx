import { permanentRedirect } from 'next/navigation';

// A tela de Fichas de Reserva mudou para o hub Locações em 2026-11-16.
// Mantém favoritos e links antigos funcionando.
export default function FichasRedirect() {
  permanentRedirect('/admin/locacoes/fichas-reserva');
}
