import { PapelUsuario } from "@prisma/client";
import { ErroAplicacao } from "./erros.js";

export interface UsuarioAutenticado {
  id: string;
  usuario: string;
  papel: PapelUsuario;
}

export function autorizar(usuario: UsuarioAutenticado, ...papeis: PapelUsuario[]): void {
  if (usuario.papel !== PapelUsuario.ADMINISTRADOR && !papeis.includes(usuario.papel)) {
    throw new ErroAplicacao(403, "ACESSO_NEGADO", "Seu papel não permite esta operação.");
  }
}

export function autorizarConsulta(usuario: UsuarioAutenticado): void {
  autorizar(usuario, ...Object.values(PapelUsuario));
}
