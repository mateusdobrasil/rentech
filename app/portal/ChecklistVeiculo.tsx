"use client";

import { useEffect, useState } from 'react';
import {
  listarVeiculosParaChecklistAction,
  listarModeloItensAction,
  buscarChecklistAbertoAction,
  listarMeusChecklistsAction,
  abrirChecklistAction,
  finalizarChecklistAction,
  registrarAvariaChecklistAction,
} from './actions/actions-checklist-veiculo';

interface Veiculo { id: string; apelido: string; tipo: string; placa: string; }
interface ModeloItem { id: string; ordem: number; descricao: string; }
interface ChecklistAberto { id: string; numero: number; veiculo_id: string; destino: string | null; km_inicial: number | null; combustivel_saida: string | null; saida_em: string; }
interface ChecklistHistorico {
  id: string; numero: number; status: 'EM_ANDAMENTO' | 'FINALIZADO';
  destino: string | null; km_inicial: number | null; km_final: number | null;
  saida_em: string; retorno_em: string | null;
  veiculo: { apelido: string; placa: string } | null;
}
interface AvariaPendente { descricao: string; arquivo: File | null; }

const NIVEIS_COMBUSTIVEL = ['VAZIO', 'RESERVA', '1/4', '1/2', '3/4', 'CHEIO'];

const fmtDataHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

const lerComoBase64 = (arquivo: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = reject;
    reader.readAsDataURL(arquivo);
  });

export default function ChecklistVeiculo({ accessToken }: { accessToken: string }) {
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'erro' | 'sucesso'; texto: string } | null>(null);

  const [veiculos, setVeiculos] = useState<Veiculo[]>([]);
  const [checklistAberto, setChecklistAberto] = useState<ChecklistAberto | null>(null);
  const [historico, setHistorico] = useState<ChecklistHistorico[]>([]);

  const [itensModelo, setItensModelo] = useState<ModeloItem[]>([]);
  const [itensMarcados, setItensMarcados] = useState<Record<string, boolean>>({});
  const [avarias, setAvarias] = useState<AvariaPendente[]>([]);

  // Formulário de Saída
  const [veiculoId, setVeiculoId] = useState('');
  const [kmInicial, setKmInicial] = useState('');
  const [combustivelSaida, setCombustivelSaida] = useState('');
  const [destino, setDestino] = useState('');

  // Formulário de Retorno
  const [kmFinal, setKmFinal] = useState('');
  const [combustivelRetorno, setCombustivelRetorno] = useState('');

  const etapaAtual: 'SAIDA' | 'RETORNO' = checklistAberto ? 'RETORNO' : 'SAIDA';

  const carregar = async () => {
    setCarregando(true);
    const [veiculosRes, abertoRes, historicoRes] = await Promise.all([
      listarVeiculosParaChecklistAction(accessToken),
      buscarChecklistAbertoAction(accessToken),
      listarMeusChecklistsAction(accessToken),
    ]);
    if (veiculosRes.ok) setVeiculos(veiculosRes.info.veiculos);
    if (abertoRes.ok) setChecklistAberto(abertoRes.info.checklist);
    if (historicoRes.ok) setHistorico(historicoRes.info.checklists);

    const itensRes = await listarModeloItensAction(accessToken, abertoRes.ok && abertoRes.info.checklist ? 'RETORNO' : 'SAIDA');
    if (itensRes.ok) setItensModelo(itensRes.info.itens);
    setItensMarcados({});
    setAvarias([]);
    setCarregando(false);
  };

  useEffect(() => { carregar(); }, [accessToken]);

  const alternarItem = (id: string) => setItensMarcados(prev => ({ ...prev, [id]: !prev[id] }));

  const adicionarAvaria = () => setAvarias(prev => [...prev, { descricao: '', arquivo: null }]);
  const atualizarAvaria = (idx: number, patch: Partial<AvariaPendente>) =>
    setAvarias(prev => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));
  const removerAvaria = (idx: number) => setAvarias(prev => prev.filter((_, i) => i !== idx));

  // Depois que o checklist (header) já existe, grava cada avaria pendente —
  // com foto (lida como base64) quando houver.
  const registrarAvariasPendentes = async (checklistId: string, etapa: 'SAIDA' | 'RETORNO') => {
    for (const avaria of avarias) {
      if (!avaria.descricao.trim()) continue;
      const base64 = avaria.arquivo ? await lerComoBase64(avaria.arquivo) : undefined;
      await registrarAvariaChecklistAction(accessToken, {
        checklistId, etapa, descricao: avaria.descricao.trim(),
        arquivoBase64: base64, nomeArquivo: avaria.arquivo?.name, tipoMime: avaria.arquivo?.type,
      });
    }
  };

  const itensParaEnviar = () => itensModelo.map(i => ({ descricao: i.descricao, ordem: i.ordem, marcado: !!itensMarcados[i.id] }));

  const enviarSaida = async () => {
    if (!veiculoId) { setMensagem({ tipo: 'erro', texto: 'Selecione o veículo.' }); return; }
    if (!kmInicial) { setMensagem({ tipo: 'erro', texto: 'Informe o KM inicial.' }); return; }

    setEnviando(true);
    setMensagem(null);
    const res = await abrirChecklistAction(accessToken, {
      veiculoId, kmInicial: parseFloat(kmInicial), combustivelSaida, destino: destino.trim(),
      itens: itensParaEnviar(),
    });
    if (!res.ok) {
      setMensagem({ tipo: 'erro', texto: res.erro || 'Falha ao abrir o checklist.' });
      setEnviando(false);
      return;
    }

    await registrarAvariasPendentes(res.info.id, 'SAIDA');
    setEnviando(false);
    setMensagem({ tipo: 'sucesso', texto: `Checklist de saída registrado! Boa viagem.` });
    setVeiculoId(''); setKmInicial(''); setCombustivelSaida(''); setDestino('');
    await carregar();
  };

  const enviarRetorno = async () => {
    if (!checklistAberto) return;
    if (!kmFinal) { setMensagem({ tipo: 'erro', texto: 'Informe o KM final.' }); return; }

    setEnviando(true);
    setMensagem(null);
    const res = await finalizarChecklistAction(accessToken, {
      checklistId: checklistAberto.id, kmFinal: parseFloat(kmFinal), combustivelRetorno,
      itens: itensParaEnviar(),
    });
    if (!res.ok) {
      setMensagem({ tipo: 'erro', texto: res.erro || 'Falha ao finalizar o checklist.' });
      setEnviando(false);
      return;
    }

    await registrarAvariasPendentes(checklistAberto.id, 'RETORNO');
    setEnviando(false);
    setMensagem({ tipo: 'sucesso', texto: 'Checklist de retorno finalizado. Obrigado!' });
    setKmFinal(''); setCombustivelRetorno('');
    await carregar();
  };

  const veiculoDoChecklistAberto = veiculos.find(v => v.id === checklistAberto?.veiculo_id);

  if (carregando) {
    return <p className="text-center py-12 text-gray-400 font-bold uppercase tracking-wider">Carregando...</p>;
  }

  return (
    <div className="space-y-4">
      {mensagem && (
        <div className={`text-xs font-bold px-4 py-3 rounded-lg border ${mensagem.tipo === 'erro' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-green-50 border-green-200 text-green-700'}`}>
          {mensagem.texto}
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 md:p-5 space-y-4">
        {etapaAtual === 'SAIDA' ? (
          <>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm">🚚 Iniciar Checklist de Saída</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Veículo</label>
                <select value={veiculoId} onChange={e => setVeiculoId(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-semibold bg-white">
                  <option value="">— Selecione —</option>
                  {veiculos.map(v => <option key={v.id} value={v.id}>{v.apelido} ({v.placa})</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Destino</label>
                <input type="text" value={destino} onChange={e => setDestino(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">KM Inicial</label>
                <input type="number" value={kmInicial} onChange={e => setKmInicial(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Combustível</label>
                <select value={combustivelSaida} onChange={e => setCombustivelSaida(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-semibold bg-white">
                  <option value="">— Selecione —</option>
                  {NIVEIS_COMBUSTIVEL.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </>
        ) : (
          <>
            <h3 className="font-black text-[#0C1D4D] uppercase tracking-wider text-sm">🔁 Finalizar Checklist de Retorno</h3>
            <p className="text-xs text-gray-500 -mt-2">
              {veiculoDoChecklistAberto ? `${veiculoDoChecklistAberto.apelido} (${veiculoDoChecklistAberto.placa})` : 'Veículo'}
              {checklistAberto?.destino ? ` · Destino: ${checklistAberto.destino}` : ''} · Saída em {fmtDataHora(checklistAberto?.saida_em)}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">KM Final</label>
                <input type="number" value={kmFinal} onChange={e => setKmFinal(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-gray-500 uppercase mb-1">Combustível</label>
                <select value={combustivelRetorno} onChange={e => setCombustivelRetorno(e.target.value)} className="w-full p-2.5 border border-gray-300 rounded-lg text-sm font-semibold bg-white">
                  <option value="">— Selecione —</option>
                  {NIVEIS_COMBUSTIVEL.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
          </>
        )}

        <div>
          <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-2">Checklist</h4>
          <div className="space-y-1.5">
            {itensModelo.map(item => (
              <label key={item.id} className="flex items-center gap-2 bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={!!itensMarcados[item.id]} onChange={() => alternarItem(item.id)} className="w-4 h-4" />
                <span className="text-[13px] font-semibold text-[#0C1D4D]">{item.descricao}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex justify-between items-center mb-2">
            <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-wider">Avarias (opcional)</h4>
            <button onClick={adicionarAvaria} className="text-[10px] font-black text-[#336699] uppercase">➕ Adicionar</button>
          </div>
          {avarias.length === 0 ? (
            <p className="text-[11px] text-gray-400">Nenhuma avaria reportada.</p>
          ) : (
            <div className="space-y-2">
              {avarias.map((a, idx) => (
                <div key={idx} className="bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] p-2.5 space-y-1.5">
                  <div className="flex gap-2">
                    <input
                      type="text" placeholder="Descreva a avaria..." value={a.descricao}
                      onChange={e => atualizarAvaria(idx, { descricao: e.target.value })}
                      className="flex-1 p-2 border border-gray-300 rounded text-xs"
                    />
                    <button onClick={() => removerAvaria(idx)} className="text-red-500 text-xs font-black px-2">✕</button>
                  </div>
                  <input type="file" accept="image/*" capture="environment" onChange={e => atualizarAvaria(idx, { arquivo: e.target.files?.[0] || null })} className="text-[10px] w-full" />
                </div>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={etapaAtual === 'SAIDA' ? enviarSaida : enviarRetorno}
          disabled={enviando}
          className="w-full bg-[#16A34A] hover:bg-[#15803D] text-white font-black text-sm uppercase tracking-widest py-3.5 rounded-xl shadow-md transition-colors disabled:opacity-50"
        >
          {enviando ? '⏳ Enviando...' : etapaAtual === 'SAIDA' ? '💾 Iniciar Checklist' : '💾 Finalizar Checklist'}
        </button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-[#E2E8F0] p-4 md:p-5">
        <h4 className="text-[10px] font-black text-gray-500 uppercase tracking-wider mb-3">Meu Histórico</h4>
        {historico.length === 0 ? (
          <p className="text-[11px] text-gray-400">Nenhum checklist registrado ainda.</p>
        ) : (
          <div className="space-y-2">
            {historico.map(c => (
              <div key={c.id} className="flex items-center justify-between bg-[#F8FAFC] rounded-lg border border-[#E2E8F0] px-3 py-2.5">
                <div>
                  <p className="text-[13px] font-black text-[#0C1D4D]">{c.veiculo ? `${c.veiculo.apelido} (${c.veiculo.placa})` : 'Veículo'}</p>
                  <p className="text-[10px] text-gray-400">{fmtDataHora(c.saida_em)} → {fmtDataHora(c.retorno_em)}</p>
                </div>
                <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full border ${c.status === 'FINALIZADO' ? 'bg-green-100 text-green-700 border-green-300' : 'bg-blue-100 text-blue-700 border-blue-300'}`}>
                  {c.status === 'FINALIZADO' ? 'Finalizado' : 'Em Andamento'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
