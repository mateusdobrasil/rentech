// Layout do Hub Manuais: as páginas (lista e manual aberto) + o assistente
// "💬 Pergunte" (AssistenteManuais), que fica aberto entre uma e outra.
import AssistenteManuais from './AssistenteManuais';

export default function LayoutManuais({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <AssistenteManuais />
    </>
  );
}
