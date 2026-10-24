import type { Static, TSchema } from "@sinclair/typebox";
import type { ClaimsJWT } from "../application/ServicoAutenticacao.js";
import type { UsuarioAutenticado } from "../domain/autorizacao.js";

export type Corpo<T extends TSchema> = { Body: Static<T> };
export type Consulta<T extends TSchema> = { Querystring: Static<T> };
export type ComId = { Params: { id: string } };

declare module "@fastify/jwt" {
  interface FastifyJWT { payload: ClaimsJWT; user: ClaimsJWT }
}

declare module "fastify" {
  interface FastifyRequest { ator: UsuarioAutenticado }
}
