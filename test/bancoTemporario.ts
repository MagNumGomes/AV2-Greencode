import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";

export async function portaLivre(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const endereco = server.address();
      if (!endereco || typeof endereco === "string") return reject(new Error("Não foi possível reservar uma porta."));
      server.close(erro => erro ? reject(erro) : resolve(endereco.port));
    });
  });
}

export async function bancoTemporario() {
  const base = process.platform === "win32" && process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, "Temp", "opencode") : tmpdir();
  await mkdir(base, { recursive: true });
  const diretorio = await mkdtemp(join(base, "greencode-av2-test-"));
  const porta = await portaLivre();
  const logs: string[] = [];
  const pg = new EmbeddedPostgres({
    databaseDir: join(diretorio, "pg"), user: "greencode_test", password: "senha-apenas-testes",
    port: porta, persistent: false, authMethod: "scram-sha-256",
    initdbFlags: ["--encoding=UTF8", "--locale=C"], postgresFlags: ["-c", "listen_addresses=127.0.0.1"],
    onLog: mensagem => logs.push(String(mensagem)), onError: mensagem => logs.push(String(mensagem)),
  });
  const fechar = async () => {
    await pg.stop();
    await rm(diretorio, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("greencode_test");
    const url = `postgresql://greencode_test:senha-apenas-testes@127.0.0.1:${porta}/greencode_test?schema=public`;
    await promisify(execFile)(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url }, timeout: 60000,
    });
    return { url, fechar };
  } catch (erro) {
    await fechar().catch(() => undefined);
    throw new Error(`Falha ao preparar PostgreSQL temporário: ${logs.join("\n")}`, { cause: erro });
  }
}
