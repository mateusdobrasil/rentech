"use client";

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../../../app/imgs/logo.png';
import { supabase } from '../../lib/supabase';
import { Analytics } from "@vercel/analytics/next"

// Interfaces para tipagem estrita do TypeScript
interface Equipamento {
  id: string;
  categoria_id: string;
  nome: string;
  peso: number;
  consumo_watts: number;
  largura: number;
  altura: number;
  profundidade: number;
  resolucao?: string;
  dmx?: string;
  detalhes?: string;
  imagem_url?: string;
  tipo_grupo?: string;
}

interface Gatilho {
  id: string;
  acessorio_id: string;
  categoria_alvo_id: string | null;
  equipamento_alvo_id: string | null;
}

interface ItemProjeto {
  id: string;
  qty: number;
  name: string;
  details: string;
  weight: number;
  watts: number;
  image: string;
}

export default function SimuladorVideoWall() {
  // Estados do Banco de Dados (Supabase)
  const [equipamentos, setEquipamentos] = useState<Equipamento[]>([]);
  const [gatilhos, setGatilhos] = useState<Gatilho[]>([]);
  const [loading, setLoading] = useState(true);

  // Estados de Navegação e Interface
  const [equipType, setEquipType] = useState('led');
  const [isProjectView, setIsProjectView] = useState(false);
  const [projectList, setProjectList] = useState<ItemProjeto[]>([]);

  // Estados dos Formulários de Entrada
  const [selectedModelId, setSelectedModelId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [clientData, setClientData] = useState({ evento: '', cliente: '' });

  // Estados específicos para Configuração de LED
  const [ledConfig, setLedConfig] = useState({
    width: 1,
    height: 1,
    shape: 'reto',
    pitchId: '' 
  });

  // Estados do Modal de Acessórios Inteligentes
  const [modalOpen, setModalOpen] = useState(false);
  const [recommendedAccs, setRecommendedAccs] = useState<Equipamento[]>([]);
  const [modalSelections, setModalSelections] = useState<{ [key: string]: { checked: boolean; qty: number } }>({});

  // 1. Buscar dados dinâmicos do Supabase ao montar a página
  useEffect(() => {
    async function loadSupabaseData() {
      try {
        setLoading(true);
        const { data: equipData, error: equipError } = await supabase.from('equipamentos').select('*').eq('ativo', true);
        const { data: gatilhosData, error: gatilhosError } = await supabase.from('gatilhos_acessorios').select('*');

        if (equipError) throw equipError;
        if (gatilhosError) throw gatilhosError;

        setEquipamentos(equipData || []);
        setGatilhos(gatilhosData || []);

        const primeiroLed = equipData?.find(e => {
          const c = (e.categoria_id || '').toLowerCase().trim();
          return c === 'led' || c.includes('led') || c.includes('painel');
        });
        if (primeiroLed) setLedConfig(prev => ({ ...prev, pitchId: primeiroLed.id }));

        const primeiroTv = equipData?.find(e => (e.categoria_id || '').toLowerCase().trim() === 'tv');
        if (primeiroTv) setSelectedModelId(primeiroTv.id);

      } catch (error) {
        console.error("Erro crítico ao conectar com o Supabase:", error);
      } finally {
        setLoading(false);
      }
    }
    loadSupabaseData();
  }, []);

  // 2. Organizar equipamentos por setores
  const dbSetores = useMemo(() => {
    const limpar = (id: string) => (id || '').toLowerCase().trim();

    return {
      led: equipamentos.filter(e => {
        const c = limpar(e.categoria_id);
        return c === 'led' || c.includes('led') || c.includes('painel');
      }),
      tv: equipamentos.filter(e => limpar(e.categoria_id) === 'tv'),
      sound: equipamentos.filter(e => limpar(e.categoria_id) === 'sound'),
      light: equipamentos.filter(e => limpar(e.categoria_id) === 'light'),
      truss: equipamentos.filter(e => limpar(e.categoria_id) === 'truss'),
      acc: equipamentos.filter(e => limpar(e.categoria_id) === 'acc'),
      mon: equipamentos.filter(e => limpar(e.categoria_id) === 'mon'),
      touch: equipamentos.filter(e => limpar(e.categoria_id) === 'touch'),
    };
  }, [equipamentos]);

  // Atualizar o modelo selecionado automaticamente ao trocar de aba técnica
  useEffect(() => {
    if (equipType !== 'led') {
      const primeiroDoSetor = dbSetores[equipType as keyof typeof dbSetores]?.[0];
      setSelectedModelId(primeiroDoSetor?.id || '');
      setQuantity(1);
    }
  }, [equipType, dbSetores]);

  // 3. Lógica matemática de simulação em tempo real
  const currentItemDraft = useMemo((): ItemProjeto | null => {
    if (loading) return null;

    if (equipType === 'led') {
      const selectedLed = dbSetores.led.find(e => e.id === ledConfig.pitchId);
      if (!selectedLed) return null;

      const cols = Math.ceil(ledConfig.width / 0.5);
      const rows = Math.ceil(ledConfig.height / 0.5);
      const actualW = cols * 0.5;
      const actualH = rows * 0.5;
      const totalCabinets = cols * rows;

      const pesoTotal = totalCabinets * (selectedLed.peso || 0);
      const consumoTotal = totalCabinets * (selectedLed.consumo_watts || 0);

      const panelRes = parseInt(selectedLed.resolucao || '128');
      const resX = cols * panelRes;
      const resY = rows * panelRes;
      const totalPixels = resX * resY;
      const portasNecessarias = Math.ceil(totalPixels / 650000) || 1;

      return {
        id: selectedLed.id,
        qty: 1,
        name: `Painel de LED ${selectedLed.nome}`,
        details: `${actualW}m x ${actualH}m (${totalCabinets} Módulos) | Res: ${resX}x${resY}px | ${portasNecessarias} Porta(s) Novastar`,
        weight: pesoTotal,
        watts: consumoTotal,
        image: selectedLed.imagem_url || '/logo.png'
      };
    } else {
      const setorItens = dbSetores[equipType as keyof typeof dbSetores] || [];
      const selectedDev = setorItens.find(e => e.id === selectedModelId);
      if (!selectedDev) return null;

      const qty = Math.max(1, quantity);
      const pesoTotal = (selectedDev.peso || 0) * qty;
      const consumoTotal = (selectedDev.consumo_watts || 0) * qty;
      const extra = selectedDev.resolucao || selectedDev.dmx || selectedDev.detalhes || 'Equipamento Audiovisual';

      return {
        id: selectedDev.id,
        qty,
        name: selectedDev.nome,
        details: extra,
        weight: pesoTotal,
        watts: consumoTotal,
        image: selectedDev.imagem_url || '/logo.png'
      };
    }
  }, [equipType, ledConfig, selectedModelId, quantity, dbSetores, loading]);

  // 4. Lógica de acionamento do Modal de Acessórios Relacionais
  const iniciarAdicaoProjeto = () => {
    if (!currentItemDraft) return;

    const limpar = (id: string | null) => (id || '').toLowerCase().trim();
    const accIdsSugeridos = gatilhos
      .filter(g => {
        const catGatilho = limpar(g.categoria_alvo_id);
        const catAtual = limpar(equipType);
        return catGatilho === catAtual || (catAtual === 'led' && (catGatilho.includes('led') || catGatilho.includes('painel'))) || g.equipamento_alvo_id === currentItemDraft.id;
      })
      .map(g => g.acessorio_id);

    const accsParaMostrar = dbSetores.acc.filter(a => accIdsSugeridos.includes(a.id));

    if (accsParaMostrar.length > 0) {
      setRecommendedAccs(accsParaMostrar);
      const inicial: typeof modalSelections = {};
      accsParaMostrar.forEach(acc => {
        const ehProcessadora = acc.nome.toLowerCase().includes('processadora');
        inicial[acc.id] = {
          checked: false,
          qty: ehProcessadora ? 1 : (currentItemDraft.qty === 1 ? 2 : currentItemDraft.qty)
        };
      });
      setModalSelections(inicial);
      setModalOpen(true);
    } else {
      finalizarAdicaoProjeto(false);
    }
  };

  const finalizarAdicaoProjeto = (incluirAcessorios: boolean) => {
    setModalOpen(false);
    const novosItens = [ ...projectList ];
    if (currentItemDraft) novosItens.push({ ...currentItemDraft });

    if (incluirAcessorios) {
      Object.keys(modalSelections).forEach(accId => {
        const selecao = modalSelections[accId];
        if (selecao.checked) {
          const accItem = dbSetores.acc.find(a => a.id === accId);
          if (accItem) {
            novosItens.push({
              id: accItem.id,
              qty: selecao.qty,
              name: accItem.nome,
              details: accItem.detalhes || 'Acessório de Infraestrutura',
              weight: (accItem.peso || 0) * selecao.qty,
              watts: (accItem.consumo_watts || 0) * selecao.qty,
              image: accItem.imagem_url || '/logo.png'
            });
          }
        }
      });
    }
    setProjectList(novosItens);
  };

  const totaisProjeto = useMemo(() => {
    let peso = 0; let watts = 0;
    projectList.forEach(item => { peso += item.weight; watts += item.watts; });
    const kva = (watts / 1000) / 0.8;
    return { peso, watts, kva };
  }, [projectList]);

  return (
    <div className="flex flex-col lg:flex-row gap-6 px-4 md:px-6 pb-4 md:pb-6 pt-2 bg-[#F0F4F8] text-[#0F172A] h-screen overflow-hidden font-sans print:bg-white print:text-black print:block">
      <Analytics/>
      
      {/* MODAL DE SUGESTÃO DE ACESSÓRIOS */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/50 z-[2000] flex items-center justify-center backdrop-blur-sm print:hidden p-4">
          <div className="bg-white border border-[#E2E8F0] p-6 md:p-8 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh]">
            <h3 className="text-xl font-black text-[#0C1D4D] uppercase tracking-tight mb-2">Acessórios Recomendados</h3>
            <p className="text-sm text-[#64748B] mb-6">A engenharia da Rentech sugere os seguintes periféricos para o seu setup:</p>
            
            <div className="overflow-y-auto flex-grow space-y-3 pr-2">
              {recommendedAccs.map(acc => (
                <div key={acc.id} className="flex items-center gap-4 bg-[#F8FAFC] p-4 rounded-xl border border-[#E2E8F0] hover:border-[#336699] transition-colors shadow-sm">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 rounded border-gray-300 text-[#336699] focus:ring-[#336699] cursor-pointer"
                    checked={modalSelections[acc.id]?.checked || false}
                    onChange={(e) => setModalSelections({
                      ...modalSelections,
                      [acc.id]: { ...modalSelections[acc.id], checked: e.target.checked }
                    })}
                  />
                  <div className="flex-grow">
                    <strong className="block text-sm text-[#0C1D4D]">{acc.nome}</strong>
                    <span className="text-[11px] text-[#64748B] font-medium">{acc.detalhes}</span>
                  </div>
                  <input 
                    type="number" 
                    min="1" 
                    className="w-16 p-2 bg-white text-center text-[#0C1D4D] border border-[#CBD5E1] rounded-md font-bold text-sm outline-none focus:border-[#336699]"
                    value={modalSelections[acc.id]?.qty || 1}
                    onChange={(e) => setModalSelections({
                      ...modalSelections,
                      [acc.id]: { ...modalSelections[acc.id], qty: parseInt(e.target.value) || 1 }
                    })}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-4 mt-8">
              <button onClick={() => finalizarAdicaoProjeto(false)} className="bg-[#E2E8F0] text-[#64748B] p-3.5 rounded-xl font-black uppercase text-xs hover:bg-[#CBD5E1] transition-colors">Pular</button>
              <button onClick={() => finalizarAdicaoProjeto(true)} className="bg-[#336699] text-white p-3.5 rounded-xl font-black uppercase text-xs hover:bg-[#284B8C] transition-colors shadow-lg shadow-[#336699]/30">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR TÉCNICA */}
      <aside className="bg-white p-5 rounded-2xl shadow-sm w-full lg:w-80 flex-shrink-0 flex flex-col border border-[#E2E8F0] overflow-y-auto print:hidden">
        
        <div className="bg-[#F0F4F8] p-4 rounded-xl mb-5 border-l-4 border-l-[#336699]">
          <label className="block text-[#0C1D4D] font-black text-[10px] tracking-widest uppercase mb-2">Setor do Projeto</label>
          <select 
            value={equipType} 
            onChange={(e) => setEquipType(e.target.value)}
            className="w-full p-2.5 bg-white border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] focus:ring-1 focus:ring-[#336699] outline-none font-bold shadow-sm transition-all cursor-pointer"
          >
            <option value="led">Painel de Led Modular</option>
            <option value="tv">Televisores</option>
            <option value="mon">Monitores</option>
            <option value="touch">Telas Interativas</option>
            <option value="sound">Sistemas de Som</option>
            <option value="light">Sistemas de Luz</option>
            <option value="truss">Estrutura</option>
            <option value="acc">Acessórios Livres</option>
          </select>
        </div>

        {equipType === 'led' ? (
          <div className="space-y-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-[#0C1D4D] border-b border-[#E2E8F0] pb-2">Configurações LED</h3>
            <div>
              <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Largura do Painel (m)</label>
              <input type="number" step="0.5" min="0.5" className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-semibold focus:border-[#336699] focus:bg-white outline-none transition-all" value={ledConfig.width} onChange={(e) => setLedConfig({ ...ledConfig, width: parseFloat(e.target.value) || 0.5 })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Altura do Painel (m)</label>
              <input type="number" step="0.5" min="0.5" className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-semibold focus:border-[#336699] focus:bg-white outline-none transition-all" value={ledConfig.height} onChange={(e) => setLedConfig({ ...ledConfig, height: parseFloat(e.target.value) || 0.5 })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Formato Estrutural</label>
              <select className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-semibold focus:border-[#336699] focus:bg-white outline-none transition-all cursor-pointer" value={ledConfig.shape} onChange={(e) => setLedConfig({ ...ledConfig, shape: e.target.value })}>
                <option value="reto">Reto Padrão</option>
                <option value="curvo">Curvo (Côncavo)</option>
                <option value="quina">Quina (90 Graus)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Modelo da Placa (Pitch)</label>
              <select 
                className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-semibold focus:border-[#336699] focus:bg-white outline-none transition-all cursor-pointer" 
                value={ledConfig.pitchId} 
                onChange={(e) => setLedConfig({ ...ledConfig, pitchId: e.target.value })}
              >
                {dbSetores.led.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.nome} {l.resolucao ? `(${l.resolucao}px)` : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-[#0C1D4D] border-b border-[#E2E8F0] pb-2">Seleção de Aparelhos</h3>
            <div>
              <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Modelo</label>
              <select className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-semibold focus:border-[#336699] focus:bg-white outline-none transition-all cursor-pointer" value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
                {dbSetores[equipType as keyof typeof dbSetores]?.map(item => (
                  <option key={item.id} value={item.id}>{item.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Quantidade Solicitada</label>
              <input type="number" min="1" className="w-full p-2 bg-[#F8FAFC] border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] font-semibold focus:border-[#336699] focus:bg-white outline-none transition-all" value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} />
            </div>
          </div>
        )}

        <div className="mt-6 pt-5 border-t border-dashed border-[#CBD5E1] space-y-3">
          <div>
            <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Nome do Evento</label>
            <input type="text" placeholder="Ex: Convenção" className="w-full p-2 bg-white border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={clientData.evento} onChange={(e) => setClientData({ ...clientData, evento: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#64748B] uppercase tracking-wider mb-1 block">Razão Social / Cliente</label>
            <input type="text" placeholder="Ex: Rentech Locadora" className="w-full p-2 bg-white border border-[#CBD5E1] rounded-lg text-xs text-[#0F172A] focus:border-[#336699] outline-none" value={clientData.cliente} onChange={(e) => setClientData({ ...clientData, cliente: e.target.value })} />
          </div>
        </div>

        <div className="mt-auto pt-6 space-y-2 pb-2">
          <button onClick={iniciarAdicaoProjeto} disabled={loading || !currentItemDraft} className="w-full bg-[#16A34A] text-white p-3 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#15803D] hover:shadow-lg hover:shadow-green-600/20 transition-all disabled:opacity-50">
            ➕ Adicionar Projeto
          </button>
          <button onClick={() => window.print()} className="w-full border-2 border-[#E2E8F0] text-[#64748B] p-3 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#F8FAFC] hover:border-[#CBD5E1] transition-colors">
            🖨️ Imprimir Proposta
          </button>
        </div>
      </aside>

      {/* ESPAÇO DE TRABALHO CENTRAL */}
      <main className="flex-grow flex flex-col gap-5 relative print:p-0 overflow-y-auto pb-6 pr-2">
        
        {/* Header de Impressão Profissional */}
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-6">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight text-black">Relatório de Engenharia Audiovisual</h2>
            <p className="text-sm text-gray-600">{clientData.evento && `Evento: ${clientData.evento}`} {clientData.cliente && `| Cliente: ${clientData.cliente}`}</p>
          </div>
        </div>

        {/* Barra de Navegação Interna da Aplicação */}
        <div className="flex justify-end print:hidden flex-shrink-0">
          <button 
            onClick={() => setIsProjectView(!isProjectView)}
            className="bg-[#0C1D4D] text-white font-black uppercase text-[10px] tracking-widest px-5 py-2.5 rounded-lg flex gap-3 items-center hover:bg-[#284B8C] transition-all shadow-md hover:shadow-lg"
          >
            {isProjectView ? '⚙️ Voltar ao Simulador' : '📋 Ver Lista Técnica'}
            <span className="bg-white text-[#0C1D4D] font-black rounded-md px-2 py-0.5 text-[10px] shadow-sm">{projectList.length}</span>
          </button>
        </div>

        {/* AQUI COMEÇA O BLOCO VERTICALMENTE REDUZIDO */}
        {!isProjectView ? (
          <div className="flex flex-col gap-3 flex-grow min-h-0">
            <h3 className="text-lg font-black text-[#0C1D4D] tracking-tight uppercase print:hidden flex-shrink-0">Monitoramento do Equipamento</h3>
            
            <div className="flex-grow bg-[#F8FAFC] border border-[#E2E8F0] rounded-2xl flex items-center justify-center p-4 relative overflow-hidden min-h-[200px] bg-[radial-gradient(#CBD5E1_1px,transparent_1px)] bg-[size:24px_24px] print:border-none print:h-[250px] shadow-inner">
              {loading && (
                <div className="absolute inset-0 bg-white/80 z-50 flex flex-col items-center justify-center rounded-2xl backdrop-blur-sm">
                  <div className="w-8 h-8 border-4 border-[#E2E8F0] border-t-[#336699] rounded-full animate-spin mb-2 shadow-sm"></div>
                  <strong className="text-[#0C1D4D] text-[10px] font-black uppercase tracking-widest">Acessando Banco...</strong>
                </div>
              )}

              {!loading && currentItemDraft && (
                <div className={`w-56 h-36 bg-[#0C1D4D] border-2 border-[#336699] shadow-[0_10px_30px_rgba(12,29,77,0.25)] flex flex-col items-center justify-center p-3 transition-all rounded-xl text-center ${ledConfig.shape === 'curvo' ? 'scale-x-95 rotate-y-12' : ''}`}>
                  <span className="text-[8px] font-black text-[#60A5FA] tracking-widest uppercase mb-1.5">Simulação Rentech</span>
                  <strong className="text-white text-sm font-black leading-tight mb-1.5">{currentItemDraft.name}</strong>
                  <span className="text-[9px] text-[#94A3B8] block px-2 leading-relaxed">{currentItemDraft.details}</span>
                </div>
              )}
            </div>

            {/* Cards Rápidos de Telemetria Técnica - Mais finos e limpos */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 flex-shrink-0">
              <div className="bg-white p-3 rounded-xl shadow-sm border border-[#E2E8F0] border-t-4 border-t-[#336699] hover:shadow-md transition-shadow">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1">Métrica de Corte</span>
                <strong className="block text-base text-[#0C1D4D] font-black">{equipType === 'led' ? `${Math.ceil(ledConfig.width/0.5)*0.5}m x ${Math.ceil(ledConfig.height/0.5)*0.5}m` : 'Unidade Física'}</strong>
              </div>
              <div className="bg-white p-3 rounded-xl shadow-sm border border-[#E2E8F0] border-t-4 border-t-[#336699] hover:shadow-md transition-shadow">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1">Carga de Peso</span>
                <strong className="block text-base text-[#0C1D4D] font-black">{currentItemDraft?.weight.toFixed(1) || '0.0'} kg</strong>
              </div>
              <div className="bg-white p-3 rounded-xl shadow-sm border border-[#E2E8F0] border-t-4 border-t-[#336699] hover:shadow-md transition-shadow">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1">Potência Nominal</span>
                <strong className="block text-base text-[#0C1D4D] font-black">{currentItemDraft?.watts || '0'} W</strong>
              </div>
              <div className="bg-white p-3 rounded-xl shadow-sm border border-[#E2E8F0] border-t-4 border-t-[#16A34A] hover:shadow-md transition-shadow">
                <span className="block text-[9px] text-[#64748B] uppercase font-bold tracking-wider mb-1">Demanda Gerador</span>
                <strong className="block text-base text-[#16A34A] font-black">{currentItemDraft ? ((currentItemDraft.watts / 1000) / 0.8).toFixed(2) : '0.00'} kVA</strong>
              </div>
            </div>
          </div>
        ) : (
          /* View da Tabela Estruturada do Projeto */
          <div className="bg-white p-6 md:p-8 rounded-2xl border border-[#E2E8F0] shadow-sm flex-col flex flex-grow min-h-0 print:border-none print:p-0 print:shadow-none">
            <div className="flex justify-between items-center border-b border-[#E2E8F0] pb-4 mb-4 flex-shrink-0">
              <h2 className="text-lg font-black text-[#0C1D4D] uppercase tracking-wider">Especificação da Carga</h2>
              <button onClick={() => { if(confirm('Limpar o projeto inteiro?')) setProjectList([]); }} className="text-[10px] font-bold text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg transition-colors print:hidden uppercase tracking-wider">🗑️ Limpar</button>
            </div>

            <div className="overflow-y-auto flex-grow pr-2">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-[#64748B] text-[10px] uppercase font-bold tracking-wider border-b-2 border-[#E2E8F0] bg-[#F8FAFC]">
                    <th className="p-3 rounded-tl-lg">Qtd</th>
                    <th className="p-3">Equipamento Especificado</th>
                    <th className="p-3">Detalhes Técnicos</th>
                    <th className="p-3">Peso</th>
                    <th className="p-3">Consumo</th>
                    <th className="p-3 text-center rounded-tr-lg print:hidden">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0] text-xs">
                  {projectList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-[#94A3B8] font-semibold text-sm">Nenhum equipamento adicionado à lista.</td>
                    </tr>
                  ) : (
                    projectList.map((item, idx) => (
                      <tr key={idx} className="hover:bg-[#F8FAFC] transition-colors text-[#0F172A] print:text-black">
                        <td className="p-3 font-black text-[#336699] text-sm">{item.qty}x</td>
                        <td className="p-3 font-black">{item.name}</td>
                        <td className="p-3 text-[10px] text-[#64748B] font-medium print:text-gray-600">{item.details}</td>
                        <td className="p-3 font-bold">{item.weight.toFixed(1)} kg</td>
                        <td className="p-3 text-[#336699] font-bold">{item.watts} W</td>
                        <td className="p-3 text-center print:hidden">
                          <button onClick={() => setProjectList(projectList.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 hover:bg-red-50 p-1.5 rounded-md transition-all text-sm">🗑️</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Rodapé Consolidado */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-[#F8FAFC] border border-[#E2E8F0] p-5 rounded-xl mt-6 flex-shrink-0 print:bg-gray-100 print:text-black print:border-black">
              <div>
                <span className="block text-[10px] text-[#64748B] font-bold uppercase mb-1">Peso Bruto Volumétrico</span>
                <strong className="text-xl text-[#0C1D4D] font-black print:text-black">{totaisProjeto.peso.toFixed(1)} kg</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#64748B] font-bold uppercase mb-1">Carga Elétrica Nominal</span>
                <strong className="text-xl text-[#336699] font-black">{totaisProjeto.watts} W</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#64748B] font-bold uppercase text-[#16A34A] mb-1">Mínimo para Gerador</span>
                <strong className="text-xl text-[#16A34A] font-black">{totaisProjeto.kva.toFixed(2)} kVA</strong>
              </div>
            </div>
          </div>
        )}

        {/* Termo Técnico Legal OBRIGATÓRIO no PDF/Impressão */}
        <div className="hidden print:block mt-8 p-4 border-2 border-dashed border-gray-400 text-center bg-gray-50 text-xs font-bold rounded-lg text-gray-600 flex-shrink-0">
          * Todo conteúdo audiovisual deve ser enviado previamente em pendrive e entregue aos técnicos da Rentech no dia dos testes estruturais.
        </div>
      </main>

    </div>
  );
}