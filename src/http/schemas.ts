import { Type, type TSchema } from "@sinclair/typebox";
import { EstadoFisico, PapelUsuario, StatusLote, StatusRastreamento, TipoEquipamento, TipoMovimentacao } from "@prisma/client";

export const texto = (maxLength = 200) => Type.String({ minLength: 1, maxLength, pattern: "\\S" });
export const uuid = Type.String({ format: "uuid" });
export const dataHora = Type.String({ format: "date-time" });
export const versao = Type.Integer({ minimum: 1, description: "Versão atual obtida em uma consulta. Uma alteração incrementa este valor." });
const dinheiro = Type.String({ pattern: "^\\d{1,12}(\\.\\d{1,2})?$", examples: ["1500.00"] });
const peso = Type.String({ pattern: "^\\d{1,9}(\\.\\d{1,3})?$", examples: ["2.500"] });
const objeto = { additionalProperties: false } as const;
export const IdParams = Type.Object({ id: uuid }, objeto);
export const Paginacao = Type.Object({
  pagina: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000000, default: 1 })),
  limite: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 20 })),
}, objeto);
export const Periodo = Type.Object({ inicio: dataHora, fim: dataHora }, objeto);

export const ContratoEntrada = Type.Object({
  dataAssinatura: dataHora, dataVencimento: dataHora,
  clausulas: Type.Array(texto(2000), { maxItems: 100 }), valorMensal: dinheiro,
  renovacaoAutomatica: Type.Optional(Type.Boolean()),
}, objeto);
export const ContratoCriacao = Type.Object({ ...ContratoEntrada.properties, versao }, objeto);
export const ContratoRenovacao = Type.Object({ versao, dataVencimento: dataHora }, objeto);

const camposOrganizacao = {
  razaoSocial: texto(200), inscricaoEstadual: Type.Optional(Type.String({ maxLength: 30 })),
  enderecoCompleto: texto(500), telefone: texto(30), email: Type.String({ format: "email", maxLength: 254 }),
};
export const OrganizacaoEntrada = Type.Object({
  ...camposOrganizacao, cnpj: Type.String({ minLength: 14, maxLength: 18 }), contrato: Type.Optional(ContratoEntrada),
}, objeto);
export const OrganizacaoAlteracao = Type.Object({
  ...Type.Partial(Type.Object(camposOrganizacao)).properties, versao, ativo: Type.Optional(Type.Boolean()),
}, { ...objeto, minProperties: 2 });
export const OrganizacaoFiltro = Type.Object({ ...Paginacao.properties, ativo: Type.Optional(Type.Boolean()) }, objeto);

export const EquipamentoEntrada = Type.Object({
  codigoBarrasInterno: Type.Optional(Type.String({ minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9_-]+$" })),
  tipo: Type.Enum(TipoEquipamento), marca: texto(100), modelo: texto(100),
  anoFabricacao: Type.Integer({ minimum: 1900, maximum: 9999 }), estadoFisico: Type.Enum(EstadoFisico), pesoQuilogramas: peso,
}, objeto);
export const LoteEntrada = Type.Object({
  organizacaoId: uuid, dataEntrada: dataHora, notaFiscal: texto(100), transportadora: texto(200),
  observacoes: Type.Optional(Type.String({ maxLength: 2000 })),
  equipamentos: Type.Optional(Type.Array(EquipamentoEntrada, { maxItems: 100 })),
}, objeto);
export const AdicionarEquipamentos = Type.Object({ versao, equipamentos: Type.Array(EquipamentoEntrada, { minItems: 1, maxItems: 100 }) }, objeto);
export const LoteStatus = Type.Object({ versao, status: Type.Enum(StatusLote), justificativa: texto(2000) }, objeto);
export const EquipamentoStatus = Type.Object({ versao, status: Type.Enum(StatusRastreamento), justificativa: texto(2000) }, objeto);
export const EquipamentoEstado = Type.Object({ versao, estadoFisico: Type.Enum(EstadoFisico), justificativa: Type.Optional(texto(2000)) }, objeto);
export const MovimentacaoEntrada = Type.Object({ versao, destino: texto(200), justificativa: texto(2000) }, objeto);
export const LoteFiltro = Type.Object({
  ...Paginacao.properties, organizacaoId: Type.Optional(uuid), status: Type.Optional(Type.Enum(StatusLote)),
  inicio: Type.Optional(dataHora), fim: Type.Optional(dataHora),
}, objeto);
export const EquipamentoFiltro = Type.Object({
  ...Paginacao.properties, loteId: Type.Optional(uuid), status: Type.Optional(Type.Enum(StatusRastreamento)),
  codigoBarrasInterno: Type.Optional(texto(100)),
}, objeto);
export const StatusFiltro = Type.Object({ ...Paginacao.properties, status: Type.Enum(StatusRastreamento) }, objeto);
export const AuditoriaFiltro = Type.Object({
  ...Paginacao.properties, entidade: Type.Optional(texto(40)), entidadeId: Type.Optional(uuid),
}, objeto);

export const LoginEntrada = Type.Object({ usuario: texto(60), senha: Type.String({ minLength: 1, maxLength: 128 }) }, objeto);
export const UsuarioEntrada = Type.Object({
  usuario: Type.String({ pattern: "^[A-Za-z0-9._-]{3,60}$" }),
  senha: Type.String({ minLength: 10, maxLength: 128 }), papel: Type.Enum(PapelUsuario),
}, objeto);
export const UsuarioAlteracao = Type.Object({
  versao, papel: Type.Optional(Type.Enum(PapelUsuario)), ativo: Type.Optional(Type.Boolean()),
}, { ...objeto, minProperties: 2 });
export const SenhaAlteracao = Type.Object({
  versao, senhaAntiga: Type.String({ minLength: 1, maxLength: 128 }), senhaNova: Type.String({ minLength: 10, maxLength: 128 }),
}, objeto);

export const UsuarioResposta = Type.Object({
  id: uuid, usuario: Type.String(), papel: Type.Enum(PapelUsuario), ativo: Type.Boolean(), versao, criadoEm: dataHora,
});
export const LoginResposta = Type.Object({
  token: Type.String(), tipo: Type.Literal("Bearer"), expiraEm: Type.String(),
  usuario: Type.Pick(UsuarioResposta, ["id", "usuario", "papel", "versao"]),
});
export const ContratoResposta = Type.Object({
  ...ContratoEntrada.properties, id: uuid, organizacaoId: uuid, versao, renovacaoAutomatica: Type.Boolean(), valorMensal: Type.String(),
});
export const OrganizacaoResposta = Type.Object({
  ...camposOrganizacao, id: uuid, cnpj: Type.String(), dataCadastro: dataHora, ativo: Type.Boolean(), versao,
  contrato: Type.Union([ContratoResposta, Type.Null()]),
});
export const MovimentacaoResposta = Type.Object({
  id: uuid, sequencia: Type.Integer(), equipamentoId: uuid, dataHora, tipo: Type.Enum(TipoMovimentacao),
  origem: Type.String(), destino: Type.String(), responsavelId: uuid, responsavel: Type.String(), observacao: Type.String(), versao,
});
export const EquipamentoResposta = Type.Object({
  ...EquipamentoEntrada.properties, id: uuid, codigoBarrasInterno: Type.String(), pesoQuilogramas: Type.String(),
  loteId: uuid, posicaoNoLote: Type.Integer(), statusRastreamento: Type.Enum(StatusRastreamento), localizacaoAtual: Type.String(), versao,
  depreciacaoPercentual: Type.Optional(Type.Number()),
});
export const LoteResposta = Type.Object({
  id: uuid, organizacaoId: uuid, dataEntrada: dataHora, notaFiscal: Type.String(), transportadora: Type.String(),
  observacoes: Type.String(), statusProcessamento: Type.Enum(StatusLote), versao,
  equipamentos: Type.Optional(Type.Array(EquipamentoResposta)), pesoTotalQuilogramas: Type.Optional(Type.String()),
});
export const RastreabilidadeResposta = Type.Object({
  ...EquipamentoResposta.properties, lote: LoteResposta, historicoMovimentacao: Type.Array(MovimentacaoResposta),
});
export const AuditoriaResposta = Type.Object({
  id: uuid, dataHora, operacao: Type.String(), entidade: Type.String(), entidadeId: uuid,
  dadosAntes: Type.Unknown(), dadosDepois: Type.Unknown(), usuarioResponsavelId: uuid, versao,
});
export const RelatorioOrganizacao = Type.Object({
  organizacao: OrganizacaoResposta, periodo: Periodo, totalLotes: Type.Integer(), totalEquipamentos: Type.Integer(),
  pesoTotalQuilogramas: Type.String(), lotes: Type.Array(LoteResposta),
});
export const RelatorioFinanceiro = Type.Object({
  periodo: Periodo, moeda: Type.Literal("BRL"), totalContratos: Type.Integer(), valorMensalTotal: Type.String(),
  criterio: Type.String(), contratos: Type.Array(ContratoResposta),
});
export const ErroResposta = Type.Object({
  erro: Type.Object({ codigo: Type.String(), mensagem: Type.String() }), requestId: Type.String(),
});
export const paginaDe = (schema: TSchema) => Type.Object({
  dados: Type.Array(schema), total: Type.Integer(), pagina: Type.Integer(), limite: Type.Integer(),
});

export function documentar(tag: string, summary: string, resposta: TSchema, status = 200, publico = false) {
  return {
    tags: [tag], summary, security: publico ? [] : [{ bearerAuth: [] }],
    response: {
      [status]: resposta, 400: ErroResposta, 401: ErroResposta, 403: ErroResposta,
      404: ErroResposta, 409: ErroResposta, 422: ErroResposta, 500: ErroResposta, 503: ErroResposta,
    },
  };
}
