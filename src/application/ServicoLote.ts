import { randomUUID } from "node:crypto";
import { Prisma, type StatusLote } from "@prisma/client";
import { autorizar, autorizarConsulta, type UsuarioAutenticado } from "../domain/autorizacao.js";
import type { DadosEquipamento, DadosLote, FiltroLotes } from "../domain/dados.js";
import { conferirVersao, encontrado, exigir } from "../domain/erros.js";
import { validarDataEntrada, validarPeriodo } from "../domain/validacoes.js";
import { BancoDados } from "../infrastructure/BancoDados.js";
import type { Repositorios } from "../infrastructure/repositorios/Repositorios.js";

const proximoStatus: Partial<Record<StatusLote, StatusLote>> = {
  RECEBIDO: "EM_TRIAGEM", EM_TRIAGEM: "TRIAGEM_CONCLUIDA",
  TRIAGEM_CONCLUIDA: "ENCAMINHADO", ENCAMINHADO: "FINALIZADO",
};

async function cadastrarEquipamentos(repos: Repositorios, ator: UsuarioAutenticado, loteId: string, dados: DadosEquipamento[], inicio = 0) {
  exigir(dados.length <= 100, "Adicione no máximo 100 equipamentos por operação.");
  for (const [indice, item] of dados.entries()) {
    exigir(Number.isInteger(item.anoFabricacao) && item.anoFabricacao >= 1900 && item.anoFabricacao <= new Date().getUTCFullYear(), "Ano de fabricação inválido ou futuro.");
    exigir(/^\d{1,9}(\.\d{1,3})?$/.test(item.pesoQuilogramas) && new Prisma.Decimal(item.pesoQuilogramas).greaterThan(0), "Peso deve ser positivo com até três casas decimais.");
    const equipamento = await repos.equipamentos.criar({
      ...item, codigoBarrasInterno: item.codigoBarrasInterno ?? `GC-${randomUUID()}`,
      loteId, posicaoNoLote: inicio + indice + 1,
    });
    await repos.equipamentos.registrarMovimentacao({
      equipamentoId: equipamento.id, tipo: "RECEBIMENTO", origem: "ENTRADA",
      destino: "AGUARDANDO_TRIAGEM", responsavelId: ator.id, responsavel: ator.usuario,
      observacao: "Recebimento do equipamento no lote.",
    });
  }
}

export class ServicoLote {
  constructor(private readonly banco: BancoDados) {}

  listar(ator: UsuarioAutenticado, filtro: FiltroLotes) {
    autorizarConsulta(ator);
    return this.banco.repositorios.lotes.listar({
      organizacaoId: filtro.organizacaoId, statusProcessamento: filtro.status,
      dataEntrada: validarPeriodo(filtro.inicio, filtro.fim),
    }, filtro);
  }

  async buscar(ator: UsuarioAutenticado, id: string) {
    autorizarConsulta(ator);
    const lote = encontrado(await this.banco.repositorios.lotes.buscar(id), "Lote");
    const pesoTotal = lote.equipamentos.reduce((soma, item) => soma.plus(item.pesoQuilogramas), new Prisma.Decimal(0));
    return { ...lote, pesoTotalQuilogramas: pesoTotal.toFixed(3) };
  }

  async criar(ator: UsuarioAutenticado, dados: DadosLote) {
    autorizar(ator, "GESTOR_ALMOXARIFADO");
    const dataEntrada = validarDataEntrada(dados.dataEntrada);
    const { equipamentos = [], ...campos } = dados;
    return this.banco.transacao(async repos => {
      const organizacao = encontrado(await repos.organizacoes.buscar(dados.organizacaoId), "Organização");
      exigir(organizacao.ativo, "A organização está inativa.");
      exigir(organizacao.contrato && organizacao.contrato.dataAssinatura <= dataEntrada && organizacao.contrato.dataVencimento >= dataEntrada,
        "A organização deve possuir contrato vigente na data de entrada do lote.");
      const lote = await repos.lotes.criar({ ...campos, dataEntrada });
      await cadastrarEquipamentos(repos, ator, lote.id, equipamentos);
      const criado = encontrado(await repos.lotes.buscar(lote.id), "Lote");
      await repos.auditoria.registrar(ator, "CRIAR", "Lote", lote.id, criado);
      return criado;
    });
  }

  async adicionarEquipamentos(ator: UsuarioAutenticado, id: string, dados: { versao: number; equipamentos: DadosEquipamento[] }) {
    autorizar(ator, "GESTOR_ALMOXARIFADO");
    exigir(dados.equipamentos.length > 0, "Informe ao menos um equipamento.");
    return this.banco.transacao(async repos => {
      const lote = encontrado(await repos.lotes.buscar(id), "Lote");
      conferirVersao(lote.versao, dados.versao);
      exigir(lote.statusProcessamento === "RECEBIDO", "Equipamentos só podem ser adicionados antes da triagem.");
      await repos.lotes.atualizar(id, dados.versao, {});
      await cadastrarEquipamentos(repos, ator, id, dados.equipamentos, lote.equipamentos.length);
      const atualizado = encontrado(await repos.lotes.buscar(id), "Lote");
      await repos.auditoria.registrar(ator, "ADICIONAR_EQUIPAMENTOS", "Lote", id, atualizado, lote);
      return atualizado;
    });
  }

  async alterarStatus(ator: UsuarioAutenticado, id: string, dados: { versao: number; status: StatusLote; justificativa: string }) {
    autorizar(ator, "GESTOR_ALMOXARIFADO");
    exigir(dados.justificativa.trim(), "Informe a justificativa.");
    return this.banco.transacao(async repos => {
      const lote = encontrado(await repos.lotes.buscar(id), "Lote");
      conferirVersao(lote.versao, dados.versao);
      exigir(proximoStatus[lote.statusProcessamento] === dados.status, "Transição de status do lote não permitida.");
      exigir(lote.equipamentos.length > 0, "O lote deve conter equipamentos antes da triagem.");
      if (dados.status === "FINALIZADO") {
        exigir(lote.equipamentos.every(item => item.statusRastreamento === "BAIXA_DEFINITIVA"), "Todos os equipamentos devem ter baixa definitiva antes de finalizar o lote.");
      }
      await repos.lotes.atualizar(id, dados.versao, { statusProcessamento: dados.status });
      if (dados.status === "EM_TRIAGEM" || dados.status === "TRIAGEM_CONCLUIDA") {
        const statusRastreamento = dados.status === "EM_TRIAGEM" ? "EM_TRIAGEM" : "AGUARDANDO_DESMONTE";
        for (const equipamento of lote.equipamentos) {
          await repos.equipamentos.atualizar(equipamento.id, equipamento.versao, { statusRastreamento });
          await repos.equipamentos.registrarMovimentacao({
            equipamentoId: equipamento.id, tipo: "STATUS", origem: equipamento.statusRastreamento,
            destino: statusRastreamento, observacao: dados.justificativa,
            responsavelId: ator.id, responsavel: ator.usuario,
          });
        }
      }
      const atualizado = encontrado(await repos.lotes.buscar(id), "Lote");
      await repos.auditoria.registrar(ator, "ALTERAR_STATUS", "Lote", id, atualizado, lote);
      return atualizado;
    });
  }
}
