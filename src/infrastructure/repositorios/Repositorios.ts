import { Prisma } from "@prisma/client";
import type { UsuarioAutenticado } from "../../domain/autorizacao.js";
import type { Paginacao } from "../../domain/dados.js";
import { conflitoVersao } from "../../domain/erros.js";

type Conexao = Prisma.TransactionClient;

export const usuarioPublico = {
  id: true, usuario: true, papel: true, ativo: true, versao: true, criadoEm: true,
} satisfies Prisma.UsuarioSelect;

function paginar(filtro: Paginacao) {
  const pagina = filtro.pagina ?? 1;
  const limite = filtro.limite ?? 20;
  return { skip: (pagina - 1) * limite, take: limite };
}

function resultadoPagina<T>(dados: T[], total: number, filtro: Paginacao) {
  return { dados, total, pagina: filtro.pagina ?? 1, limite: filtro.limite ?? 20 };
}

export class RepositorioUsuario {
  constructor(private readonly db: Conexao) {}
  buscar(id: string) { return this.db.usuario.findUnique({ where: { id } }); }
  buscarPorNome(usuario: string) { return this.db.usuario.findUnique({ where: { usuario } }); }
  contarAdministradoresAtivos() { return this.db.usuario.count({ where: { ativo: true, papel: "ADMINISTRADOR" } }); }
  criar(data: Prisma.UsuarioCreateInput) {
    return this.db.usuario.create({ data, select: usuarioPublico });
  }
  async listar(filtro: Paginacao) {
    const [dados, total] = await Promise.all([
      this.db.usuario.findMany({ ...paginar(filtro), select: usuarioPublico, orderBy: { usuario: "asc" } }),
      this.db.usuario.count(),
    ]);
    return resultadoPagina(dados, total, filtro);
  }
  async atualizar(id: string, versao: number, data: Prisma.UsuarioUpdateManyMutationInput) {
    const resultado = await this.db.usuario.updateMany({
      where: { id, versao }, data: { ...data, versao: { increment: 1 }, tokenVersao: { increment: 1 } },
    });
    if (resultado.count !== 1) conflitoVersao();
    return this.db.usuario.findUniqueOrThrow({ where: { id }, select: usuarioPublico });
  }
}

export class RepositorioOrganizacao {
  constructor(private readonly db: Conexao) {}
  buscar(id: string) { return this.db.organizacao.findUnique({ where: { id }, include: { contrato: true } }); }
  criar(data: Prisma.OrganizacaoCreateInput) { return this.db.organizacao.create({ data, include: { contrato: true } }); }
  async listar(filtro: Paginacao & { ativo?: boolean }) {
    const where = { ativo: filtro.ativo };
    const [dados, total] = await Promise.all([
      this.db.organizacao.findMany({ where, ...paginar(filtro), include: { contrato: true }, orderBy: [{ dataCadastro: "desc" }, { id: "asc" }] }),
      this.db.organizacao.count({ where }),
    ]);
    return resultadoPagina(dados, total, filtro);
  }
  async atualizar(id: string, versao: number, data: Prisma.OrganizacaoUpdateManyMutationInput) {
    const resultado = await this.db.organizacao.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } });
    if (resultado.count !== 1) conflitoVersao();
    return this.db.organizacao.findUniqueOrThrow({ where: { id }, include: { contrato: true } });
  }
}

export class RepositorioContrato {
  constructor(private readonly db: Conexao) {}
  buscar(id: string) { return this.db.contrato.findUnique({ where: { id } }); }
  criar(data: Prisma.ContratoUncheckedCreateInput) { return this.db.contrato.create({ data }); }
  async renovar(id: string, versao: number, dataVencimento: Date) {
    const resultado = await this.db.contrato.updateMany({ where: { id, versao }, data: { dataVencimento, versao: { increment: 1 } } });
    if (resultado.count !== 1) conflitoVersao();
    return this.db.contrato.findUniqueOrThrow({ where: { id } });
  }
  listarVigentesNoPeriodo(inicio: Date, fim: Date) {
    return this.db.contrato.findMany({ where: { dataAssinatura: { lte: fim }, dataVencimento: { gte: inicio } }, orderBy: { id: "asc" } });
  }
}

export class RepositorioLote {
  constructor(private readonly db: Conexao) {}
  buscar(id: string) {
    return this.db.lote.findUnique({ where: { id }, include: { equipamentos: { orderBy: { posicaoNoLote: "asc" } } } });
  }
  criar(data: Prisma.LoteUncheckedCreateInput) { return this.db.lote.create({ data }); }
  async listar(where: Prisma.LoteWhereInput, filtro: Paginacao) {
    const [dados, total] = await Promise.all([
      this.db.lote.findMany({ where, ...paginar(filtro), orderBy: [{ dataEntrada: "desc" }, { id: "asc" }] }),
      this.db.lote.count({ where }),
    ]);
    return resultadoPagina(dados, total, filtro);
  }
  async atualizar(id: string, versao: number, data: Prisma.LoteUpdateManyMutationInput) {
    const resultado = await this.db.lote.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } });
    if (resultado.count !== 1) conflitoVersao();
    return this.db.lote.findUniqueOrThrow({ where: { id } });
  }
  listarParaRelatorio(organizacaoId: string, periodo: Prisma.DateTimeFilter) {
    return this.db.lote.findMany({ where: { organizacaoId, dataEntrada: periodo }, include: { equipamentos: true }, orderBy: { dataEntrada: "asc" } });
  }
}

export class RepositorioEquipamento {
  constructor(private readonly db: Conexao) {}
  buscar(id: string) {
    return this.db.equipamento.findUnique({
      where: { id },
      include: { lote: true, historicoMovimentacao: { orderBy: { sequencia: "asc" } } },
    });
  }
  criar(data: Prisma.EquipamentoUncheckedCreateInput) { return this.db.equipamento.create({ data }); }
  async listar(where: Prisma.EquipamentoWhereInput, filtro: Paginacao) {
    const [dados, total] = await Promise.all([
      this.db.equipamento.findMany({ where, ...paginar(filtro), orderBy: { codigoBarrasInterno: "asc" } }),
      this.db.equipamento.count({ where }),
    ]);
    return resultadoPagina(dados, total, filtro);
  }
  async atualizar(id: string, versao: number, data: Prisma.EquipamentoUpdateManyMutationInput) {
    const resultado = await this.db.equipamento.updateMany({ where: { id, versao }, data: { ...data, versao: { increment: 1 } } });
    if (resultado.count !== 1) conflitoVersao();
    return this.db.equipamento.findUniqueOrThrow({ where: { id } });
  }
  registrarMovimentacao(data: Prisma.MovimentacaoUncheckedCreateInput) {
    return this.db.movimentacao.create({ data });
  }
}

function json(dados: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(dados)) as Prisma.InputJsonValue;
}

export class RepositorioAuditoria {
  constructor(private readonly db: Conexao) {}
  registrar(usuario: UsuarioAutenticado, operacao: string, entidade: string, entidadeId: string, dadosDepois: unknown, dadosAntes?: unknown) {
    return this.db.auditoria.create({ data: {
      usuarioResponsavelId: usuario.id, operacao, entidade, entidadeId,
      dadosDepois: json(dadosDepois), dadosAntes: dadosAntes === undefined ? Prisma.DbNull : json(dadosAntes),
    } });
  }
  async listar(filtro: Paginacao & { entidade?: string; entidadeId?: string }) {
    const where = { entidade: filtro.entidade, entidadeId: filtro.entidadeId };
    const [dados, total] = await Promise.all([
      this.db.auditoria.findMany({ where, ...paginar(filtro), orderBy: [{ dataHora: "desc" }, { id: "asc" }] }),
      this.db.auditoria.count({ where }),
    ]);
    return resultadoPagina(dados, total, filtro);
  }
}

export class Repositorios {
  readonly usuarios: RepositorioUsuario;
  readonly organizacoes: RepositorioOrganizacao;
  readonly contratos: RepositorioContrato;
  readonly lotes: RepositorioLote;
  readonly equipamentos: RepositorioEquipamento;
  readonly auditoria: RepositorioAuditoria;

  constructor(db: Conexao) {
    this.usuarios = new RepositorioUsuario(db);
    this.organizacoes = new RepositorioOrganizacao(db);
    this.contratos = new RepositorioContrato(db);
    this.lotes = new RepositorioLote(db);
    this.equipamentos = new RepositorioEquipamento(db);
    this.auditoria = new RepositorioAuditoria(db);
  }
}
