import type { FastifyInstance } from "fastify";
import type { ServicoEquipamento } from "../../application/ServicoEquipamento.js";
import * as S from "../schemas.js";
import type { ComId, Consulta, Corpo } from "../tipos.js";

export function registrarEquipamentos(app: FastifyInstance, servico: ServicoEquipamento) {
  app.get<Consulta<typeof S.EquipamentoFiltro>>("/equipamentos", {
    schema: { ...S.documentar("Equipamentos", "Listar equipamentos por lote, status ou código", S.paginaDe(S.EquipamentoResposta)), querystring: S.EquipamentoFiltro },
  }, request => servico.listar(request.ator, request.query));

  app.get<ComId>("/equipamentos/:id", {
    schema: { ...S.documentar("Equipamentos", "Consultar rastreabilidade e depreciação", S.RastreabilidadeResposta), params: S.IdParams },
  }, request => servico.buscar(request.ator, request.params.id));

  app.patch<ComId & Corpo<typeof S.EquipamentoStatus>>("/equipamentos/:id/status", {
    schema: { ...S.documentar("Equipamentos", "Alterar status e registrar movimentação", S.EquipamentoResposta), params: S.IdParams, body: S.EquipamentoStatus },
  }, request => servico.alterarStatus(request.ator, request.params.id, request.body));

  app.patch<ComId & Corpo<typeof S.EquipamentoEstado>>("/equipamentos/:id/estado-fisico", {
    schema: { ...S.documentar("Equipamentos", "Alterar estado físico com justificativa de rebaixamento", S.EquipamentoResposta), params: S.IdParams, body: S.EquipamentoEstado },
  }, request => servico.alterarEstado(request.ator, request.params.id, request.body));

  app.post<ComId & Corpo<typeof S.MovimentacaoEntrada>>("/equipamentos/:id/movimentacoes", {
    schema: { ...S.documentar("Equipamentos", "Registrar mudança de localização", S.EquipamentoResposta, 201), params: S.IdParams, body: S.MovimentacaoEntrada },
  }, async (request, reply) => reply.code(201).send(await servico.movimentar(request.ator, request.params.id, request.body)));
}
