import { Prisma } from "@prisma/client";
import { autorizar, autorizarConsulta, type UsuarioAutenticado } from "../domain/autorizacao.js";
import type { AlteracaoOrganizacao, DadosContrato, DadosOrganizacao, Paginacao } from "../domain/dados.js";
import { conferirVersao, encontrado, exigir } from "../domain/erros.js";
import { dataValida, normalizarCnpj } from "../domain/validacoes.js";
import { BancoDados } from "../infrastructure/BancoDados.js";

function prepararContrato(dados: DadosContrato) {
  const dataAssinatura = dataValida(dados.dataAssinatura);
  const dataVencimento = dataValida(dados.dataVencimento);
  exigir(dataVencimento > dataAssinatura, "O vencimento deve ser posterior à assinatura.");
  exigir(/^\d{1,12}(\.\d{1,2})?$/.test(dados.valorMensal), "Valor mensal deve ser um decimal não negativo com até duas casas.");
  return { ...dados, dataAssinatura, dataVencimento, valorMensal: new Prisma.Decimal(dados.valorMensal) };
}

export class ServicoOrganizacao {
  constructor(private readonly banco: BancoDados) {}

  listar(ator: UsuarioAutenticado, filtro: Paginacao & { ativo?: boolean }) {
    autorizarConsulta(ator);
    return this.banco.repositorios.organizacoes.listar(filtro);
  }

  async buscar(ator: UsuarioAutenticado, id: string) {
    autorizarConsulta(ator);
    return encontrado(await this.banco.repositorios.organizacoes.buscar(id), "Organização");
  }

  async criar(ator: UsuarioAutenticado, dados: DadosOrganizacao) {
    autorizar(ator, "OPERADOR_CADASTRO");
    const cnpj = normalizarCnpj(dados.cnpj);
    const { contrato, ...campos } = dados;
    exigir(campos.razaoSocial.trim() && campos.enderecoCompleto.trim(), "Razão social e endereço são obrigatórios.");
    const contratoPreparado = contrato ? prepararContrato(contrato) : undefined;
    return this.banco.transacao(async repos => {
      const criada = await repos.organizacoes.criar({
        ...campos, cnpj, razaoSocial: campos.razaoSocial.trim(),
        contrato: contratoPreparado ? { create: contratoPreparado } : undefined,
      });
      await repos.auditoria.registrar(ator, "CRIAR", "Organizacao", criada.id, criada);
      return criada;
    });
  }

  async alterar(ator: UsuarioAutenticado, id: string, dados: AlteracaoOrganizacao) {
    autorizar(ator, "OPERADOR_CADASTRO");
    const { versao, ...campos } = dados;
    exigir(Object.keys(campos).length > 0, "Informe ao menos um campo para alteração.");
    return this.banco.transacao(async repos => {
      const anterior = encontrado(await repos.organizacoes.buscar(id), "Organização");
      conferirVersao(anterior.versao, versao);
      const atualizada = await repos.organizacoes.atualizar(id, versao, campos);
      await repos.auditoria.registrar(ator, "ALTERAR", "Organizacao", id, atualizada, anterior);
      return atualizada;
    });
  }

  async criarContrato(ator: UsuarioAutenticado, organizacaoId: string, dados: DadosContrato & { versao: number }) {
    autorizar(ator, "OPERADOR_CADASTRO");
    const { versao, ...campos } = dados;
    const contrato = prepararContrato(campos);
    return this.banco.transacao(async repos => {
      const organizacao = encontrado(await repos.organizacoes.buscar(organizacaoId), "Organização");
      conferirVersao(organizacao.versao, versao);
      exigir(!organizacao.contrato, "A organização já possui contrato; utilize a renovação.");
      await repos.organizacoes.atualizar(organizacaoId, versao, {});
      const criado = await repos.contratos.criar({ ...contrato, organizacaoId });
      await repos.auditoria.registrar(ator, "CRIAR", "Contrato", criado.id, criado);
      return criado;
    });
  }

  async renovarContrato(ator: UsuarioAutenticado, id: string, dados: { versao: number; dataVencimento: string }) {
    autorizar(ator, "OPERADOR_CADASTRO");
    const vencimento = dataValida(dados.dataVencimento);
    return this.banco.transacao(async repos => {
      const anterior = encontrado(await repos.contratos.buscar(id), "Contrato");
      conferirVersao(anterior.versao, dados.versao);
      exigir(vencimento > anterior.dataVencimento && vencimento > new Date(), "O novo vencimento deve ser futuro e posterior ao atual.");
      const renovado = await repos.contratos.renovar(id, dados.versao, vencimento);
      await repos.auditoria.registrar(ator, "RENOVAR", "Contrato", id, renovado, anterior);
      return renovado;
    });
  }
}
