-- Restrições complementares que não são expressas pelo schema declarativo do Prisma.
ALTER TABLE "Usuario"
  ADD CONSTRAINT "Usuario_versoes_positivas" CHECK ("versao" > 0 AND "tokenVersao" > 0),
  ADD CONSTRAINT "Usuario_nome_valido" CHECK ("usuario" ~ '^[a-z0-9._-]{3,60}$');

ALTER TABLE "Organizacao"
  ADD CONSTRAINT "Organizacao_versao_positiva" CHECK ("versao" > 0),
  ADD CONSTRAINT "Organizacao_cnpj_numerico" CHECK ("cnpj" ~ '^[0-9]{14}$'),
  ADD CONSTRAINT "Organizacao_dados_obrigatorios" CHECK (length(btrim("razaoSocial")) > 0 AND length(btrim("enderecoCompleto")) > 0);

ALTER TABLE "Contrato"
  ADD CONSTRAINT "Contrato_versao_positiva" CHECK ("versao" > 0),
  ADD CONSTRAINT "Contrato_vigencia_valida" CHECK ("dataVencimento" > "dataAssinatura"),
  ADD CONSTRAINT "Contrato_valor_nao_negativo" CHECK ("valorMensal" >= 0),
  ADD CONSTRAINT "Contrato_clausulas_array" CHECK (jsonb_typeof("clausulas") = 'array');

ALTER TABLE "Lote"
  ADD CONSTRAINT "Lote_versao_positiva" CHECK ("versao" > 0),
  ADD CONSTRAINT "Lote_identificacao_obrigatoria" CHECK (length(btrim("notaFiscal")) > 0 AND length(btrim("transportadora")) > 0);

ALTER TABLE "Equipamento"
  ADD CONSTRAINT "Equipamento_versao_positiva" CHECK ("versao" > 0),
  ADD CONSTRAINT "Equipamento_peso_positivo" CHECK ("pesoQuilogramas" > 0),
  ADD CONSTRAINT "Equipamento_posicao_positiva" CHECK ("posicaoNoLote" > 0),
  ADD CONSTRAINT "Equipamento_ano_valido" CHECK ("anoFabricacao" BETWEEN 1900 AND 9999),
  ADD CONSTRAINT "Equipamento_codigo_valido" CHECK ("codigoBarrasInterno" ~ '^[A-Za-z0-9_-]+$');

ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_versao_imutavel" CHECK ("versao" = 1);
ALTER TABLE "Auditoria" ADD CONSTRAINT "Auditoria_versao_imutavel" CHECK ("versao" = 1);

-- Histórico é somente de acréscimo, inclusive para escritas SQL diretas.
CREATE FUNCTION bloquear_alteracao_historico() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Registros de % são imutáveis.', TG_TABLE_NAME USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER movimentacao_imutavel BEFORE UPDATE OR DELETE ON "Movimentacao"
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_historico();
CREATE TRIGGER auditoria_imutavel BEFORE UPDATE OR DELETE ON "Auditoria"
  FOR EACH ROW EXECUTE FUNCTION bloquear_alteracao_historico();
