import type { EstadoFisico, Prisma, StatusRastreamento, TipoMovimentacao } from "@prisma/client";
import { autorizar, autorizarConsulta, type UsuarioAutenticado } from "../domain/autorizacao.js";
import type { FiltroEquipamentos } from "../domain/dados.js";
import { conferirVersao, encontrado, exigir } from "../domain/erros.js";
import { RegrasEquipamento } from "../domain/RegrasEquipamento.js";
import { BancoDados } from "../infrastructure/BancoDados.js";
import type { RepositorioEquipamento } from "../infrastructure/repositorios/Repositorios.js";

type EquipamentoCompleto = NonNullable<Awaited<ReturnType<RepositorioEquipamento["buscar"]>>>;
interface Alteracao {
  campos: Prisma.EquipamentoUpdateManyMutationInput;
  tipo: TipoMovimentacao;
  origem: string;
  destino: string;
  observacao: string;
}

export class ServicoEquipamento {
  constructor(private readonly banco: BancoDados) {}

  listar(ator: UsuarioAutenticado, filtro: FiltroEquipamentos) {
    autorizarConsulta(ator);
    return this.banco.repositorios.equipamentos.listar({
      loteId: filtro.loteId, statusRastreamento: filtro.status, codigoBarrasInterno: filtro.codigoBarrasInterno,
    }, filtro);
  }

  async buscar(ator: UsuarioAutenticado, id: string) {
    autorizarConsulta(ator);
    const equipamento = encontrado(await this.banco.repositorios.equipamentos.buscar(id), "Equipamento");
    return { ...equipamento, depreciacaoPercentual: RegrasEquipamento.calcularDepreciacao(equipamento.anoFabricacao, equipamento.estadoFisico) };
  }

  alterarStatus(ator: UsuarioAutenticado, id: string, dados: { versao: number; status: StatusRastreamento; justificativa: string }) {
    return this.alterar(ator, id, dados.versao, equipamento => {
      RegrasEquipamento.validarStatus(equipamento.statusRastreamento, dados.status, equipamento.lote.statusProcessamento, dados.justificativa);
      return { campos: { statusRastreamento: dados.status }, tipo: "STATUS", origem: equipamento.statusRastreamento, destino: dados.status, observacao: dados.justificativa };
    });
  }

  alterarEstado(ator: UsuarioAutenticado, id: string, dados: { versao: number; estadoFisico: EstadoFisico; justificativa?: string }) {
    return this.alterar(ator, id, dados.versao, equipamento => {
      RegrasEquipamento.validarEstado(equipamento.estadoFisico, dados.estadoFisico, dados.justificativa);
      return { campos: { estadoFisico: dados.estadoFisico }, tipo: "ESTADO_FISICO", origem: equipamento.estadoFisico, destino: dados.estadoFisico, observacao: dados.justificativa ?? "Atualização do estado físico." };
    });
  }

  movimentar(ator: UsuarioAutenticado, id: string, dados: { versao: number; destino: string; justificativa: string }) {
    return this.alterar(ator, id, dados.versao, equipamento => {
      const destino = dados.destino.trim();
      exigir(destino && destino !== equipamento.localizacaoAtual, "Informe um destino diferente da localização atual.");
      exigir(dados.justificativa.trim(), "Informe a justificativa da movimentação.");
      return { campos: { localizacaoAtual: destino }, tipo: "LOCALIZACAO", origem: equipamento.localizacaoAtual, destino, observacao: dados.justificativa };
    });
  }

  private alterar(ator: UsuarioAutenticado, id: string, versao: number, preparar: (equipamento: EquipamentoCompleto) => Alteracao) {
    autorizar(ator, "GESTOR_ALMOXARIFADO");
    return this.banco.transacao(async repos => {
      const anterior = encontrado(await repos.equipamentos.buscar(id), "Equipamento");
      conferirVersao(anterior.versao, versao);
      exigir(anterior.statusRastreamento !== "BAIXA_DEFINITIVA" && anterior.lote.statusProcessamento !== "FINALIZADO", "Equipamento baixado ou lote finalizado não pode ser alterado.");
      const alteracao = preparar(anterior);
      // A versão do agregado também protege contra triagem/finalização concorrente.
      await repos.lotes.atualizar(anterior.loteId, anterior.lote.versao, {});
      const atualizado = await repos.equipamentos.atualizar(id, versao, alteracao.campos);
      await repos.equipamentos.registrarMovimentacao({
        equipamentoId: id, tipo: alteracao.tipo, origem: alteracao.origem, destino: alteracao.destino,
        observacao: alteracao.observacao, responsavelId: ator.id, responsavel: ator.usuario,
      });
      const { lote: _lote, historicoMovimentacao: _historico, ...camposAnteriores } = anterior;
      await repos.auditoria.registrar(ator, `ALTERAR_${alteracao.tipo}`, "Equipamento", id, atualizado, camposAnteriores);
      return atualizado;
    });
  }
}
