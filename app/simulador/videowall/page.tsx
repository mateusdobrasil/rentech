"use client";

import { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import logoColorido from '../../../app/imgs/logo.png';
import logoPB from '../../../app/imgs/logo_pb.png';
import { supabase } from '../../lib/supabase';

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
    pitchId: '' // Armazenará o ID do painel de LED selecionado
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

        // Busca equipamentos ativos
        const { data: equipData, error: equipError } = await supabase
          .from('equipamentos')
          .select('*')
          .eq('ativo', true);

        // Busca regras de gatilhos automáticos
        const { data: gatilhosData, error: gatilhosError } = await supabase
          .from('gatilhos_acessorios')
          .select('*');

        if (equipError) throw equipError;
        if (gatilhosError) throw gatilhosError;

        setEquipamentos(equipData || []);
        setGatilhos(gatilhosData || []);

        // Define seleções iniciais padrão baseadas nos dados retornados
        const primeiroLed = equipData?.find(e => e.categoria_id === 'led');
        if (primeiroLed) setLedConfig(prev => ({ ...prev, pitchId: primeiroLed.id }));

        const primeiroTv = equipData?.find(e => e.categoria_id === 'tv');
        if (primeiroTv) setSelectedModelId(primeiroTv.id);

      } catch (error) {
        console.error("Erro crítico ao conectar com o Supabase:", error);
      } finally {
        setLoading(false);
      }
    }
    loadSupabaseData();
  }, []);

  // 2. Organizar equipamentos por setores usando Memoization para performance
  const dbSetores = useMemo(() => {
    return {
      led: equipamentos.filter(e => e.categoria_id === 'led'),
      tv: equipamentos.filter(e => e.categoria_id === 'tv'),
      sound: equipamentos.filter(e => e.categoria_id === 'sound'),
      light: equipamentos.filter(e => e.categoria_id === 'light'),
      truss: equipamentos.filter(e => e.categoria_id === 'truss'),
      acc: equipamentos.filter(e => e.categoria_id === 'acc'),
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

  // 3. Lógica matemática de simulação em tempo real (Painel de LED ou Monitores)
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

      // Extrai resolução interna do painel (Padrão 128x128px se não preenchido)
      const panelRes = parseInt(selectedLed.resolucao || '128');
      const resX = cols * panelRes;
      const resY = rows * panelRes;
      const totalPixels = resX * resY;
      const portasNecessarias = Math.ceil(totalPixels / 650000) || 1;

      return {
        id: selectedLed.id,
        qty: 1,
        name: `Painel de LED ${selectedLed.nome}`,
        details: `${actualW}m x ${actualH}m (${totalCabinets} Módulos de 50cm) | Res: ${resX}x${resY}px | ${portasNecessarias} Porta(s) Novastar`,
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

  // 4. Lógica de acionamento do Modal de Acessórios Relacionais (Inteligência Artificial)
  const iniciarAdicaoProjeto = () => {
    if (!currentItemDraft) return;

    // Procura na tabela de gatilhos do Supabase se o item atual dispara sugestões
    const accIdsSugeridos = gatilhos
      .filter(g => g.categoria_alvo_id === equipType || g.equipamento_alvo_id === currentItemDraft.id)
      .map(g => g.acessorio_id);

    const accsParaMostrar = dbSetores.acc.filter(a => accIdsSugeridos.includes(a.id));

    if (accsParaMostrar.length > 0) {
      setRecommendedAccs(accsParaMostrar);
      
      // Monta o estado inicial das seleções dentro do modal
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

  // Totais consolidados da listagem técnica
  const totaisProjeto = useMemo(() => {
    let peso = 0; let watts = 0;
    projectList.forEach(item => {
      peso += item.weight;
      watts += item.watts;
    });
    const kva = (watts / 1000) / 0.8; // Fator de potência de geradores profissionais
    return { peso, watts, kva };
  }, [projectList]);

  return (
    <div className="flex flex-col lg:flex-row gap-4 p-4 bg-[#000000] text-[#B3B3B3] min-h-screen font-sans print:bg-white print:text-black print:block">
      
      {/* MODAL DE SUGESTÃO DE ACESSÓRIOS */}
      {modalOpen && (
        <div className="fixed inset-0 bg-[#000000]/80 z-[2000] flex items-center justify-center backdrop-blur-sm print:hidden">
          <div className="bg-[#0C1D4D] border border-[#284B8C] p-6 rounded-2xl w-full max-w-md shadow-2xl flex flex-col max-h-[85vh]">
            <h3 className="text-xl font-black text-white uppercase tracking-tight mb-1">Acessórios Recomendados</h3>
            <p className="text-xs text-[#999999] mb-4">A engenharia da Rentech sugere os seguintes periféricos para o seu setup:</p>
            
            <div className="overflow-y-auto flex-grow space-y-3 pr-2">
              {recommendedAccs.map(acc => (
                <div key={acc.id} className="flex items-center gap-4 bg-black/40 p-3 rounded-xl border border-[#284B8C]/30 hover:border-[#336699] transition-colors">
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 rounded accent-[#336699] cursor-pointer"
                    checked={modalSelections[acc.id]?.checked || false}
                    onChange={(e) => setModalSelections({
                      ...modalSelections,
                      [acc.id]: { ...modalSelections[acc.id], checked: e.target.checked }
                    })}
                  />
                  <div className="flex-grow">
                    <strong className="block text-sm text-white">{acc.nome}</strong>
                    <span className="text-[11px] text-[#666666]">{acc.detalhes}</span>
                  </div>
                  <input 
                    type="number" 
                    min="1" 
                    className="w-14 p-1.5 bg-black text-center text-white border border-[#284B8C]/50 rounded-md font-bold text-xs"
                    value={modalSelections[acc.id]?.qty || 1}
                    onChange={(e) => setModalSelections({
                      ...modalSelections,
                      [acc.id]: { ...modalSelections[acc.id], qty: parseInt(e.target.value) || 1 }
                    })}
                  />
                </div>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3 mt-6">
              <button onClick={() => finalizarAdicaoProjeto(false)} className="bg-black/40 text-[#999999] p-3 rounded-lg font-black uppercase text-xs hover:bg-black/60 transition-colors border border-[#284B8C]/30">Pular</button>
              <button onClick={() => finalizarAdicaoProjeto(true)} className="bg-green-600 text-white p-3 rounded-lg font-black uppercase text-xs hover:bg-green-500 transition-colors shadow-lg">Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* SIDEBAR TÉCNICA (Oculta na impressão) */}
      <aside className="bg-[#0C1D4D]/20 p-5 rounded-2xl shadow-xl w-full lg:w-80 flex-shrink-0 flex flex-col border border-[#284B8C]/30 overflow-y-auto backdrop-blur-sm print:hidden">
        <div className="text-center mb-6 pb-6 border-b border-[#284B8C]/30">
          <Link href="/simulador">
            <Image src={logoPB} alt="Rentech Locadora" width={160} height={50} className="mx-auto hover:scale-105 transition-transform" priority />
          </Link>
        </div>

        <div className="bg-[#0C1D4D]/50 p-4 rounded-xl mb-6 border-l-4 border-t border-t-[#284B8C]/20 border-[#336699]">
          <label className="block text-white font-black text-xs tracking-widest uppercase mb-2">Setor do Projeto</label>
          <select 
            value={equipType} 
            onChange={(e) => setEquipType(e.target.value)}
            className="w-full p-2.5 bg-black/60 border border-[#284B8C]/50 rounded-lg text-sm text-white focus:border-[#336699] focus:outline-none font-bold"
          >
            <option value="led">Painel de Led Modular</option>
            <option value="tv">Televisores e Monitores</option>
            <option value="sound">Sistemas de Som</option>
            <option value="light">Sistemas de Luz</option>
            <option value="truss">Estrutura</option>
            <option value="acc">Acessórios Livres</option>
          </select>
        </div>

        {/* Lógica de Interface Dinâmica baseada nos Estados */}
        {equipType === 'led' ? (
          <div className="space-y-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-white border-b border-[#284B8C]/30 pb-2">Configurações LED</h3>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Largura do Painel (m)</label>
              <input type="number" step="0.5" min="0.5" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white" value={ledConfig.width} onChange={(e) => setLedConfig({ ...ledConfig, width: parseFloat(e.target.value) || 0.5 })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Altura do Painel (m)</label>
              <input type="number" step="0.5" min="0.5" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white" value={ledConfig.height} onChange={(e) => setLedConfig({ ...ledConfig, height: parseFloat(e.target.value) || 0.5 })} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Formato Estrutural</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white" value={ledConfig.shape} onChange={(e) => setLedConfig({ ...ledConfig, shape: e.target.value })}>
                <option value="reto">Reto Padrão</option>
                <option value="curvo">Curvo (Côncavo)</option>
                <option value="quina">Quina (90 Graus)</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Modelo da Placa (Pitch)</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white" value={ledConfig.pitchId} onChange={(e) => setLedConfig({ ...ledConfig, pitchId: e.target.value })}>
                {dbSetores.led.map(l => (
                  <option key={l.id} value={l.id}>{l.nome} ({l.resolucao}px)</option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <h3 className="font-black text-xs uppercase tracking-widest text-white border-b border-[#284B8C]/30 pb-2">Seleção de Aparelhos</h3>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Modelo</label>
              <select className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white" value={selectedModelId} onChange={(e) => setSelectedModelId(e.target.value)}>
                {dbSetores[equipType as keyof typeof dbSetores]?.map(item => (
                  <option key={item.id} value={item.id}>{item.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Quantidade Solicitada</label>
              <input type="number" min="1" className="w-full p-2.5 bg-black border border-[#284B8C]/40 rounded-lg text-sm text-white" value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 1)} />
            </div>
          </div>
        )}

        <div className="mt-6 pt-4 border-t border-dashed border-[#284B8C]/30 space-y-3">
          <div>
            <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Nome do Evento</label>
            <input type="text" placeholder="Ex: Convenção Nacional" className="w-full p-2.5 bg-black border border-[#284B8C]/30 rounded-lg text-xs text-white" value={clientData.evento} onChange={(e) => setClientData({ ...clientData, evento: e.target.value })} />
          </div>
          <div>
            <label className="text-[10px] font-bold text-[#999999] uppercase tracking-wider mb-1 block">Razão Social / Cliente</label>
            <input type="text" placeholder="Ex: Marca Corporativa" className="w-full p-2.5 bg-black border border-[#284B8C]/30 rounded-lg text-xs text-white" value={clientData.cliente} onChange={(e) => setClientData({ ...clientData, cliente: e.target.value })} />
          </div>
        </div>

        <div className="mt-auto pt-8 space-y-2">
          <button onClick={iniciarAdicaoProjeto} disabled={loading || !currentItemDraft} className="w-full bg-green-600 text-white p-3.5 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-green-500 hover:shadow-[0_0_15px_rgba(22,163,74,0.4)] transition-all disabled:opacity-30">
            ➕ Adicionar ao Projeto
          </button>
          <button onClick={() => window.print()} className="w-full border border-[#666666] text-[#B3B3B3] p-3.5 rounded-xl font-black uppercase text-xs tracking-wider hover:bg-[#666666]/10 transition-colors">
            🖨️ Imprimir Proposta
          </button>
        </div>
      </aside>

      {/* ESPAÇO DE TRABALHO CENTRAL */}
      <main className="flex-grow flex flex-col gap-4 relative print:p-0">
        
        {/* Header de Impressão Profissional (Apenas no papel) */}
        <div className="hidden print:flex justify-between items-end border-b-2 border-black pb-4 mb-6">
          <Image src={logoColorido} alt="Rentech Logo" width={180} height={55} />
          <div className="text-right">
            <h2 className="text-xl font-black uppercase tracking-tight">Relatório de Engenharia Audiovisual</h2>
            <p className="text-sm text-gray-600">{clientData.evento && `Evento: ${clientData.evento}`} {clientData.cliente && `| Cliente: ${clientData.cliente}`}</p>
          </div>
        </div>

        {/* Barra de Navegação Interna da Aplicação */}
        <div className="flex justify-end print:hidden">
          <button 
            onClick={() => setIsProjectView(!isProjectView)}
            className="bg-[#284B8C] text-white font-black uppercase text-xs tracking-widest px-6 py-3 rounded-xl flex gap-3 items-center hover:bg-[#336699] transition-all hover:shadow-lg hover:shadow-[#284B8C]/30"
          >
            {isProjectView ? '⚙️ Ver Painel Técnico' : '📋 Ver Lista Técnica'}
            <span className="bg-white text-[#284B8C] font-black rounded-md px-2 py-0.5 text-[10px]">{projectList.length}</span>
          </button>
        </div>

        {!isProjectView ? (
          <div className="flex flex-col gap-4 flex-grow">
            <h3 className="text-xl font-black text-white tracking-tight uppercase print:hidden">Monitoramento do Equipamento</h3>
            
            {/* View do Grid/Simulador 3D do LED */}
            <div className="flex-grow bg-[#0C1D4D]/10 border border-[#284B8C]/30 rounded-2xl flex items-center justify-center p-6 relative backdrop-blur-sm overflow-hidden min-h-[350px] bg-[radial-gradient(#284B8C_1px,transparent_1px)] bg-[size:24px_24px] print:border-none print:h-[350px]">
              {loading && (
                <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center rounded-2xl">
                  <div className="w-12 h-12 border-4 border-[#284B8C] border-t-[#336699] rounded-full animate-spin mb-4"></div>
                  <strong className="text-white text-sm uppercase tracking-widest">Acessando Supabase...</strong>
                </div>
              )}

              {!loading && currentItemDraft && (
                <div className={`w-72 h-52 bg-black border-2 border-[#336699] shadow-[0_0_40px_rgba(51,102,153,0.3)] flex flex-col items-center justify-center p-4 transition-all rounded-lg text-center ${ledConfig.shape === 'curvo' ? 'scale-x-95 rotate-y-12' : ''}`}>
                  <span className="text-xs font-black text-[#336699] tracking-widest uppercase mb-2">Simulação Rentech</span>
                  <strong className="text-white text-lg font-black leading-tight">{currentItemDraft.name}</strong>
                  <span className="text-[10px] text-[#666666] mt-2 block px-4">{currentItemDraft.details}</span>
                </div>
              )}
            </div>

            {/* Cards Rápidos de Telemetria Técnica */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 flex-shrink-0">
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-[#336699]">
                <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1">Métrica de Corte</span>
                <strong className="block text-lg text-white font-black">{equipType === 'led' ? `${Math.ceil(ledConfig.width/0.5)*0.5}m x ${Math.ceil(ledConfig.height/0.5)*0.5}m` : 'Unidade Física'}</strong>
              </div>
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-[#336699]">
                <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1">Carga de Peso</span>
                <strong className="block text-lg text-white font-black">{currentItemDraft?.weight.toFixed(1) || '0.0'} kg</strong>
              </div>
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-[#336699]">
                <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1">Potência de Consumo</span>
                <strong className="block text-lg text-white font-black">{currentItemDraft?.watts || '0'} W</strong>
              </div>
              <div className="bg-[#0C1D4D]/20 p-4 rounded-xl border border-[#284B8C]/30 border-t-4 border-t-green-500">
                <span className="block text-[10px] text-[#999999] uppercase font-bold tracking-wider mb-1">Demanda Mínima</span>
                <strong className="block text-lg text-green-400 font-black">{currentItemDraft ? ((currentItemDraft.watts / 1000) / 0.8).toFixed(2) : '0.00'} kVA</strong>
              </div>
            </div>
          </div>
        ) : (
          /* View da Tabela Estruturada do Projeto */
          <div className="bg-[#0C1D4D]/20 p-6 rounded-2xl border border-[#284B8C]/30 flex-col flex flex-grow backdrop-blur-sm print:bg-transparent print:border-none print:p-0">
            <div className="flex justify-between items-center border-b border-[#284B8C]/40 pb-4 mb-4">
              <h2 className="text-lg font-black text-white uppercase tracking-wider">Especificação da Carga e Equipamentos</h2>
              <button onClick={() => { if(confirm('Limpar o projeto?')) setProjectList([]); }} className="text-xs font-bold text-red-400 hover:text-red-500 print:hidden">🗑️ Reiniciar Projeto</button>
            </div>

            <div className="overflow-x-auto flex-grow">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-[#999999] text-[11px] uppercase font-bold tracking-wider border-b border-[#284B8C]/40 bg-black/20">
                    <th className="p-3">Qtd</th>
                    <th className="p-3">Equipamento Especificado</th>
                    <th className="p-3">Engenharia / Detalhes Técnicos</th>
                    <th className="p-3">Peso Total</th>
                    <th className="p-3">Consumo</th>
                    <th className="p-3 text-center print:hidden">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#284B8C]/20 text-sm">
                  {projectList.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-16 text-[#666666] font-medium">Nenhum equipamento adicionado à lista.</td>
                    </tr>
                  ) : (
                    projectList.map((item, idx) => (
                      <tr key={idx} className="hover:bg-black/10 text-white print:text-black">
                        <td className="p-3 font-black text-[#336699]">{item.qty}x</td>
                        <td className="p-3 font-bold">{item.name}</td>
                        <td className="p-3 text-xs text-[#999999] print:text-gray-600">{item.details}</td>
                        <td className="p-3 font-semibold">{item.weight.toFixed(1)} kg</td>
                        <td className="p-3 text-[#336699] font-semibold">{item.watts} W</td>
                        <td className="p-3 text-center print:hidden">
                          <button onClick={() => setProjectList(projectList.filter((_, i) => i !== idx))} className="text-red-400 text-sm hover:scale-110 transition-transform">🗑️</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Rodapé Consolidado com Cáculo de Geradores */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 bg-black/40 border border-[#284B8C]/40 p-5 rounded-xl mt-6 print:bg-gray-100 print:text-black print:border-black">
              <div>
                <span className="block text-[10px] text-[#999999] font-bold uppercase uppercase">Peso Bruto Volumétrico</span>
                <strong className="text-xl text-white font-black print:text-black">{totaisProjeto.peso.toFixed(1)} kg</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#999999] font-bold uppercase uppercase">Carga Elétrica Nominal</span>
                <strong className="text-xl text-[#336699] font-black">{totaisProjeto.watts} W</strong>
              </div>
              <div>
                <span className="block text-[10px] text-[#999999] font-bold uppercase uppercase text-green-400">Infraestrutura Mínima de Gerador</span>
                <strong className="text-xl text-green-400 font-black">{totaisProjeto.kva.toFixed(2)} kVA</strong>
              </div>
            </div>
          </div>
        )}

        {/* Termo Técnico Legal OBRIGATÓRIO no PDF/Impressão */}
        <div className="hidden print:block mt-8 p-4 border-2 border-dashed border-gray-400 text-center bg-gray-50 text-xs font-bold rounded-lg">
          * Todo conteúdo audiovisual deve ser enviado previamente em pendrive e entregue aos técnicos da Rentech no dia dos testes estruturais.
        </div>
      </main>

    </div>
  );
}