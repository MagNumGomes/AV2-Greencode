import type { FastifyInstance } from "fastify";
import type { ServicoAutenticacao } from "../../application/ServicoAutenticacao.js";
import * as S from "../schemas.js";
import type { ComId, Consulta, Corpo } from "../tipos.js";

export function registrarLogin(app: FastifyInstance, servico: ServicoAutenticacao, expiraEm: string) {
  app.post<Corpo<typeof S.LoginEntrada>>("/api/auth/login", {
    schema: { ...S.documentar("Autenticação", "Autenticar e emitir JWT", S.LoginResposta, 200, true), body: S.LoginEntrada },
  }, async request => {
    const { claims, usuario } = await servico.login(request.body.usuario, request.body.senha);
    return { token: app.jwt.sign(claims), tipo: "Bearer", expiraEm, usuario };
  });
}

export function registrarAutenticacao(app: FastifyInstance, servico: ServicoAutenticacao) {
  app.get("/auth/me", { schema: S.documentar("Autenticação", "Consultar usuário autenticado", S.UsuarioResposta) }, request => servico.me(request.ator));

  app.patch<Corpo<typeof S.SenhaAlteracao>>("/auth/senha", {
    schema: { ...S.documentar("Autenticação", "Alterar senha e revogar os tokens anteriores", S.UsuarioResposta), body: S.SenhaAlteracao },
  }, request => servico.alterarSenha(request.ator, request.body));

  app.get<Consulta<typeof S.Paginacao>>("/usuarios", {
    schema: { ...S.documentar("Usuários", "Listar usuários (administrador)", S.paginaDe(S.UsuarioResposta)), querystring: S.Paginacao },
  }, request => servico.listar(request.ator, request.query));

  app.post<Corpo<typeof S.UsuarioEntrada>>("/usuarios", {
    schema: { ...S.documentar("Usuários", "Criar usuário (administrador)", S.UsuarioResposta, 201), body: S.UsuarioEntrada },
  }, async (request, reply) => reply.code(201).send(await servico.criar(request.ator, request.body)));

  app.patch<ComId & Corpo<typeof S.UsuarioAlteracao>>("/usuarios/:id", {
    schema: { ...S.documentar("Usuários", "Alterar papel/ativação e revogar tokens (administrador)", S.UsuarioResposta), params: S.IdParams, body: S.UsuarioAlteracao },
  }, request => servico.alterar(request.ator, request.params.id, request.body));
}
