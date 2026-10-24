export interface Configuracao {
  databaseUrl: string;
  host: string;
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  corsOrigins: string[];
}

export function lerConfiguracao(env: NodeJS.ProcessEnv = process.env): Configuracao {
  const databaseUrl = env.DATABASE_URL ?? "";
  if (!/^postgres(ql)?:\/\//.test(databaseUrl)) throw new Error("Configure DATABASE_URL com a conexão PostgreSQL.");
  const jwtSecret = env.JWT_SECRET ?? "";
  if (Buffer.byteLength(jwtSecret) < 32) throw new Error("JWT_SECRET deve conter pelo menos 32 bytes.");
  const port = Number(env.PORT ?? 3333);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT deve ser um inteiro entre 1 e 65535.");
  const jwtExpiresIn = env.JWT_EXPIRES_IN ?? "30m";
  if (!/^[1-9]\d*(s|m|h)$/.test(jwtExpiresIn)) throw new Error("JWT_EXPIRES_IN deve usar segundos, minutos ou horas, por exemplo 30m.");
  return {
    databaseUrl, jwtSecret, port, jwtExpiresIn, host: env.HOST ?? "127.0.0.1",
    corsOrigins: (env.CORS_ORIGINS ?? "").split(",").map(item => item.trim()).filter(Boolean),
  };
}
