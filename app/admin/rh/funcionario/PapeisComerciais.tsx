"use client";

// Vendedor / cliente / fornecedor na Ficha do RH (2026-11-23). Cada marcação
// grava na hora (não depende do "Salvar" da ficha). Cliente/fornecedor usa o
// CPF da ficha como chave do cadastro de parceiro — nunca cria duplicado.
// Regras em app/lib/cadastros/papeisRh.ts.
import { useEffect, useState } from 'react';
import { useToast } from '../../../components/ui/NotificationProvider';
import { papeisFuncionarioAction, definirPapelFuncionarioAction } from '../actions/actions-papeis';

type Papeis = {
  vendedor: boolean;
  colaborador: { id: number; nome_exibicao: string | null; origem: string; flag_vendedor_rep: boolean; status_colaborador: string | null } | null;
  parceiro: { id: number; nome: string; origem: string; codigo: number | null; flag_cliente: boolean; flag_fornecedor: boolean; editavel: boolean } | null;
  temCpf: boolean;
};
type Papel = 'vendedor' | 'cliente' | 'fornecedor';

export default function PapeisComerciais({ funcionarioId, accessToken, cpfAlterado }: { funcionarioId: string; accessToken: string; cpfAlterado: boolean }) {
  const toast = useToast();
  const [p, setP] = useState<Papeis | null>(null);
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState<Papel | ''>('');

  useEffect(() => {
    // a Ficha remonta o painel (key) ao trocar de funcionário ou de CPF salvo
    let vivo = true;
    papeisFuncionarioAction(funcionarioId, accessToken).then(r => {
      if (!vivo) return;
      if (r.ok) setP(r.info as Papeis); else setErro(r.erro);
    });
    return () => { vivo = false; };
  }, [funcionarioId, accessToken]);

  const marcar = async (papel: Papel, valor: boolean) => {
    if (papel !== 'vendedor' && cpfAlterado) { toast('Salve a ficha antes: o CPF foi alterado e ele é a chave do cadastro de cliente/fornecedor.', 'error'); return; }
    setGravando(papel);
    const r = await definirPapelFuncionarioAction(funcionarioId, papel, valor, accessToken);
    setGravando('');
    if (!r.ok) { toast(r.erro, 'error'); return; }
    setP(r.info as Papeis);
    toast(`${papel[0].toUpperCase()}${papel.slice(1)} ${valor ? 'marcado' : 'desmarcado'}.`, 'success');
  };

  const caixa = 'flex items-center gap-2 text-[11px] font-bold text-gray-600 uppercase';
  return (
    <div className="col-span-2 bg-white p-2.5 rounded-lg border border-indigo-100 space-y-2">
      <div className="text-[9px] font-black text-gray-500 uppercase">💼 Papéis comerciais — grava na hora</div>
      {erro && <p className="text-[10px] font-bold text-red-600">{erro}</p>}
      {!p && !erro && <p className="text-[10px] text-gray-400">Carregando…</p>}
      {p && (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className={caixa}>
              <input type="checkbox" className="w-4 h-4" checked={p.vendedor} disabled={gravando !== ''} onChange={e => marcar('vendedor', e.target.checked)} />
              🧑‍💼 Vendedor{gravando === 'vendedor' && '…'}
            </label>
            <label className={caixa}>
              <input type="checkbox" className="w-4 h-4" checked={!!p.parceiro?.flag_cliente} disabled={gravando !== '' || !p.temCpf} onChange={e => marcar('cliente', e.target.checked)} />
              🛒 Cliente{gravando === 'cliente' && '…'}
            </label>
            <label className={caixa}>
              <input type="checkbox" className="w-4 h-4" checked={!!p.parceiro?.flag_fornecedor} disabled={gravando !== '' || !p.temCpf} onChange={e => marcar('fornecedor', e.target.checked)} />
              🏭 Fornecedor{gravando === 'fornecedor' && '…'}
            </label>
          </div>
          <div className="text-[10px] text-gray-500 space-y-0.5">
            {p.colaborador && (
              <p>Vendedor: cadastro nº {p.colaborador.id} ({p.colaborador.origem === 'SISTEMA' ? 'criado no sistema' : 'do P2S'}){p.colaborador.status_colaborador === 'I' ? ' — inativo (funcionário desligado)' : ''}. Carteira, comissões e fichas usam este cadastro.</p>
            )}
            {!p.temCpf && <p className="text-amber-700 font-bold">Cliente/fornecedor precisa de um CPF válido salvo na ficha — o CPF é a chave do cadastro (evita duplicado).</p>}
            {p.parceiro && (
              <p>
                Parceiro pelo CPF: <b className="text-[#0A2A4A]">{p.parceiro.nome}</b>
                {' '}(código {p.parceiro.codigo ?? p.parceiro.id}, {p.parceiro.origem === 'SISTEMA' ? 'cadastro do sistema' : 'do P2S'})
                {!p.parceiro.editavel && ' — enquanto o P2S for oficial, cliente/fornecedor deste cadastro muda lá.'}
              </p>
            )}
            {p.temCpf && !p.parceiro && <p>Nenhum parceiro com este CPF: marcar cliente ou fornecedor cria o cadastro com os dados da ficha.</p>}
          </div>
        </>
      )}
    </div>
  );
}
