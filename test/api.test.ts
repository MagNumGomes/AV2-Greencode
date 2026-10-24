import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { FastifyInstance, HTTPMethods } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { Static } from "@sinclair/typebox";
import { criarApp } from "../src/app.js";
import { criarPrisma } from "../src/infrastructure/prisma.js";
import { popularBanco } from "../prisma/dadosExemplo.js";
import { bancoTemporario } from "./bancoTemporario.js";
import * as S from "../src/http/schemas.js";

type Organizacao = Static<typeof S.OrganizacaoResposta>;
type Lote = Static<typeof S.LoteResposta>;
type Equipamento = Static<typeof S.RastreabilidadeResposta>;
type Usuario = Static<typeof S.UsuarioResposta>;
type Login = Static<typeof S.LoginResposta>;

let app: FastifyInstance;
let prisma: PrismaClient;
let banco: Awaited<ReturnType<typeof bancoTemporario>>;
const senha = "Teste-Greencode-2026!";
const tokens: Record<string, string> = {};
let organizacao: Organizacao;
let lote: Lote;
let equipamento: Equipamento;

async function requisicao(method: HTTPMethods, url: string, payload?: object, usuario = "admin", status = 200) {
  const resposta = await app.inject({ method, url, payload, headers: tokens[usuario] ? { authorization: `Bearer ${tokens[usuario]}` } : {} });
  assert.equal(resposta.statusCode, status, `${method} ${url}: ${resposta.body}`);
  return resposta;
}

const entradaEquipamento = (codigo = "GC-TESTE-01") => ({
  codigoBarrasInterno: codigo, tipo: "NOTEBOOK", marca: "Marca", modelo: "Modelo", anoFabricacao: new Date().getUTCFullYear(),
  estadoFisico: "BOM_ESTADO", pesoQuilogramas: "2.500",
});
const entradaOrganizacao = () => ({
  razaoSocial: "Organização da jornada", cnpj: "40.688.134/0001-61", enderecoCompleto: "Rua de Testes, 1",
  telefone: "11988887777", email: "contato@teste.example",
  contrato: {
    dataAssinatura: new Date(Date.now() - 100 * 86400000).toISOString(),
    dataVencimento: new Date(Date.now() + 365 * 86400000).toISOString(),
    clausulas: ["Coleta e rastreabilidade"], valorMensal: "0.10", renovacaoAutomatica: false,
  },
});
const entradaLote = (equipamentos = [entradaEquipamento()]) => ({
  organizacaoId: organizacao.id, dataEntrada: new Date(Date.now() - 60000).toISOString(),
  notaFiscal: "NF-TESTE", transportadora: "Transporte Teste", equipamentos,
});

before(async () => {
  banco = await bancoTemporario();
  prisma = criarPrisma(banco.url);
  await popularBanco(prisma, senha);
  app = criarApp({ databaseUrl: banco.url, host: "127.0.0.1", port: 3333, jwtSecret: "chave-exclusiva-dos-testes-com-32-caracteres", jwtExpiresIn: "30m", corsOrigins: [] }, { prisma, logger: false });
  await app.ready();
  for (const usuario of ["admin", "operador", "gestor", "auditor"]) {
    const resposta = await requisicao("POST", "/api/auth/login", { usuario, senha });
    tokens[usuario] = resposta.json<Login>().token;
  }
}, { timeout: 120000 });

after(async () => {
  if (app) await app.close();
  else if (prisma) await prisma.$disconnect();
  if (banco) await banco.fechar();
});

test("migrações, seed idempotente, health e documentação OpenAPI", async () => {
  assert.equal((await popularBanco(prisma, "outra-senha-preservada")).registrosRaizCriados, 0);
  assert.equal(await prisma.usuario.count(), 4);
  assert.equal(await prisma.lote.count(), 4);
  await requisicao("POST", "/api/auth/login", { usuario: "admin", senha });
  await requisicao("GET", "/health");
  const docs = await requisicao("GET", "/docs/json");
  const documento = docs.json<{ paths: Record<string, unknown> }>();
  assert.ok(documento.paths["/api/lotes/{id}/status"]);
  assert.ok(Object.keys(documento.paths).length >= 20);
  const ui = await requisicao("GET", "/docs/");
  assert.match(ui.body, /swagger/i);
});

test("autenticação recusa senha, token inválido/expirado e acesso sem credenciais", async () => {
  await requisicao("POST", "/api/auth/login", { usuario: "admin", senha: "incorreta" }, "sem-token", 401);
  await requisicao("GET", "/api/organizacoes", undefined, "sem-token", 401);
  tokens.invalido = "jwt.invalido.assinatura";
  await requisicao("GET", "/api/organizacoes", undefined, "invalido", 401);
  const claims = app.jwt.decode(tokens.admin!) as { sub: string; papel: "ADMINISTRADOR"; tokenVersao: number };
  tokens.expirado = app.jwt.sign({ sub: claims.sub, papel: claims.papel, tokenVersao: claims.tokenVersao }, { expiresIn: -1000 });
  await requisicao("GET", "/api/organizacoes", undefined, "expirado", 401);
});

test("JWT com assinatura válida e identificador malformado retorna 401, não erro do banco", async () => {
  tokens.malformado = app.jwt.sign({ sub: "-".repeat(36), papel: "ADMINISTRADOR", tokenVersao: 1 });
  await requisicao("GET", "/api/auth/me", undefined, "malformado", 401);
  await requisicao("POST", "/api/auth/login", { usuario: "nao-existe", senha }, "sem-token", 401);
});

test("papéis são aplicados no servidor e respostas não expõem credenciais", async () => {
  await requisicao("POST", "/api/organizacoes", entradaOrganizacao(), "auditor", 403);
  await requisicao("POST", "/api/organizacoes", entradaOrganizacao(), "gestor", 403);
  await requisicao("GET", "/api/usuarios", undefined, "operador", 403);
  const resposta = await requisicao("GET", "/api/usuarios");
  assert.doesNotMatch(resposta.body, /hashSenha|scrypt|tokenVersao/);
  const corpo = await requisicao("POST", "/api/organizacoes", { ...entradaOrganizacao(), papel: "ADMINISTRADOR" }, "admin", 400);
  assert.ok(corpo.json<{ requestId: string }>().requestId);
});

test("organização/contrato são criados juntos, CNPJ é normalizado e duplicatas recusadas", async () => {
  const resposta = await requisicao("POST", "/api/organizacoes", entradaOrganizacao(), "operador", 201);
  organizacao = resposta.json<Organizacao>();
  assert.equal(organizacao.cnpj, "40688134000161");
  assert.equal(organizacao.contrato?.valorMensal, "0.1");
  assert.equal(organizacao.versao, 1);
  assert.equal(resposta.headers.location, `/api/organizacoes/${organizacao.id}`);
  await requisicao("POST", "/api/organizacoes", { ...entradaOrganizacao(), cnpj: "40688134000161" }, "admin", 409);
  await requisicao("POST", "/api/organizacoes", { ...entradaOrganizacao(), cnpj: "00000000000000" }, "admin", 422);
});

test("organização aceita contrato opcional, exige contrato para lote e protege renovação por versão", async () => {
  const semContrato = await prisma.organizacao.findUniqueOrThrow({ where: { cnpj: "04252011000110" } });
  await requisicao("POST", "/api/lotes", { ...entradaLote([]), organizacaoId: semContrato.id }, "gestor", 422);
  const contrato = (await requisicao("POST", `/api/organizacoes/${semContrato.id}/contrato`, {
    ...entradaOrganizacao().contrato, valorMensal: "0.20", versao: semContrato.versao,
  }, "operador", 201)).json<Static<typeof S.ContratoResposta>>();
  const dataVencimento = new Date(Date.now() + 400 * 86400000).toISOString();
  const renovado = (await requisicao("PATCH", `/api/contratos/${contrato.id}/renovacao`, { versao: 1, dataVencimento }, "operador")).json<Static<typeof S.ContratoResposta>>();
  assert.equal(renovado.versao, 2);
  await requisicao("PATCH", `/api/contratos/${contrato.id}/renovacao`, { versao: 1, dataVencimento }, "operador", 409);
});

test("datas e dados de equipamento inválidos não deixam registros parciais", async () => {
  await requisicao("POST", "/api/lotes", { ...entradaLote(), dataEntrada: new Date(Date.now() + 86400000).toISOString() }, "gestor", 422);
  await requisicao("POST", "/api/lotes", { ...entradaLote(), dataEntrada: new Date(Date.now() - 91 * 86400000).toISOString() }, "gestor", 422);
  await requisicao("POST", "/api/lotes", entradaLote([{ ...entradaEquipamento(), pesoQuilogramas: "0" }]), "gestor", 422);
  await requisicao("POST", "/api/lotes", entradaLote([{ ...entradaEquipamento(), anoFabricacao: new Date().getUTCFullYear() + 1 }]), "gestor", 422);
  assert.equal(await prisma.lote.count({ where: { organizacaoId: organizacao.id } }), 0);
});

test("falha no segundo equipamento reverte lote, primeiro equipamento, movimentação e auditoria", async () => {
  const antes = await Promise.all([prisma.lote.count(), prisma.equipamento.count(), prisma.movimentacao.count(), prisma.auditoria.count()]);
  await requisicao("POST", "/api/lotes", entradaLote([entradaEquipamento("GC-DUPLICADO"), entradaEquipamento("GC-DUPLICADO")]), "gestor", 409);
  const depois = await Promise.all([prisma.lote.count(), prisma.equipamento.count(), prisma.movimentacao.count(), prisma.auditoria.count()]);
  assert.deepEqual(depois, antes);
});

test("jornada: receber, adicionar equipamento, iniciar e concluir triagem", async () => {
  await requisicao("POST", "/api/lotes", entradaLote(), "operador", 403);
  lote = (await requisicao("POST", "/api/lotes", entradaLote(), "gestor", 201)).json<Lote>();
  const id = lote.equipamentos![0]!.id;
  await requisicao("PATCH", `/api/equipamentos/${id}/status`, { versao: 1, status: "EM_DESMONTE", justificativa: "Tentativa prematura" }, "gestor", 422);
  lote = (await requisicao("POST", `/api/lotes/${lote.id}/equipamentos`, { versao: lote.versao, equipamentos: [entradaEquipamento("GC-TESTE-02")] }, "gestor", 201)).json<Lote>();
  assert.equal(lote.equipamentos!.length, 2);
  assert.equal(lote.equipamentos![1]!.posicaoNoLote, 2);
  for (const status of ["EM_TRIAGEM", "TRIAGEM_CONCLUIDA"]) {
    lote = (await requisicao("PATCH", `/api/lotes/${lote.id}/status`, { versao: lote.versao, status, justificativa: "Triagem verificada" }, "gestor")).json<Lote>();
  }
  assert.ok(lote.equipamentos!.every(item => item.statusRastreamento === "AGUARDANDO_DESMONTE"));
  equipamento = (await requisicao("GET", `/api/equipamentos/${id}`, undefined, "auditor")).json<Equipamento>();
  assert.deepEqual(equipamento.historicoMovimentacao.map(item => item.destino), ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTE"]);
  assert.ok(equipamento.historicoMovimentacao.every(item => item.responsavel === "gestor"));
  await requisicao("POST", `/api/lotes/${lote.id}/equipamentos`, { versao: lote.versao, equipamentos: [entradaEquipamento("GC-TARDIO")] }, "gestor", 422);
});

test("rebaixamento exige justificativa nesta operação e não reutiliza justificativa anterior", async () => {
  await requisicao("PATCH", `/api/equipamentos/${equipamento.id}/estado-fisico`, { versao: equipamento.versao, estadoFisico: "DANIFICADO_GRAVE" }, "gestor", 422);
  const alterado = (await requisicao("PATCH", `/api/equipamentos/${equipamento.id}/estado-fisico`, {
    versao: equipamento.versao, estadoFisico: "DANIFICADO_GRAVE", justificativa: "Dano interno constatado durante inspeção.",
  }, "gestor")).json<Equipamento>();
  assert.equal(alterado.versao, equipamento.versao + 1);
  equipamento = (await requisicao("GET", `/api/equipamentos/${equipamento.id}`)).json<Equipamento>();
  assert.equal(equipamento.historicoMovimentacao.at(-1)!.tipo, "ESTADO_FISICO");
});

test("duas atualizações concorrentes com a mesma versão geram exatamente um sucesso", async () => {
  const total = equipamento.historicoMovimentacao.length;
  const respostas = await Promise.all(["Bancada A", "Bancada B"].map(destino => app.inject({
    method: "POST", url: `/api/equipamentos/${equipamento.id}/movimentacoes`,
    headers: { authorization: `Bearer ${tokens.gestor}` },
    payload: { versao: equipamento.versao, destino, justificativa: "Transferência concorrente" },
  })));
  assert.deepEqual(respostas.map(item => item.statusCode).sort(), [201, 409], respostas.map(item => item.body).join("\n"));
  const atualizado = (await requisicao("GET", `/api/equipamentos/${equipamento.id}`)).json<Equipamento>();
  assert.equal(atualizado.versao, equipamento.versao + 1);
  assert.equal(atualizado.historicoMovimentacao.length, total + 1);
  equipamento = atualizado;
});

test("falha de persistência do histórico reverte status, versão do lote e auditoria", async () => {
  const antes = await prisma.equipamento.findUniqueOrThrow({ where: { id: equipamento.id }, include: { lote: true } });
  const movimentos = await prisma.movimentacao.count();
  const auditorias = await prisma.auditoria.count();
  await prisma.$executeRawUnsafe(`ALTER TABLE "Movimentacao" ADD CONSTRAINT "falha_controlada_teste" CHECK ("observacao" <> 'FALHA_TRANSACIONAL_TESTE')`);
  try {
    const resposta = await app.inject({ method: "PATCH", url: `/api/equipamentos/${equipamento.id}/status`,
      headers: { authorization: `Bearer ${tokens.gestor}` }, payload: { versao: equipamento.versao, status: "EM_DESMONTE", justificativa: "FALHA_TRANSACIONAL_TESTE" } });
    assert.equal(resposta.statusCode, 422, resposta.body);
    const depois = await prisma.equipamento.findUniqueOrThrow({ where: { id: equipamento.id }, include: { lote: true } });
    assert.deepEqual(depois, antes);
    assert.equal(await prisma.movimentacao.count(), movimentos);
    assert.equal(await prisma.auditoria.count(), auditorias);
  } finally {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Movimentacao" DROP CONSTRAINT "falha_controlada_teste"`);
  }
});

test("jornada: destinação, baixa definitiva, finalização e bloqueio de alterações posteriores", async () => {
  lote = (await requisicao("GET", `/api/lotes/${lote.id}`)).json<Lote>();
  lote = (await requisicao("PATCH", `/api/lotes/${lote.id}/status`, { versao: lote.versao, status: "ENCAMINHADO", justificativa: "Encaminhado à destinação" }, "gestor")).json<Lote>();
  await requisicao("PATCH", `/api/lotes/${lote.id}/status`, { versao: lote.versao, status: "FINALIZADO", justificativa: "Tentativa antecipada" }, "gestor", 422);
  for (const item of lote.equipamentos!) {
    let atual = item;
    for (const status of ["EM_DESMONTE", "MATERIAL_RECICLAVEL", "BAIXA_DEFINITIVA"]) {
      atual = (await requisicao("PATCH", `/api/equipamentos/${item.id}/status`, { versao: atual.versao, status, justificativa: "Destinação registrada" }, "gestor")).json<Equipamento>();
    }
    await requisicao("PATCH", `/api/equipamentos/${item.id}/estado-fisico`, { versao: atual.versao, estadoFisico: "INSERVIVEL", justificativa: "Tentativa após baixa" }, "gestor", 422);
  }
  lote = (await requisicao("GET", `/api/lotes/${lote.id}`)).json<Lote>();
  assert.equal(lote.pesoTotalQuilogramas, "5.000");
  lote = (await requisicao("PATCH", `/api/lotes/${lote.id}/status`, { versao: lote.versao, status: "FINALIZADO", justificativa: "Destinações concluídas" }, "gestor")).json<Lote>();
  assert.equal(lote.statusProcessamento, "FINALIZADO");
});

test("relatórios, filtros/paginação e soma monetária decimal são consistentes", async () => {
  const inicio = new Date(Date.now() - 86400000).toISOString();
  const fim = new Date(Date.now() + 86400000).toISOString();
  const query = new URLSearchParams({ inicio, fim });
  const financeiro = (await requisicao("GET", `/api/relatorios/financeiro?${query}`, undefined, "auditor")).json<Static<typeof S.RelatorioFinanceiro>>();
  assert.equal(financeiro.valorMensalTotal, "1500.80");
  const operacional = (await requisicao("GET", `/api/relatorios/organizacoes/${organizacao.id}?${query}`, undefined, "auditor")).json<Static<typeof S.RelatorioOrganizacao>>();
  assert.equal(operacional.totalEquipamentos, 2);
  assert.equal(operacional.pesoTotalQuilogramas, "5.000");
  const lista = (await requisicao("GET", `/api/lotes?organizacaoId=${organizacao.id}&status=FINALIZADO&limite=1`)).json<{ total: number; dados: Lote[] }>();
  assert.equal(lista.total, 1);
  assert.equal(lista.dados[0]!.id, lote.id);
  await requisicao("GET", `/api/lotes?inicio=${encodeURIComponent(fim)}&fim=${encodeURIComponent(inicio)}`, undefined, "admin", 422);
  await requisicao("GET", "/api/lotes?limite=101", undefined, "admin", 400);
  await requisicao("GET", `/api/relatorios/financeiro?${query}`, undefined, "gestor", 403);
});

test("consultas documentadas, filtros e erros 400/404 funcionam com os quatro papéis", async () => {
  for (const papel of ["admin", "operador", "gestor", "auditor"]) {
    await requisicao("GET", "/api/auth/me", undefined, papel);
    await requisicao("GET", `/api/organizacoes/${organizacao.id}`, undefined, papel);
    await requisicao("GET", "/api/organizacoes?ativo=true&limite=1", undefined, papel);
    const lista = (await requisicao("GET", "/api/equipamentos?codigoBarrasInterno=GC-TESTE-01", undefined, papel)).json<{ total: number }>();
    assert.equal(lista.total, 1);
  }
  const relatorio = (await requisicao("GET", "/api/relatorios/status?status=BAIXA_DEFINITIVA", undefined, "auditor")).json<{ total: number }>();
  assert.equal(relatorio.total, 3);
  await requisicao("GET", "/api/equipamentos/00000000-0000-4000-8000-000000000000", undefined, "admin", 404);
  await requisicao("GET", "/api/equipamentos/identificador-invalido", undefined, "admin", 400);
  await requisicao("GET", "/api/lotes?status=INVALIDO", undefined, "admin", 400);
});

test("unicidade de contrato e chaves estrangeiras são garantidas pelo PostgreSQL", async () => {
  await assert.rejects(prisma.contrato.create({ data: {
    organizacaoId: organizacao.id, dataAssinatura: new Date(), dataVencimento: new Date(Date.now() + 86400000), clausulas: [], valorMensal: "1.00",
  } }), { code: "P2002" });
  await assert.rejects(prisma.lote.create({ data: {
    organizacaoId: "00000000-0000-4000-8000-000000000000", dataEntrada: new Date(), notaFiscal: "SEM-ORG", transportadora: "Teste",
  } }), { code: "P2003" });
});

test("banco impede desmonte antes da triagem e finalização com equipamentos pendentes", async () => {
  const recebido = await prisma.equipamento.findUniqueOrThrow({ where: { codigoBarrasInterno: "GC-DEMO-1" } });
  await assert.rejects(prisma.equipamento.update({ where: { id: recebido.id }, data: { statusRastreamento: "EM_DESMONTE" } }));
  await assert.rejects(prisma.lote.update({ where: { id: recebido.loteId }, data: { statusProcessamento: "FINALIZADO" } }));
  assert.equal((await prisma.equipamento.findUniqueOrThrow({ where: { id: recebido.id } })).statusRastreamento, "AGUARDANDO_TRIAGEM");
  assert.equal((await prisma.lote.findUniqueOrThrow({ where: { id: recebido.loteId } })).statusProcessamento, "RECEBIDO");
});

test("inclusões concorrentes preservam versão do lote, posições únicas e códigos gerados", async () => {
  const orgSeed = await prisma.organizacao.findUniqueOrThrow({ where: { cnpj: "11222333000181" } });
  let recebido = (await requisicao("POST", "/api/lotes", { ...entradaLote([]), organizacaoId: orgSeed.id }, "gestor", 201)).json<Lote>();
  await requisicao("PATCH", `/api/lotes/${recebido.id}/status`, { versao: 1, status: "EM_TRIAGEM", justificativa: "Lote vazio" }, "gestor", 422);
  const { codigoBarrasInterno: _codigo, ...dados } = entradaEquipamento();
  const respostas = await Promise.all([1, 2].map(() => app.inject({
    method: "POST", url: `/api/lotes/${recebido.id}/equipamentos`, headers: { authorization: `Bearer ${tokens.gestor}` },
    payload: { versao: recebido.versao, equipamentos: [dados] },
  })));
  assert.deepEqual(respostas.map(item => item.statusCode).sort(), [201, 409], respostas.map(item => item.body).join("\n"));
  recebido = (await requisicao("GET", `/api/lotes/${recebido.id}`)).json<Lote>();
  assert.equal(recebido.equipamentos!.length, 1);
  assert.equal(recebido.equipamentos![0]!.posicaoNoLote, 1);
  assert.match(recebido.equipamentos![0]!.codigoBarrasInterno, /^GC-[0-9a-f-]{36}$/);
});

test("falha no segundo histórico de triagem reverte lote e todos os equipamentos", async () => {
  const orgSeed = await prisma.organizacao.findUniqueOrThrow({ where: { cnpj: "11222333000181" } });
  const recebido = (await requisicao("POST", "/api/lotes", {
    ...entradaLote([entradaEquipamento("GC-TRIAGEM-1"), entradaEquipamento("GC-TRIAGEM-2")]), organizacaoId: orgSeed.id,
  }, "gestor", 201)).json<Lote>();
  const segundoId = recebido.equipamentos![1]!.id;
  const antes = await prisma.lote.findUniqueOrThrow({ where: { id: recebido.id }, include: { equipamentos: { orderBy: { posicaoNoLote: "asc" } } } });
  const contagens = await Promise.all([prisma.movimentacao.count(), prisma.auditoria.count()]);
  // Identificador gerado pelo banco, validado como UUID; não contém entrada externa.
  assert.match(segundoId, /^[0-9a-f-]{36}$/);
  await prisma.$executeRawUnsafe(`ALTER TABLE "Movimentacao" ADD CONSTRAINT "falha_segunda_triagem" CHECK ("equipamentoId" <> '${segundoId}'::uuid OR "destino" <> 'EM_TRIAGEM')`);
  try {
    await requisicao("PATCH", `/api/lotes/${recebido.id}/status`, { versao: recebido.versao, status: "EM_TRIAGEM", justificativa: "Triagem atômica" }, "gestor", 422);
    assert.deepEqual(await prisma.lote.findUniqueOrThrow({ where: { id: recebido.id }, include: { equipamentos: { orderBy: { posicaoNoLote: "asc" } } } }), antes);
    assert.deepEqual(await Promise.all([prisma.movimentacao.count(), prisma.auditoria.count()]), contagens);
  } finally { await prisma.$executeRawUnsafe(`ALTER TABLE "Movimentacao" DROP CONSTRAINT "falha_segunda_triagem"`); }
});

test("vigência é conferida na data de entrada e contrato inválido não deixa organização parcial", async () => {
  const dados = entradaOrganizacao();
  const expirado = { ...dados.contrato, dataAssinatura: new Date(Date.now() - 30 * 86400000).toISOString(), dataVencimento: new Date(Date.now() - 5 * 86400000).toISOString() };
  await requisicao("POST", "/api/organizacoes", { ...dados, cnpj: "00000000000191", contrato: { ...expirado, dataVencimento: expirado.dataAssinatura } }, "operador", 422);
  assert.equal(await prisma.organizacao.count({ where: { cnpj: "00000000000191" } }), 0);
  const org = (await requisicao("POST", "/api/organizacoes", { ...dados, cnpj: "00000000000191", contrato: expirado }, "operador", 201)).json<Organizacao>();
  await requisicao("POST", "/api/lotes", { ...entradaLote([]), organizacaoId: org.id }, "gestor", 422);
  await requisicao("POST", "/api/lotes", { ...entradaLote([]), organizacaoId: org.id, dataEntrada: new Date(Date.now() - 10 * 86400000).toISOString() }, "gestor", 201);
});

test("auditoria e movimentações são imutáveis no banco e o auditor só consulta", async () => {
  const resposta = await requisicao("GET", `/api/auditoria?entidade=Equipamento&entidadeId=${equipamento.id}`, undefined, "auditor");
  assert.ok(resposta.json<{ total: number }>().total >= 4);
  assert.doesNotMatch(resposta.body, /hashSenha|scrypt/);
  await assert.rejects(prisma.movimentacao.updateMany({ where: { equipamentoId: equipamento.id }, data: { observacao: "reescrever" } }));
  await assert.rejects(prisma.auditoria.deleteMany({ where: { entidadeId: equipamento.id } }));
  await assert.rejects(prisma.equipamento.update({ where: { id: equipamento.id }, data: { pesoQuilogramas: "-1" } }));
  await requisicao("PATCH", `/api/organizacoes/${organizacao.id}`, { versao: organizacao.versao, ativo: false }, "auditor", 403);
});

test("organização desativada não recebe lotes e atualização obsoleta retorna 409", async () => {
  organizacao = (await requisicao("PATCH", `/api/organizacoes/${organizacao.id}`, { versao: organizacao.versao, ativo: false }, "operador")).json<Organizacao>();
  await requisicao("PATCH", `/api/organizacoes/${organizacao.id}`, { versao: organizacao.versao - 1, ativo: true }, "operador", 409);
  await requisicao("POST", "/api/lotes", entradaLote([]), "gestor", 422);
});

test("troca de senha e desativação revogam tokens já emitidos sem expor hashes", async () => {
  let usuario = (await requisicao("POST", "/api/usuarios", { usuario: "novo-auditor", senha, papel: "AUDITOR" }, "admin", 201)).json<Usuario>();
  tokens.novo = (await requisicao("POST", "/api/auth/login", { usuario: usuario.usuario, senha })).json<Login>().token;
  usuario = (await requisicao("PATCH", "/api/auth/senha", { versao: usuario.versao, senhaAntiga: senha, senhaNova: "Nova-senha-testes-2026!" }, "novo")).json<Usuario>();
  await requisicao("GET", "/api/auth/me", undefined, "novo", 401);
  await requisicao("POST", "/api/auth/login", { usuario: usuario.usuario, senha }, "admin", 401);
  tokens.novo = (await requisicao("POST", "/api/auth/login", { usuario: usuario.usuario, senha: "Nova-senha-testes-2026!" })).json<Login>().token;
  await requisicao("PATCH", `/api/usuarios/${usuario.id}`, { versao: usuario.versao, ativo: false });
  await requisicao("GET", "/api/auth/me", undefined, "novo", 401);
  const auditoria = await requisicao("GET", "/api/auditoria?entidade=Usuario");
  assert.doesNotMatch(auditoria.body, /hashSenha|scrypt|Nova-senha-testes/);
});

test("mudança de papel revoga JWT anterior e novos tokens refletem a permissão atual", async () => {
  const usuario = (await requisicao("POST", "/api/usuarios", { usuario: "papel-mutavel", senha, papel: "AUDITOR" }, "admin", 201)).json<Usuario>();
  tokens.mutavel = (await requisicao("POST", "/api/auth/login", { usuario: usuario.usuario, senha })).json<Login>().token;
  await requisicao("PATCH", `/api/usuarios/${usuario.id}`, { versao: usuario.versao, papel: "OPERADOR_CADASTRO" });
  await requisicao("GET", "/api/auth/me", undefined, "mutavel", 401);
  const login = (await requisicao("POST", "/api/auth/login", { usuario: usuario.usuario, senha })).json<Login>();
  assert.equal(login.usuario.papel, "OPERADOR_CADASTRO");
  tokens.mutavel = login.token;
  await requisicao("GET", "/api/auditoria", undefined, "mutavel", 403);
});

test("administradores concorrentes não conseguem desativar todas as contas administrativas", { timeout: 15000 }, async () => {
  const admin = await prisma.usuario.findUniqueOrThrow({ where: { usuario: "admin" } });
  const outro = (await requisicao("POST", "/api/usuarios", { usuario: "outro-admin", senha, papel: "ADMINISTRADOR" }, "admin", 201)).json<Usuario>();
  tokens.outroAdmin = (await requisicao("POST", "/api/auth/login", { usuario: outro.usuario, senha })).json<Login>().token;
  const respostas = await Promise.all([
    { alvo: outro, token: tokens.admin }, { alvo: admin, token: tokens.outroAdmin },
  ].map(({ alvo, token }) => app.inject({ method: "PATCH", url: `/api/usuarios/${alvo.id}`,
    headers: { authorization: `Bearer ${token}` }, payload: { versao: alvo.versao, ativo: false } })));
  assert.equal(respostas.filter(item => item.statusCode === 200).length, 1, respostas.map(item => item.body).join("\n"));
  assert.ok(respostas.some(item => [401, 403, 409, 422].includes(item.statusCode)));
  assert.equal(await prisma.usuario.count({ where: { papel: "ADMINISTRADOR", ativo: true } }), 1);
});
