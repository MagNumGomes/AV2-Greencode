import { exigir } from "./erros.js";

export function normalizarCnpj(valor: string): string {
  exigir(/^(\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(valor), "Informe um CNPJ numérico válido, com ou sem máscara.");
  const cnpj = valor.replace(/\D/g, "");
  exigir(!/^(\d)\1{13}$/.test(cnpj), "CNPJ inválido.");
  const calcular = (base: string, pesos: number[]) => {
    const resto = [...base].reduce((soma, digito, indice) => soma + Number(digito) * pesos[indice]!, 0) % 11;
    return resto < 2 ? 0 : 11 - resto;
  };
  const primeiro = calcular(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const segundo = calcular(`${cnpj.slice(0, 12)}${primeiro}`, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  exigir(cnpj === `${cnpj.slice(0, 12)}${primeiro}${segundo}`, "Dígitos verificadores do CNPJ inválidos.");
  return cnpj;
}

export function dataValida(valor: string): Date {
  const partes = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:[Zz]|[+-](\d{2}):(\d{2}))$/.exec(valor);
  exigir(partes, "Informe uma data ISO 8601 completa, com horário e fuso.");
  const [ano, mes, dia, hora, minuto, segundo] = partes.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  const diasNoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  exigir(ano >= 1 && mes >= 1 && mes <= 12 && dia >= 1 && dia <= diasNoMes[mes - 1]!
    && hora <= 23 && minuto <= 59 && segundo <= 59
    && Number(partes[7] ?? 0) <= 23 && Number(partes[8] ?? 0) <= 59, "Data ou horário inexistente.");
  const data = new Date(valor);
  exigir(Number.isFinite(data.getTime()) && data.getUTCFullYear() >= 1 && data.getUTCFullYear() <= 9999, "Data inválida.");
  return data;
}

export function validarDataEntrada(valor: string, agora = new Date()): Date {
  const data = dataValida(valor);
  exigir(data <= agora && data.getTime() >= agora.getTime() - 90 * 86400000,
    "A entrada não pode estar no futuro nem há mais de 90 dias.");
  return data;
}

export function validarPeriodo(inicio?: string, fim?: string): { gte?: Date; lte?: Date } {
  const gte = inicio ? dataValida(inicio) : undefined;
  const lte = fim ? dataValida(fim) : undefined;
  exigir(!gte || !lte || gte <= lte, "O início do período deve ser anterior ou igual ao fim.");
  return { gte, lte };
}

export function validarSenha(senha: string): void {
  exigir(senha.length >= 10 && senha.length <= 128 && /\S/.test(senha), "A senha deve ter entre 10 e 128 caracteres e não pode conter apenas espaços.");
}
