import type { EstadoFisico, PapelUsuario, StatusLote, StatusRastreamento, TipoEquipamento } from "@prisma/client";

export interface Paginacao { pagina?: number; limite?: number }
export interface Periodo { inicio?: string; fim?: string }
export interface DadosContrato {
  dataAssinatura: string;
  dataVencimento: string;
  clausulas: string[];
  valorMensal: string;
  renovacaoAutomatica?: boolean;
}
export interface DadosOrganizacao {
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual?: string;
  enderecoCompleto: string;
  telefone: string;
  email: string;
  contrato?: DadosContrato;
}
export type AlteracaoOrganizacao = Partial<Omit<DadosOrganizacao, "contrato" | "cnpj">> & { versao: number; ativo?: boolean };
export interface DadosEquipamento {
  codigoBarrasInterno?: string;
  tipo: TipoEquipamento;
  marca: string;
  modelo: string;
  anoFabricacao: number;
  estadoFisico: EstadoFisico;
  pesoQuilogramas: string;
}
export interface DadosLote {
  organizacaoId: string;
  dataEntrada: string;
  notaFiscal: string;
  transportadora: string;
  observacoes?: string;
  equipamentos?: DadosEquipamento[];
}
export interface FiltroLotes extends Paginacao, Periodo { organizacaoId?: string; status?: StatusLote }
export interface FiltroEquipamentos extends Paginacao { loteId?: string; status?: StatusRastreamento; codigoBarrasInterno?: string }
export interface DadosUsuario { usuario: string; senha: string; papel: PapelUsuario }
