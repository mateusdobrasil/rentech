"use client";

// app/portal/JustificarPonto.tsx
// Modal aberto a partir de um dia clicável do Espelho de Ponto (ver
// EspelhoPonto.tsx): ponto incompleto (ímpar) só oferece Justificar; falta
// (nenhuma batida) oferece Justificar OU Pedir abono. Em qualquer dos dois
// casos só cria uma solicitação PENDENTE em folha_ponto_whatsapp_solicitacoes
// — a mesma fila/aprovação do fluxo WhatsApp (app/admin/rh/ponto,
// app/admin/operacional/registro-ponto) — nunca grava o ajuste/abono direto.
import { useState } from 'react';
import type { TipoBatida } from '../lib/pontoWhatsapp';
import { solicitarJustificativaBatidaAction, solicitarAbonoDiaAction, type MinhaSolicitacaoPonto } from './actions/actions-ponto';
import type { RegistroDia } from './EspelhoPonto';

const CAMPOS = ['entrada_1', 'saida_1', 'entrada_2', 'saida_2'] as const;
type Campo = (typeof CAMPOS)[number];

const TIPO_BATIDA_POR_CAMPO: Record<Campo, TipoBatida> = {
  entrada_1: 'ENTRADA_1', saida_1: 'SAIDA_1', entrada_2: 'ENTRADA_2', saida_2: 'SAIDA_2',
};

// entrada_1 e entrada_2 só têm um sentido possível (Entrada / Retorno do
// almoço); saida_1 muda de rótulo dependendo se há almoço no dia ou não —
// mesma leitura que a tabela do Espelho já usa pra decidir em qual coluna
// mostrar cada batida (ver temIntervalo em EspelhoPonto.tsx).
function labelCampo(campo: Campo, reg: RegistroDia | undefined): string {
  if (campo === 'entrada_1') return 'Entrada';
  if (campo === 'entrada_2') return 'Retorno do almoço';
  if (campo === 'saida_2') return 'Saída';
  const temAlmoco = !!(reg?.entrada_2 || reg?.saida_2);
  return temAlmoco ? 'Saída para o almoço' : 'Saída';
}

const STATUS_LABEL: Record<MinhaSolicitacaoPonto['status'], string> = {
  PENDENTE: 'Pendente — aguardando análise',
  APROVADA: 'Aprovada',
  REJEITADA: 'Rejeitada',
};
const STATUS_COR: Record<MinhaSolicitacaoPonto['status'], string> = {
  PENDENTE: 'text-amber-600', APROVADA: 'text-green-600', REJEITADA: 'text-red-600',
};

interface Props {
  accessToken: string;
  dataIso: string;
  reg: RegistroDia | undefined;
  falta: boolean;
  solicitacoesDoDia: MinhaSolicitacaoPonto[];
  onClose: () => void;
  onEnviado: () => void;
}

export default function JustificarPonto({ accessToken, dataIso, reg, falta, solicitacoesDoDia, onClose, onEnviado }: Props) {
  const [modo, setModo] = useState<'menu' | 'justificar' | 'abono'>('menu');
  const [campoEscolhido, setCampoEscolhido] = useState<Campo | null>(null);
  const [horario, setHorario] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState(false);

  const dataBR = dataIso.split('-').reverse().join('/');
  const camposFaltantes = CAMPOS.filter(c => !reg?.[c]);

  const statusDoCampo = (campo: Campo) => solicitacoesDoDia.find(s => s.tipo === 'JUSTIFICATIVA_BATIDA' && s.tipo_batida === TIPO_BATIDA_POR_CAMPO[campo]);
  const statusAbono = solicitacoesDoDia.find(s => s.tipo === 'ABONO_DIA');

  const escolherCampo = (campo: Campo) => {
    setCampoEscolhido(campo);
    setHorario(''); setMotivo(''); setErro('');
    setModo('justificar');
  };

  const enviarJustificativa = async () => {
    if (!campoEscolhido) return;
    if (!horario) { setErro('Informe o horário.'); return; }
    if (!motivo.trim()) { setErro('Informe o motivo.'); return; }
    setEnviando(true); setErro('');
    const res = await solicitarJustificativaBatidaAction(
      { dataReferencia: dataIso, tipoBatida: TIPO_BATIDA_POR_CAMPO[campoEscolhido], horario, motivo },
      accessToken
    );
    setEnviando(false);
    if (!res.ok) { setErro(res.erro || 'Erro ao enviar a solicitação.'); return; }
    setSucesso(true);
    onEnviado();
  };

  const enviarAbono = async () => {
    if (!motivo.trim()) { setErro('Informe o motivo.'); return; }
    setEnviando(true); setErro('');
    const res = await solicitarAbonoDiaAction({ dataReferencia: dataIso, motivo }, accessToken);
    setEnviando(false);
    if (!res.ok) { setErro(res.erro || 'Erro ao enviar a solicitação.'); return; }
    setSucesso(true);
    onEnviado();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 border border-[#E2E8F0]" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black text-[#0C1D4D] uppercase tracking-wider">{dataBR}</h3>
            <p className="text-[11px] text-gray-500 font-bold uppercase">{falta ? 'Falta' : 'Ponto incompleto'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {sucesso ? (
          <div className="text-center py-4">
            <div className="text-4xl mb-2">✅</div>
            <p className="text-sm font-bold text-[#0C1D4D] mb-1">Solicitação enviada!</p>
            <p className="text-xs text-gray-500 mb-4">Ela segue para análise do RH/gestor. Você será avisado pelo WhatsApp quando for decidida.</p>
            <button onClick={onClose} className="w-full bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3 rounded-xl transition-colors">
              Fechar
            </button>
          </div>
        ) : modo === 'menu' ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 font-medium mb-3">
              {falta
                ? 'Você pode pedir abono do dia inteiro, ou justificar uma entrada/saída específica.'
                : 'Escolha qual batida você quer justificar.'}
            </p>

            {camposFaltantes.length === 0 && !falta && (
              <p className="text-xs text-gray-400 font-medium">Não há batida faltante para justificar neste dia.</p>
            )}

            {camposFaltantes.map(campo => {
              const sol = statusDoCampo(campo);
              const bloqueado = sol?.status === 'PENDENTE';
              return (
                <button
                  key={campo}
                  disabled={bloqueado}
                  onClick={() => escolherCampo(campo)}
                  className="w-full text-left p-3 rounded-xl border border-[#E2E8F0] hover:border-[#336699] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[#E2E8F0] disabled:hover:bg-white"
                >
                  <span className="block text-sm font-bold text-[#0C1D4D]">Justificar {labelCampo(campo, reg)}</span>
                  {sol && <span className={`block text-[10px] font-bold uppercase mt-0.5 ${STATUS_COR[sol.status]}`}>{STATUS_LABEL[sol.status]}</span>}
                </button>
              );
            })}

            {falta && (
              <button
                disabled={statusAbono?.status === 'PENDENTE'}
                onClick={() => { setMotivo(''); setErro(''); setModo('abono'); }}
                className="w-full text-left p-3 rounded-xl border border-[#E2E8F0] hover:border-[#336699] hover:bg-[#F8FAFC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-[#E2E8F0] disabled:hover:bg-white"
              >
                <span className="block text-sm font-bold text-[#0C1D4D]">Pedir abono do dia inteiro</span>
                {statusAbono && <span className={`block text-[10px] font-bold uppercase mt-0.5 ${STATUS_COR[statusAbono.status]}`}>{STATUS_LABEL[statusAbono.status]}</span>}
              </button>
            )}
          </div>
        ) : modo === 'justificar' ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 font-bold uppercase">{campoEscolhido && labelCampo(campoEscolhido, reg)}</p>
            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Horário correto</label>
              <input
                type="time" value={horario} onChange={e => setHorario(e.target.value)}
                className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-semibold focus:border-[#336699] outline-none"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Motivo</label>
              <textarea
                value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
                placeholder="Ex: esqueci de bater o ponto"
                className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-medium focus:border-[#336699] outline-none resize-none"
              />
            </div>
            {erro && <p className="text-xs text-red-600 font-bold">{erro}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setModo('menu')} className="flex-1 text-[#64748B] font-bold text-xs py-3 rounded-xl border border-[#E2E8F0]">Voltar</button>
              <button
                onClick={enviarJustificativa} disabled={enviando}
                className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3 rounded-xl shadow-lg transition-colors disabled:opacity-40"
              >
                {enviando ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="block text-[10px] font-bold text-[#64748B] uppercase mb-1">Motivo do abono</label>
              <textarea
                value={motivo} onChange={e => setMotivo(e.target.value)} rows={3}
                placeholder="Ex: atestado médico, falta justificada"
                className="w-full p-3 border-2 border-[#E2E8F0] rounded-lg text-sm font-medium focus:border-[#336699] outline-none resize-none"
              />
            </div>
            <p className="text-[11px] text-gray-400">Se tiver atestado ou outro documento, envie pelo WhatsApp do Ponto ou entregue ao RH — o pedido já segue para análise mesmo sem anexo.</p>
            {erro && <p className="text-xs text-red-600 font-bold">{erro}</p>}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setModo('menu')} className="flex-1 text-[#64748B] font-bold text-xs py-3 rounded-xl border border-[#E2E8F0]">Voltar</button>
              <button
                onClick={enviarAbono} disabled={enviando}
                className="flex-1 bg-[#0C1D4D] hover:bg-[#284B8C] text-white font-black text-xs uppercase tracking-widest py-3 rounded-xl shadow-lg transition-colors disabled:opacity-40"
              >
                {enviando ? 'Enviando...' : 'Enviar'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
