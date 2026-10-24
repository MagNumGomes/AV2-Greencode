import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { ErroAplicacao } from "../domain/erros.js";

function codigoPostgres(erro: Prisma.PrismaClientKnownRequestError): string | undefined {
  const adaptador = erro.meta?.driverAdapterError;
  const causa = adaptador && typeof adaptador === "object" && "cause" in adaptador ? adaptador.cause : undefined;
  return causa && typeof causa === "object" && "originalCode" in causa && typeof causa.originalCode === "string"
    ? causa.originalCode : undefined;
}

export function registrarErros(app: FastifyInstance): void {
  app.setErrorHandler((erro, request, reply) => {
    let status = 500;
    let codigo = "ERRO_INTERNO";
    let mensagem = "Não foi possível concluir a operação.";
    if (erro instanceof ErroAplicacao) {
      ({ status, codigo } = erro);
      mensagem = erro.message;
    } else if (erro instanceof Error && "validation" in erro && erro.validation) {
      status = 400; codigo = "ENTRADA_INVALIDA"; mensagem = erro.message;
    } else if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === "P2002") {
        status = 409; codigo = "REGISTRO_DUPLICADO"; mensagem = "Já existe um registro com este CNPJ, usuário, código de barras ou posição no lote.";
      } else if (erro.code === "P2003") {
        status = 422; codigo = "REFERENCIA_INVALIDA"; mensagem = "Um dos registros relacionados não existe.";
      } else if (erro.code === "P2025") {
        status = 404; codigo = "NAO_ENCONTRADO"; mensagem = "Registro não encontrado.";
      } else if (erro.code === "P2004" || (erro.code === "P2039" && codigoPostgres(erro) === "23514")) {
        status = 422; codigo = "INTEGRIDADE_DADOS"; mensagem = "A operação viola uma restrição de integridade.";
      } else if (["P1001", "P1002", "P2024"].includes(erro.code)) {
        status = 503; codigo = "BANCO_INDISPONIVEL"; mensagem = "O banco de dados está temporariamente indisponível.";
      }
    } else if (erro instanceof Error && "statusCode" in erro && typeof erro.statusCode === "number" && erro.statusCode >= 400 && erro.statusCode < 500) {
      status = erro.statusCode; codigo = "REQUISICAO_INVALIDA"; mensagem = erro.message;
    }
    if (status >= 500) request.log.error({ err: erro }, "Falha ao processar requisição");
    return reply.code(status).send({ erro: { codigo, mensagem }, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    erro: { codigo: "ROTA_NAO_ENCONTRADA", mensagem: "Rota não encontrada." }, requestId: request.id,
  }));
}
