import { Prisma, PrismaClient } from "@prisma/client";
import { conflitoVersao, ErroAplicacao } from "../domain/erros.js";
import { Repositorios } from "./repositorios/Repositorios.js";

export class BancoDados {
  readonly repositorios: Repositorios;

  constructor(readonly prisma: PrismaClient) {
    this.repositorios = new Repositorios(prisma);
  }

  async transacao<T>(operacao: (repositorios: Repositorios) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(tx => operacao(new Repositorios(tx)), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 15000,
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2034") conflitoVersao();
      // Falhas no COMMIT podem vir diretamente do adaptador, sem código P2034.
      const causa = erro && typeof erro === "object" && "cause" in erro ? erro.cause : undefined;
      if (causa && typeof causa === "object") {
        if (("kind" in causa && causa.kind === "TransactionWriteConflict")
          || ("originalCode" in causa && ["40001", "40P01"].includes(String(causa.originalCode)))) conflitoVersao();
        if ("originalCode" in causa && causa.originalCode === "23514") {
          throw new ErroAplicacao(422, "INTEGRIDADE_DADOS", "A operação viola uma restrição de integridade.");
        }
      }
      throw erro;
    }
  }
}
