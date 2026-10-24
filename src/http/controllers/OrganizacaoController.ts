import type { FastifyInstance } from "fastify";
import type { ServicoOrganizacao } from "../../application/ServicoOrganizacao.js";
import * as S from "../schemas.js";
import type { ComId, Consulta, Corpo } from "../tipos.js";

export function registrarOrganizacoes(app: FastifyInstance, servico: ServicoOrganizacao) {
  app.get<Consulta<typeof S.OrganizacaoFiltro>>("/organizacoes", {
    schema: { ...S.documentar("Organizações", "Listar organizações", S.paginaDe(S.OrganizacaoResposta)), querystring: S.OrganizacaoFiltro },
  }, request => servico.listar(request.ator, request.query));

  app.get<ComId>("/organizacoes/:id", {
    schema: { ...S.documentar("Organizações", "Consultar organização e contrato", S.OrganizacaoResposta), params: S.IdParams },
  }, request => servico.buscar(request.ator, request.params.id));

  app.post<Corpo<typeof S.OrganizacaoEntrada>>("/organizacoes", {
    schema: { ...S.documentar("Organizações", "Cadastrar organização com contrato opcional", S.OrganizacaoResposta, 201), body: S.OrganizacaoEntrada },
  }, async (request, reply) => {
    const organizacao = await servico.criar(request.ator, request.body);
    return reply.code(201).header("Location", `/api/organizacoes/${organizacao.id}`).send(organizacao);
  });

  app.patch<ComId & Corpo<typeof S.OrganizacaoAlteracao>>("/organizacoes/:id", {
    schema: { ...S.documentar("Organizações", "Alterar dados/ativação da organização", S.OrganizacaoResposta), params: S.IdParams, body: S.OrganizacaoAlteracao },
  }, request => servico.alterar(request.ator, request.params.id, request.body));

  app.post<ComId & Corpo<typeof S.ContratoCriacao>>("/organizacoes/:id/contrato", {
    schema: { ...S.documentar("Contratos", "Vincular contrato (versão da organização)", S.ContratoResposta, 201), params: S.IdParams, body: S.ContratoCriacao },
  }, async (request, reply) => reply.code(201).send(await servico.criarContrato(request.ator, request.params.id, request.body)));

  app.patch<ComId & Corpo<typeof S.ContratoRenovacao>>("/contratos/:id/renovacao", {
    schema: { ...S.documentar("Contratos", "Renovar contrato (versão do contrato)", S.ContratoResposta), params: S.IdParams, body: S.ContratoRenovacao },
  }, request => servico.renovarContrato(request.ator, request.params.id, request.body));
}
