import "dotenv/config";
import { criarPrisma } from "../src/infrastructure/prisma.js";
import { popularBanco } from "./dadosExemplo.js";

async function executar() {
  if (!process.env.DATABASE_URL || !process.env.SEED_PASSWORD) {
    throw new Error("Configure DATABASE_URL e SEED_PASSWORD no arquivo .env antes de executar o seed.");
  }
  const prisma = criarPrisma(process.env.DATABASE_URL);
  try { console.log(await popularBanco(prisma, process.env.SEED_PASSWORD)); }
  finally { await prisma.$disconnect(); }
}

executar().catch(erro => { console.error(erro); process.exitCode = 1; });
