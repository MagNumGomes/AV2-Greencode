export class ErroAplicacao extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensagem: string,
  ) {
    super(mensagem);
  }
}

export function exigir(condicao: unknown, mensagem: string): asserts condicao {
  if (!condicao) throw new ErroAplicacao(422, "REGRA_NEGOCIO", mensagem);
}

export function encontrado<T>(valor: T | null, entidade: string): T {
  if (valor === null) throw new ErroAplicacao(404, "NAO_ENCONTRADO", `${entidade} não encontrado(a).`);
  return valor;
}

export function conferirVersao(atual: number, informada: number): void {
  if (atual !== informada) conflitoVersao();
}

export function conflitoVersao(): never {
  throw new ErroAplicacao(409, "CONFLITO_VERSAO", "Registro alterado por outra operação. Consulte novamente e utilize a versão atual.");
}
