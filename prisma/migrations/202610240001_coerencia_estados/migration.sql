BEGIN;

-- Valida o estado FINAL da transação: a triagem atualiza lote e equipamentos
-- em instruções distintas, mas todos precisam estar coerentes no COMMIT.
CREATE FUNCTION validar_coerencia_lote(lote_id UUID) RETURNS void AS $$
DECLARE
  estado "StatusLote";
BEGIN
  SELECT "statusProcessamento" INTO estado FROM "Lote" WHERE "id" = lote_id FOR NO KEY UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF estado <> 'RECEBIDO' AND NOT EXISTS (SELECT 1 FROM "Equipamento" WHERE "loteId" = lote_id) THEN
    RAISE EXCEPTION 'Lote em processamento deve possuir equipamentos.' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "Equipamento" WHERE "loteId" = lote_id AND (
      (estado = 'RECEBIDO' AND "statusRastreamento" <> 'AGUARDANDO_TRIAGEM') OR
      (estado = 'EM_TRIAGEM' AND "statusRastreamento" <> 'EM_TRIAGEM') OR
      (estado IN ('TRIAGEM_CONCLUIDA', 'ENCAMINHADO') AND "statusRastreamento" IN ('AGUARDANDO_TRIAGEM', 'EM_TRIAGEM')) OR
      (estado = 'FINALIZADO' AND "statusRastreamento" <> 'BAIXA_DEFINITIVA')
    )
  ) THEN
    RAISE EXCEPTION 'Estado do equipamento incompatível com a etapa do lote.' USING ERRCODE = '23514';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION conferir_lote_no_commit() RETURNS trigger AS $$
BEGIN
  PERFORM validar_coerencia_lote(NEW."id");
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION conferir_equipamento_no_commit() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM validar_coerencia_lote(NEW."loteId");
  END IF;
  IF TG_OP = 'DELETE' THEN
    PERFORM validar_coerencia_lote(OLD."loteId");
  ELSIF TG_OP = 'UPDATE' AND OLD."loteId" IS DISTINCT FROM NEW."loteId" THEN
    PERFORM validar_coerencia_lote(OLD."loteId");
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER lote_estado_coerente
  AFTER INSERT OR UPDATE ON "Lote" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conferir_lote_no_commit();

CREATE CONSTRAINT TRIGGER equipamento_estado_coerente
  AFTER INSERT OR UPDATE OR DELETE ON "Equipamento" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION conferir_equipamento_no_commit();

-- Também verifica bancos previamente populados antes de concluir a migração.
DO $$
DECLARE registro RECORD;
BEGIN
  FOR registro IN SELECT "id" FROM "Lote" LOOP
    PERFORM validar_coerencia_lote(registro."id");
  END LOOP;
END;
$$;

COMMIT;
