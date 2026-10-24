import { EstadoFisico, StatusLote, StatusRastreamento } from "@prisma/client";
import { exigir } from "./erros.js";

const transicoes: Record<StatusRastreamento, StatusRastreamento[]> = {
  AGUARDANDO_TRIAGEM: [],
  EM_TRIAGEM: [],
  AGUARDANDO_DESMONTE: ["EM_DESMONTE", "PECAS_REAPROVEITADAS", "DESCARTE_SEGURO"],
  EM_DESMONTE: ["PECAS_REAPROVEITADAS", "MATERIAL_RECICLAVEL", "DESCARTE_SEGURO"],
  PECAS_REAPROVEITADAS: ["BAIXA_DEFINITIVA"],
  MATERIAL_RECICLAVEL: ["BAIXA_DEFINITIVA"],
  DESCARTE_SEGURO: ["BAIXA_DEFINITIVA"],
  BAIXA_DEFINITIVA: [],
};

export class RegrasEquipamento {
  static validarStatus(atual: StatusRastreamento, novo: StatusRastreamento, lote: StatusLote, justificativa: string): void {
    exigir(lote === "TRIAGEM_CONCLUIDA" || lote === "ENCAMINHADO", "Conclua a triagem do lote antes de destinar o equipamento.");
    exigir(transicoes[atual].includes(novo), `Transição de ${atual} para ${novo} não permitida.`);
    exigir(justificativa.trim(), "A justificativa da mudança de status é obrigatória.");
  }

  static validarEstado(atual: EstadoFisico, novo: EstadoFisico, justificativa?: string): void {
    exigir(atual !== novo, "O equipamento já possui este estado físico.");
    const ordem = Object.values(EstadoFisico);
    if (ordem.indexOf(novo) - ordem.indexOf(atual) >= 2) {
      exigir(justificativa?.trim(), "Justifique o rebaixamento de duas ou mais categorias do estado físico.");
    }
  }

  static calcularDepreciacao(anoFabricacao: number, estado: EstadoFisico, anoAtual = new Date().getUTCFullYear()): number {
    const penalidade: Record<EstadoFisico, number> = {
      NOVO: 0, BOM_ESTADO: 10, USADO_LEVE: 20, USADO_MODERADO: 40,
      DANIFICADO_LEVE: 60, DANIFICADO_GRAVE: 80, INSERVIVEL: 100,
    };
    return Math.min(100, Math.max(0, anoAtual - anoFabricacao) * 10 + penalidade[estado]);
  }
}
