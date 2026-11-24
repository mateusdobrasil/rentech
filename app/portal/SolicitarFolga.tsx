"use client";

// app/portal/SolicitarFolga.tsx
// Modal "Solicitar folga" da aba Espelho de Ponto do Portal do Funcionário —
// a mesma opção 4 do WhatsApp: data única ou período (até 30 dias, a partir
// de hoje) + motivo. Só cria a solicitação PENDENTE (FOLGA_DIA); quem aprova é
// o RH ou o gestor do Operacional. Em cima, as folgas recentes do próprio
// funcionário com o status, pra ele acompanhar sem depender do WhatsApp.
import { useEffect, useState } from 'react';
import { solicitarFolgaAction, listarMinhasFolgasAction, type MinhaFolga } from './actions/actions-ponto';

const STATUS_LABEL: Record<MinhaFolga['status'], string> = { PENDENTE: 'Pendente', APROVADA: 'Aprovada', REJEITADA: 'Rejeitada' };
const STATUS_COR: Record<MinhaFolga['status'], string> = {
  PENDENTE: 'bg-amber-50 text-amber-700 border-amber-200',
  APROVADA: 'bg-green-50 text-green-700 border-green-200',
  REJEITADA: 'bg-red-50 text-red-700 border-red-200',
};

const dataBR = (iso: string) => iso.split('-').reverse().join('/');
const periodoBR = (ini: string, fim: string | null) => (!fim || fim === ini ? dataBR(ini) : `${dataBR(ini)} a ${dataBR(fim)}`);
const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

export default function SolicitarFolga({ accessToken, onClose }: { accessToken: string; onClose: () => void }) {
  const [folgas, setFolgas] = useState<MinhaFolga[] | null>(null);
  const [versao, setVersao] = useState(0);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    let vivo = true;
    listarMinhasFolgasAction(accessToken).then(res => { if (vivo) setFolgas(res.ok ? res.info : []); });
    return () => { vivo = false; };
  }, [accessToken, versao]);

  const enviar = async () => {
    if (!inicio) { setErro('Informe a data da folga.'); return; }
    if (!motivo.trim()) { setErro('Informe o motivo.'); return; }
    setEnviando(true); setErro('');
    const res = await solicitarFolgaAction({ inicio, fim: fim || inicio, motivo }, accessToken);
    setEnviando(false);
    if (!res.ok) { setErro(res.erro || 'Erro ao enviar a solicitação.'); return; }
    setSucesso(true);
    setVersao(v => v + 1);
  };

  const novaSolicitacao = () => { setInicio(''); setFim(''); setMotivo(''); setErro(''); setSucesso(false); };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-[#E2E8F0] max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">🏖️ Solicitar folga</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {sucesso ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">✅</div>
            <p className="text-sm font-bold text-[#0C1D4D] mb-1">Solicitação enviada!</p>
            <p className="text-xs text-gray-500 mb-4">Ela segue para o RH ou o seu gestor. Você será avisado pelo WhatsApp quando for decidida.</p>
            <div className="flex gap-2">
              <button onClick={novaSolicitacao} className="flex-1 text-[#64748B] font-bold text-xs py-3 rounded-xl border border-[#E2E8F0]">Pedir outra</button>
              <button onClick={onClose} className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3 rounded-xl transition-colors">Fechar</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Data</label>
                <input
                  type="date" value={inicio} min={hojeIso()}
                  onChange={e => { setInicio(e.target.value); if (fim && e.target.value > fim) setFim(''); }}
                  className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Até (opcional)</label>
                <input
                  type="date" value={fim} min={inicio || hojeIso()}
                  onChange={e => setFim(e.target.value)}
                  className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none"
                />
              </div>
            </div>
            <p className="text-[11px] text-gray-400 -mt-1">Para um dia só, deixe o &quot;Até&quot; em branco. O período vai até 30 dias corridos; férias e afastamentos são com o RH.</p>
            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Motivo</label>
              <textarea
                value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
                placeholder="Ex: consulta médica, assunto pessoal, compensação de banco de horas"
                className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-medium focus:border-[#336699] outline-none resize-none"
              />
            </div>
            {erro && <p className="text-xs text-red-600 font-bold">{erro}</p>}
            <button
              onClick={enviar} disabled={enviando}
              className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3 rounded-xl shadow-lg transition-colors disabled:opacity-40"
            >
              {enviando ? 'Enviando...' : 'Enviar solicitação'}
            </button>
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-[#E2E8F0]">
          <p className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Minhas folgas</p>
          {folgas === null ? (
            <p className="text-xs text-gray-400 font-bold">Carregando...</p>
          ) : folgas.length === 0 ? (
            <p className="text-xs text-gray-400">Nenhuma folga pedida nos últimos 60 dias.</p>
          ) : (
            <ul className="space-y-2">
              {folgas.map(f => (
                <li key={f.id} className="p-3 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-black text-[#0C1D4D]">{periodoBR(f.data_referencia, f.data_referencia_fim)}</span>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full border ${STATUS_COR[f.status]}`}>{STATUS_LABEL[f.status]}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1 break-words">{f.motivo}</p>
                  {f.status === 'REJEITADA' && f.motivo_rejeicao && (
                    <p className="text-[11px] text-red-600 font-bold mt-1 break-words">Motivo: {f.motivo_rejeicao}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
