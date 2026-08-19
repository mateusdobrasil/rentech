// Categorias da Rentech Academy — fixas no código (diferente dos artigos,
// que agora vêm da tabela academy_artigos e são geridos em /admin/academy).

export type CategoriaId = 'tv' | 'led' | 'som' | 'luz' | 'estrutura' | 'monitor-touch';

export interface Categoria {
  id: CategoriaId;
  label: string;
  icone: string;
  descricao: string;
}

export const CATEGORIAS: Categoria[] = [
  { id: 'tv', label: 'TVs', icone: '📺', descricao: 'Instalação, suportes e sinal de vídeo' },
  { id: 'led', label: 'Painéis de LED', icone: '🟦', descricao: 'Video wall, pitch e montagem' },
  { id: 'som', label: 'Som', icone: '🔊', descricao: 'Sonorização, cabeamento e cobertura' },
  { id: 'luz', label: 'Luz', icone: '💡', descricao: 'Iluminação cênica e DMX' },
  { id: 'estrutura', label: 'Estrutura', icone: '🏗️', descricao: 'Truss, rigging e fixação' },
  { id: 'monitor-touch', label: 'Monitor Touch', icone: '👆', descricao: 'Instalação e calibração de telas touch' },
];

export const NIVEIS = ['Básico', 'Intermediário', 'Avançado'] as const;
export const PUBLICOS = ['Técnico', 'Comercial', 'Técnico e Comercial'] as const;

export interface Secao {
  titulo: string;
  texto?: string;
  lista?: string[];
}

export interface Artigo {
  id: number;
  slug: string;
  categoria: CategoriaId;
  titulo: string;
  resumo: string;
  nivel: (typeof NIVEIS)[number];
  publico: (typeof PUBLICOS)[number];
  tempo_leitura: string;
  video_url: string | null;
  secoes: Secao[];
  checklist: string[] | null;
  ordem: number;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

export function getCategoria(id: CategoriaId): Categoria | undefined {
  return CATEGORIAS.find((c) => c.id === id);
}
