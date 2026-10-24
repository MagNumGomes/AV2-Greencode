import { randomBytes } from "node:crypto";
import { PapelUsuario } from "@prisma/client";
import { autorizar, type UsuarioAutenticado } from "../domain/autorizacao.js";
import type { DadosUsuario, Paginacao } from "../domain/dados.js";
import { conferirVersao, encontrado, ErroAplicacao, exigir } from "../domain/erros.js";
import { validarSenha } from "../domain/validacoes.js";
import { BancoDados } from "../infrastructure/BancoDados.js";
import { Senha } from "../infrastructure/Senha.js";

export interface ClaimsJWT { sub: string; papel: PapelUsuario; tokenVersao: number }

export class ServicoAutenticacao {
  private readonly hashFicticio = Senha.gerar(randomBytes(32).toString("hex"));

  constructor(private readonly banco: BancoDados) {}

  async login(nome: string, senha: string) {
    const usuario = await this.banco.repositorios.usuarios.buscarPorNome(nome.trim().toLowerCase());
    const valida = await Senha.verificar(senha, usuario?.hashSenha ?? await this.hashFicticio);
    if (!usuario?.ativo || !valida) throw new ErroAplicacao(401, "CREDENCIAIS_INVALIDAS", "Usuário ou senha inválidos.");
    const claims: ClaimsJWT = { sub: usuario.id, papel: usuario.papel, tokenVersao: usuario.tokenVersao };
    return { claims, usuario: { id: usuario.id, usuario: usuario.usuario, papel: usuario.papel, versao: usuario.versao } };
  }

  async autenticar(claims: ClaimsJWT): Promise<UsuarioAutenticado> {
    if (typeof claims.sub !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(claims.sub)
      || !Number.isInteger(claims.tokenVersao) || claims.tokenVersao < 1 || !Object.values(PapelUsuario).includes(claims.papel)) {
      throw new ErroAplicacao(401, "TOKEN_INVALIDO", "Token inválido.");
    }
    const usuario = await this.banco.repositorios.usuarios.buscar(claims.sub);
    if (!usuario?.ativo || usuario.tokenVersao !== claims.tokenVersao || usuario.papel !== claims.papel) {
      throw new ErroAplicacao(401, "TOKEN_INVALIDO", "Acesso expirado ou revogado. Autentique-se novamente.");
    }
    return { id: usuario.id, usuario: usuario.usuario, papel: usuario.papel };
  }

  listar(ator: UsuarioAutenticado, filtro: Paginacao) {
    autorizar(ator);
    return this.banco.repositorios.usuarios.listar(filtro);
  }

  async me(ator: UsuarioAutenticado) {
    const usuario = encontrado(await this.banco.repositorios.usuarios.buscar(ator.id), "Usuário");
    return { id: usuario.id, usuario: usuario.usuario, papel: usuario.papel, ativo: usuario.ativo, versao: usuario.versao, criadoEm: usuario.criadoEm };
  }

  async criar(ator: UsuarioAutenticado, dados: DadosUsuario) {
    autorizar(ator);
    validarSenha(dados.senha);
    const usuario = dados.usuario.trim().toLowerCase();
    exigir(/^[a-z0-9._-]{3,60}$/.test(usuario), "Usuário deve ter de 3 a 60 letras, números, pontos, hífens ou sublinhados.");
    const hashSenha = await Senha.gerar(dados.senha);
    return this.banco.transacao(async repos => {
      const criado = await repos.usuarios.criar({ usuario, hashSenha, papel: dados.papel });
      await repos.auditoria.registrar(ator, "CRIAR", "Usuario", criado.id, criado);
      return criado;
    });
  }

  async alterar(ator: UsuarioAutenticado, id: string, dados: { versao: number; papel?: PapelUsuario; ativo?: boolean }) {
    autorizar(ator);
    exigir(id !== ator.id, "Um administrador não pode alterar o próprio papel ou desativar a própria conta.");
    exigir(dados.papel !== undefined || dados.ativo !== undefined, "Informe papel ou ativo.");
    return this.banco.transacao(async repos => {
      const contaAtor = encontrado(await repos.usuarios.buscar(ator.id), "Usuário");
      if (!contaAtor.ativo) throw new ErroAplicacao(401, "TOKEN_INVALIDO", "A conta foi desativada durante a operação.");
      autorizar(contaAtor);
      const anterior = encontrado(await repos.usuarios.buscar(id), "Usuário");
      conferirVersao(anterior.versao, dados.versao);
      if (anterior.ativo && anterior.papel === "ADMINISTRADOR"
        && (dados.ativo === false || (dados.papel !== undefined && dados.papel !== "ADMINISTRADOR"))) {
        exigir(await repos.usuarios.contarAdministradoresAtivos() > 1, "O sistema deve manter ao menos um administrador ativo.");
      }
      const atualizado = await repos.usuarios.atualizar(id, dados.versao, { papel: dados.papel, ativo: dados.ativo });
      await repos.auditoria.registrar(ator, "ALTERAR_ACESSO", "Usuario", id, atualizado, { papel: anterior.papel, ativo: anterior.ativo, versao: anterior.versao });
      return atualizado;
    });
  }

  async alterarSenha(ator: UsuarioAutenticado, dados: { versao: number; senhaAntiga: string; senhaNova: string }) {
    validarSenha(dados.senhaNova);
    const anterior = encontrado(await this.banco.repositorios.usuarios.buscar(ator.id), "Usuário");
    conferirVersao(anterior.versao, dados.versao);
    if (!await Senha.verificar(dados.senhaAntiga, anterior.hashSenha)) {
      throw new ErroAplicacao(401, "CREDENCIAIS_INVALIDAS", "Senha atual inválida.");
    }
    const hashSenha = await Senha.gerar(dados.senhaNova);
    return this.banco.transacao(async repos => {
      const atualizado = await repos.usuarios.atualizar(ator.id, dados.versao, { hashSenha });
      await repos.auditoria.registrar(ator, "ALTERAR_SENHA", "Usuario", ator.id, { versao: atualizado.versao });
      return atualizado;
    });
  }
}
