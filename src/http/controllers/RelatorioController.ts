import type { FastifyInstance } from "fastify";
import type { ServicoRelatorio } from "../../application/ServicoRelatorio.js";
import * as S from "../schemas.js";
import type { ComId, Consulta } from "../tipos.js";

export function registrarRelatorios(app: FastifyInstance, servico: ServicoRelatorio) {
  app.get<ComId & Consulta<typeof S.Periodo>>("/relatorios/organizacoes/:id", {
    schema: { ...S.documentar("Relatórios", "Relatório operacional por organização (auditor/administrador)", S.RelatorioOrganizacao), params: S.IdParams, querystring: S.Periodo },
  }, request => servico.porOrganizacao(request.ator, request.params.id, request.query.inicio, request.query.fim));

  app.get<Consulta<typeof S.StatusFiltro>>("/relatorios/status", {
    schema: { ...S.documentar("Relatórios", "Relatório de equipamentos por status (auditor/administrador)", S.paginaDe(S.EquipamentoResposta)), querystring: S.StatusFiltro },
  }, request => servico.porStatus(request.ator, request.query.status, request.query));

  app.get<Consulta<typeof S.Periodo>>("/relatorios/financeiro", {
    schema: { ...S.documentar("Relatórios", "Somar mensalidades de contratos no período (auditor/administrador)", S.RelatorioFinanceiro), querystring: S.Periodo },
  }, request => servico.financeiro(request.ator, request.query.inicio, request.query.fim));

  app.get<Consulta<typeof S.AuditoriaFiltro>>("/auditoria", {
    schema: { ...S.documentar("Auditoria", "Consultar trilha imutável (auditor/administrador)", S.paginaDe(S.AuditoriaResposta)), querystring: S.AuditoriaFiltro },
  }, request => servico.auditoria(request.ator, request.query));
}
