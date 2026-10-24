import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const derivar = promisify(scrypt);

export class Senha {
  static async gerar(senha: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const hash = await derivar(senha, salt, 64) as Buffer;
    return `scrypt:${salt}:${hash.toString("hex")}`;
  }

  static async verificar(senha: string, armazenado: string): Promise<boolean> {
    const [algoritmo, salt, hash] = armazenado.split(":");
    if (algoritmo !== "scrypt" || !salt || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
    const atual = await derivar(senha, salt, 64) as Buffer;
    return timingSafeEqual(atual, Buffer.from(hash, "hex"));
  }
}
