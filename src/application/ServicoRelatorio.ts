import { Prisma, type StatusRastreamento } from "@prisma/client";
import { autorizar, type UsuarioAutenticado } from "../domain/autorizacao.js";
import type { Paginacao } from "../domain/dados.js";
import { encontrado } from "../domain/erros.js";
import { RegrasEquipamento } from "../domain/RegrasEquipamento.js";
import { validarPeriodo } from "../domain/validacoes.js";
import { BancoDados } from "../infrastructure/BancoDados.js";

export class ServicoRelatorio {
  constructor(private readonly banco: BancoDados) {}

  porOrganizacao(ator: UsuarioAutenticado, organizacaoId: string, inicio: string, fim: string) {
    autorizar(ator, "AUDITOR");
    const periodo = validarPeriodo(inicio, fim);
    return this.banco.transacao(async repos => {
      const organizacao = encontrado(await repos.organizacoes.buscar(organizacaoId), "Organização");
      const lotes = await repos.lotes.listarParaRelatorio(organizacaoId, periodo);
      const equipamentos = lotes.flatMap(lote => lote.equipamentos);
      return {
        organizacao, periodo: { inicio, fim }, totalLotes: lotes.length, totalEquipamentos: equipamentos.length,
        pesoTotalQuilogramas: equipamentos.reduce((soma, item) => soma.plus(item.pesoQuilogramas), new Prisma.Decimal(0)).toFixed(3),
        lotes: lotes.map(lote => ({ ...lote, equipamentos: lote.equipamentos.map(item => ({
          ...item, depreciacaoPercentual: RegrasEquipamento.calcularDepreciacao(item.anoFabricacao, item.estadoFisico),
        })) })),
      };
    });
  }

  porStatus(ator: UsuarioAutenticado, status: StatusRastreamento, filtro: Paginacao) {
    autorizar(ator, "AUDITOR");
    return this.banco.repositorios.equipamentos.listar({ statusRastreamento: status }, filtro);
  }

  financeiro(ator: UsuarioAutenticado, inicio: string, fim: string) {
    autorizar(ator, "AUDITOR");
    const periodo = validarPeriodo(inicio, fim);
    return this.banco.transacao(async repos => {
      const contratos = await repos.contratos.listarVigentesNoPeriodo(periodo.gte!, periodo.lte!);
      return {
        periodo: { inicio, fim }, moeda: "BRL", totalContratos: contratos.length,
        valorMensalTotal: contratos.reduce((soma, contrato) => soma.plus(contrato.valorMensal), new Prisma.Decimal(0)).toFixed(2),
        criterio: "Soma das mensalidades dos contratos cuja vigência intersecta o período; não representa faturamento realizado nem receita proporcional.",
        contratos,
      };
    });
  }

  auditoria(ator: UsuarioAutenticado, filtro: Paginacao & { entidade?: string; entidadeId?: string }) {
    autorizar(ator, "AUDITOR");
    return this.banco.repositorios.auditoria.listar(filtro);
  }
}
