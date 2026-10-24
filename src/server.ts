import "dotenv/config";
import { criarApp } from "./app.js";
import { lerConfiguracao } from "./config.js";

async function iniciar() {
  const config = lerConfiguracao();
  const app = criarApp(config);
  let encerrando = false;
  const encerrar = async (sinal: string) => {
    if (encerrando) return;
    encerrando = true;
    app.log.info({ sinal }, "Finalizando requisições e conexões");
    const limite = setTimeout(() => {
      app.log.error("Tempo de encerramento excedido");
      process.exit(1);
    }, 30000).unref();
    try { await app.close(); }
    catch (erro) { app.log.error(erro); process.exitCode = 1; }
    finally { clearTimeout(limite); }
  };
  process.once("SIGINT", () => void encerrar("SIGINT"));
  process.once("SIGTERM", () => void encerrar("SIGTERM"));
  try { await app.listen({ host: config.host, port: config.port }); }
  catch (erro) {
    app.log.error(erro);
    await app.close();
    process.exitCode = 1;
  }
}

iniciar().catch(erro => { console.error(erro instanceof Error ? erro.message : erro); process.exitCode = 1; });
