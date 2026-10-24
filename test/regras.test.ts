import assert from "node:assert/strict";
import { test } from "node:test";
import { dataValida, normalizarCnpj, validarDataEntrada } from "../src/domain/validacoes.js";
import { RegrasEquipamento } from "../src/domain/RegrasEquipamento.js";
import { Senha } from "../src/infrastructure/Senha.js";
import { lerConfiguracao } from "../src/config.js";

test("CNPJ normaliza máscara, verifica ambos os dígitos e recusa letras/dígitos repetidos", () => {
  assert.equal(normalizarCnpj("11.222.333/0001-81"), "11222333000181");
  for (const valor of ["11222333000182", "00000000000000", "a11222333000181", "1122233300018"]) {
    assert.throws(() => normalizarCnpj(valor));
  }
});

test("janela de entrada inclui exatamente 90 dias, mas não aceita futuro nem datas inválidas", () => {
  const agora = new Date("2026-10-23T12:00:00.000Z");
  const limite = agora.getTime() - 90 * 86400000;
  assert.equal(validarDataEntrada(new Date(limite).toISOString(), agora).getTime(), limite);
  assert.throws(() => validarDataEntrada(new Date(limite - 1).toISOString(), agora));
  assert.throws(() => validarDataEntrada(new Date(agora.getTime() + 1).toISOString(), agora));
  assert.throws(() => validarDataEntrada("inválida", agora));
});

test("datas de domínio verificam calendário, horário e fuso antes da conversão", () => {
  for (const valor of ["2026-02-30T10:00:00Z", "2025-02-29T10:00:00Z", "2026-04-31T10:00:00Z",
    "2026-10-24T24:00:00Z", "2026-10-24T10:60:00Z", "2026-10-24T10:00:00+24:00", "2026-10-24", "0000-01-01T00:00:00Z"]) {
    assert.throws(() => dataValida(valor), valor);
  }
  assert.equal(dataValida("2024-02-29T10:30:00-03:00").toISOString(), "2024-02-29T13:30:00.000Z");
  assert.equal(dataValida("2000-02-29T00:00:00.123Z").getUTCMilliseconds(), 123);
  assert.throws(() => dataValida("1900-02-29T10:00:00Z"));
});

test("depreciação mantém o critério da AV1 e fica limitada a 100%", () => {
  assert.equal(RegrasEquipamento.calcularDepreciacao(2024, "BOM_ESTADO", 2026), 30);
  assert.equal(RegrasEquipamento.calcularDepreciacao(2000, "INSERVIVEL", 2026), 100);
  assert.equal(RegrasEquipamento.calcularDepreciacao(2026, "NOVO", 2026), 0);
});

test("senhas iguais usam salts diferentes e a senha incorreta é recusada", async () => {
  const [primeiro, segundo] = await Promise.all([Senha.gerar("senha-de-teste"), Senha.gerar("senha-de-teste")]);
  assert.notEqual(primeiro, segundo);
  assert.equal(await Senha.verificar("senha-de-teste", primeiro), true);
  assert.equal(await Senha.verificar("outra-senha", primeiro), false);
  assert.equal(await Senha.verificar("senha-de-teste", "hash-inválido"), false);
});

test("configuração exige PostgreSQL, segredo JWT e porta válidos", () => {
  const env = { DATABASE_URL: "postgresql://localhost/greencode", JWT_SECRET: "a".repeat(32) };
  assert.equal(lerConfiguracao(env).port, 3333);
  assert.throws(() => lerConfiguracao({ ...env, PORT: "abc" }));
  assert.throws(() => lerConfiguracao({ ...env, JWT_SECRET: "curto" }));
  assert.throws(() => lerConfiguracao({ ...env, DATABASE_URL: "file:db.sqlite" }));
});
