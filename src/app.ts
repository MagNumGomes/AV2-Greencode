import Fastify from "fastify";
import jwt from "@fastify/jwt";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { PrismaClient } from "@prisma/client";
import { Type } from "@sinclair/typebox";
import type { Configuracao } from "./config.js";
import { ServicoAutenticacao } from "./application/ServicoAutenticacao.js";
import { ServicoOrganizacao } from "./application/ServicoOrganizacao.js";
import { ServicoLote } from "./application/ServicoLote.js";
import { ServicoEquipamento } from "./application/ServicoEquipamento.js";
import { ServicoRelatorio } from "./application/ServicoRelatorio.js";
import { BancoDados } from "./infrastructure/BancoDados.js";
import { criarPrisma } from "./infrastructure/prisma.js";
import { ErroAplicacao } from "./domain/erros.js";
import { registrarErros } from "./http/erros.js";
import { registrarAutenticacao, registrarLogin } from "./http/controllers/AutenticacaoController.js";
import { registrarOrganizacoes } from "./http/controllers/OrganizacaoController.js";
import { registrarLotes } from "./http/controllers/LoteController.js";
import { registrarEquipamentos } from "./http/controllers/EquipamentoController.js";
import { registrarRelatorios } from "./http/controllers/RelatorioController.js";
import { documentar } from "./http/schemas.js";
import "./http/tipos.js";

export function criarApp(config: Configuracao, opcoes: { prisma?: PrismaClient; logger?: boolean } = {}) {
  const app = Fastify({
    logger: opcoes.logger === false ? false : { redact: ["req.headers.authorization"] },
    bodyLimit: 1024 * 1024,
    ajv: { customOptions: { removeAdditional: false } },
    return503OnClosing: true,
  });
  const prisma = opcoes.prisma ?? criarPrisma(config.databaseUrl);
  const banco = new BancoDados(prisma);
  const autenticacao = new ServicoAutenticacao(banco);
  let encerrando = false;

  registrarErros(app);
  app.addHook("preClose", async () => { encerrando = true; });
  app.addHook("onSend", async (_request, reply, payload) => {
    if (encerrando) reply.header("Connection", "close");
    return payload;
  });
  app.addHook("onResponse", async () => {
    // Recolhe sockets que ficaram ociosos após o início do fechamento,
    // preservando as demais requisições ainda em andamento.
    if (encerrando) setImmediate(() => app.server.closeIdleConnections());
  });
  app.addHook("onReady", async () => {
    await prisma.$connect();
    // O adaptador pg cria o pool de forma preguiçosa; $connect sozinho não testa a conexão.
    await prisma.$queryRaw`SELECT 1`;
  });
  app.addHook("onClose", () => prisma.$disconnect());
  app.register(jwt, {
    secret: config.jwtSecret,
    sign: { expiresIn: config.jwtExpiresIn, iss: "greencode", aud: "greencode-api" },
    verify: { allowedIss: "greencode", allowedAud: "greencode-api", algorithms: ["HS256"] },
  });
  app.register(cors, { origin: config.corsOrigins, methods: ["GET", "POST", "PATCH", "OPTIONS"] });
  app.register(swagger, {
    openapi: {
      info: { title: "GreenCode — AV2", version: "1.0.0", description: "API monolítica de logística reversa. Valores monetários e pesos são strings decimais. Alterações exigem a versão atual do registro." },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } },
    },
  });
  app.register(swaggerUi, { routePrefix: "/docs" });

  app.register(async rotas => {
    rotas.get("/health", {
      schema: documentar("Sistema", "Verificar aplicação e conexão com o banco", Type.Object({ status: Type.Literal("ok"), banco: Type.Literal("conectado") }), 200, true),
    }, async () => {
      try { await prisma.$queryRaw`SELECT 1`; }
      catch { throw new ErroAplicacao(503, "BANCO_INDISPONIVEL", "Banco de dados indisponível."); }
      return { status: "ok", banco: "conectado" };
    });
    registrarLogin(rotas, autenticacao, config.jwtExpiresIn);
    rotas.register(async api => {
      api.decorateRequest("ator");
      api.addHook("onRequest", async request => {
        try { await request.jwtVerify(); }
        catch { throw new ErroAplicacao(401, "TOKEN_INVALIDO", "Informe um token Bearer válido e não expirado."); }
        request.ator = await autenticacao.autenticar(request.user);
      });
      registrarAutenticacao(api, autenticacao);
      registrarOrganizacoes(api, new ServicoOrganizacao(banco));
      registrarLotes(api, new ServicoLote(banco));
      registrarEquipamentos(api, new ServicoEquipamento(banco));
      registrarRelatorios(api, new ServicoRelatorio(banco));
    }, { prefix: "/api" });
  });
  return app;
}
