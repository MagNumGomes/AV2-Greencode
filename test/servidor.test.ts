import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { criarApp } from "../src/app.js";
import { criarPrisma } from "../src/infrastructure/prisma.js";
import { BancoDados } from "../src/infrastructure/BancoDados.js";
import { ErroAplicacao } from "../src/domain/erros.js";
import { popularBanco } from "../prisma/dadosExemplo.js";
import { bancoTemporario, portaLivre } from "./bancoTemporario.js";

let banco: Awaited<ReturnType<typeof bancoTemporario>>;
const config = { host: "127.0.0.1", port: 3333, jwtSecret: "teste-http-real-chave-com-32-caracteres", jwtExpiresIn: "30m", corsOrigins: [] };

before(async () => { banco = await bancoTemporario(); }, { timeout: 120000 });
after(async () => { if (banco) await banco.fechar(); });

test("migrações aplicadas correspondem ao schema Prisma e reaplicar deploy é idempotente", async () => {
  const executar = promisify(execFile);
  const env = { ...process.env, DATABASE_URL: banco.url };
  await executar(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env });
  const resultado = await executar(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "diff",
    "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], { env });
  assert.match(resultado.stdout, /No difference detected/i);
});

test("servidor recusa inicialização quando o banco não está acessível", async () => {
  const porta = await portaLivre();
  const app = criarApp({ ...config, databaseUrl: `postgresql://teste:teste@127.0.0.1:${porta}/inexistente` }, { logger: false });
  try { await assert.rejects(app.listen({ host: config.host, port: 0 })); }
  finally { await app.close(); }
  assert.equal(app.server.listening, false);
});

test("graceful shutdown aguarda requisição e acesso ao banco em andamento antes de desconectar", { timeout: 20000 }, async () => {
  const prisma = criarPrisma(banco.url);
  const app = criarApp({ ...config, databaseUrl: banco.url }, { prisma, logger: false });
  const eventos: string[] = [];
  let liberar!: () => void;
  let sinalizar!: () => void;
  const bloqueio = new Promise<void>(resolve => { liberar = resolve; });
  const iniciou = new Promise<void>(resolve => { sinalizar = resolve; });
  app.get("/__verificacao_encerramento", async () => {
    sinalizar();
    await bloqueio;
    await prisma.$queryRaw`SELECT 1`;
    eventos.push("requisicao_concluida");
    return { concluida: true };
  });
  app.addHook("onClose", async () => { eventos.push("onClose"); });
  try {
    const endereco = await app.listen({ host: config.host, port: 0 });
    const resposta = fetch(`${endereco}/__verificacao_encerramento`);
    await iniciou;
    const fechamento = app.close();
    assert.deepEqual(eventos, []);
    liberar();
    const recebida = await resposta;
    assert.equal(recebida.status, 200);
    assert.deepEqual(await recebida.json(), { concluida: true });
    await fechamento;
    assert.deepEqual(eventos, ["requisicao_concluida", "onClose"]);
    await assert.rejects(fetch(`${endereco}/health`));
  } finally { liberar(); await app.close(); }
});

test("entrada server.ts respeita PORT e encerra por SIGTERM no Linux", { timeout: 20000 }, async () => {
  const port = await portaLivre();
  const filho = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: { ...process.env, DATABASE_URL: banco.url, HOST: config.host, PORT: String(port), JWT_SECRET: config.jwtSecret },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  const saiu = once(filho, "exit");
  const pronto = new Promise<void>((resolve, reject) => {
    filho.once("error", reject);
    filho.once("exit", codigo => reject(new Error(`Servidor encerrou antes de iniciar (${codigo}): ${logs}`)));
    filho.stdout.on("data", dados => {
      logs += String(dados);
      if (logs.includes("Server listening at")) resolve();
    });
    filho.stderr.on("data", dados => { logs += String(dados); });
  });
  try {
    await pronto;
    assert.equal((await fetch(`http://${config.host}:${port}/health`)).status, 200);
    filho.kill("SIGTERM");
    const [codigo] = await saiu;
    if (process.platform !== "win32") {
      assert.equal(codigo, 0, logs);
      assert.match(logs, /Finalizando requisições e conexões/);
    }
  } finally {
    if (filho.exitCode === null && filho.signalCode === null) filho.kill("SIGKILL");
    await saiu;
  }
});

test("seed reverte a carga se organização de exemplo já existir sem contrato válido", async () => {
  const prisma = criarPrisma(banco.url);
  try {
    const organizacao = await prisma.organizacao.create({ data: {
      cnpj: "11222333000181", razaoSocial: "Cadastro pré-existente", enderecoCompleto: "Rua existente, 1",
      telefone: "11999990000", email: "existente@example.com",
    } });
    await assert.rejects(popularBanco(prisma, "Senha-de-teste-seed-2026!"), /contrato vigente/);
    assert.equal(await prisma.usuario.count(), 0);
    assert.equal(await prisma.lote.count(), 0);
    assert.equal(await prisma.auditoria.count(), 0);
    assert.equal(await prisma.organizacao.count(), 1);
    assert.equal((await prisma.organizacao.findUniqueOrThrow({ where: { id: organizacao.id } })).razaoSocial, "Cadastro pré-existente");
  } finally { await prisma.$disconnect(); }
});

test("conflito de serialização no COMMIT é traduzido para 409 e libera as conexões", { timeout: 15000 }, async () => {
  const prisma = criarPrisma(banco.url);
  const unidade = new BancoDados(prisma);
  let liberar!: () => void;
  const barreira = new Promise<void>(resolve => { liberar = resolve; });
  let leituras = 0;
  try {
    const usuarios = await Promise.all(["commit-a", "commit-b"].map(usuario => prisma.usuario.create({
      data: { usuario, hashSenha: "sem-login-neste-teste", papel: "ADMINISTRADOR" },
    })));
    const resultados = await Promise.allSettled(usuarios.map(usuario => unidade.transacao(async repos => {
      await repos.usuarios.contarAdministradoresAtivos();
      if (++leituras === 2) liberar();
      await barreira;
      return repos.usuarios.atualizar(usuario.id, usuario.versao, { ativo: false });
    })));
    assert.equal(resultados.filter(item => item.status === "fulfilled").length, 1);
    const falha = resultados.find(item => item.status === "rejected");
    assert.ok(falha?.status === "rejected" && falha.reason instanceof ErroAplicacao);
    assert.equal(falha.reason.status, 409);
    assert.equal(falha.reason.codigo, "CONFLITO_VERSAO");
  } finally { liberar(); await prisma.$disconnect(); }
});
