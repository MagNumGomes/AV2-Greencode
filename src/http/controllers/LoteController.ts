import type { FastifyInstance } from "fastify";
import type { ServicoLote } from "../../application/ServicoLote.js";
import * as S from "../schemas.js";
import type { ComId, Consulta, Corpo } from "../tipos.js";

export function registrarLotes(app: FastifyInstance, servico: ServicoLote) {
  app.get<Consulta<typeof S.LoteFiltro>>("/lotes", {
    schema: { ...S.documentar("Lotes", "Listar lotes por organização, status e período", S.paginaDe(S.LoteResposta)), querystring: S.LoteFiltro },
  }, request => servico.listar(request.ator, request.query));

  app.get<ComId>("/lotes/:id", {
    schema: { ...S.documentar("Lotes", "Consultar lote, equipamentos e peso total", S.LoteResposta), params: S.IdParams },
  }, request => servico.buscar(request.ator, request.params.id));

  app.post<Corpo<typeof S.LoteEntrada>>("/lotes", {
    schema: { ...S.documentar("Lotes", "Receber lote e equipamentos atomicamente", S.LoteResposta, 201), body: S.LoteEntrada },
  }, async (request, reply) => {
    const lote = await servico.criar(request.ator, request.body);
    return reply.code(201).header("Location", `/api/lotes/${lote.id}`).send(lote);
  });

  app.post<ComId & Corpo<typeof S.AdicionarEquipamentos>>("/lotes/:id/equipamentos", {
    schema: { ...S.documentar("Lotes", "Adicionar equipamentos a um lote recebido", S.LoteResposta, 201), params: S.IdParams, body: S.AdicionarEquipamentos },
  }, async (request, reply) => reply.code(201).send(await servico.adicionarEquipamentos(request.ator, request.params.id, request.body)));

  app.patch<ComId & Corpo<typeof S.LoteStatus>>("/lotes/:id/status", {
    schema: { ...S.documentar("Lotes", "Avançar etapa do lote e sincronizar a triagem dos equipamentos", S.LoteResposta), params: S.IdParams, body: S.LoteStatus },
  }, request => servico.alterarStatus(request.ator, request.params.id, request.body));
}
