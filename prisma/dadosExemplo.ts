import { Prisma, type PrismaClient, type PapelUsuario, type StatusLote, type StatusRastreamento, type EstadoFisico } from "@prisma/client";
import { Senha } from "../src/infrastructure/Senha.js";
import { validarSenha } from "../src/domain/validacoes.js";
import { exigir } from "../src/domain/erros.js";

export const contasExemplo: { usuario: string; papel: PapelUsuario }[] = [
  { usuario: "admin", papel: "ADMINISTRADOR" },
  { usuario: "operador", papel: "OPERADOR_CADASTRO" },
  { usuario: "gestor", papel: "GESTOR_ALMOXARIFADO" },
  { usuario: "auditor", papel: "AUDITOR" },
];

// Inclusão idempotente: registros existentes nunca têm senha ou dados sobrescritos.
export async function popularBanco(prisma: PrismaClient, senha: string) {
  validarSenha(senha);
  const hashes = await Promise.all(contasExemplo.map(() => Senha.gerar(senha)));
  return prisma.$transaction(async tx => {
    let criados = 0;
    for (const [indice, conta] of contasExemplo.entries()) {
      if (!await tx.usuario.findUnique({ where: { usuario: conta.usuario } })) {
        await tx.usuario.create({ data: { ...conta, hashSenha: hashes[indice]! } });
        criados++;
      }
    }
    const admin = await tx.usuario.findUniqueOrThrow({ where: { usuario: "admin" } });
    const agora = Date.now();
    let organizacao = await tx.organizacao.findUnique({ where: { cnpj: "11222333000181" } });
    if (!organizacao) {
      organizacao = await tx.organizacao.create({ data: {
        razaoSocial: "Circular Tecnologia Ltda. (demonstração)", cnpj: "11222333000181",
        enderecoCompleto: "Rua da Economia Circular, 100 — São Paulo/SP",
        telefone: "11999990000", email: "contato@circular.example",
        contrato: { create: {
          dataAssinatura: new Date(agora - 120 * 86400000), dataVencimento: new Date(agora + 365 * 86400000),
          clausulas: ["Coleta de resíduos eletrônicos", "Rastreabilidade por equipamento"],
          valorMensal: "1500.50", renovacaoAutomatica: true,
        } },
      } });
      criados++;
    }
    if (!await tx.organizacao.findUnique({ where: { cnpj: "04252011000110" } })) {
      await tx.organizacao.create({ data: {
        razaoSocial: "Cooperativa em cadastro (demonstração)", cnpj: "04252011000110",
        enderecoCompleto: "Avenida da Reciclagem, 200 — Curitiba/PR",
        telefone: "41999990000", email: "cadastro@cooperativa.example",
      } });
      criados++;
    }

    const exemplos: { id: string; status: StatusLote; caminho: StatusRastreamento[]; estado: EstadoFisico }[] = [
      { id: "11111111-1111-4111-8111-111111111101", status: "RECEBIDO", caminho: ["AGUARDANDO_TRIAGEM"], estado: "BOM_ESTADO" },
      { id: "11111111-1111-4111-8111-111111111102", status: "EM_TRIAGEM", caminho: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM"], estado: "USADO_LEVE" },
      { id: "11111111-1111-4111-8111-111111111103", status: "ENCAMINHADO", caminho: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE", "MATERIAL_RECICLAVEL"], estado: "DANIFICADO_GRAVE" },
      { id: "11111111-1111-4111-8111-111111111104", status: "FINALIZADO", caminho: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTE", "DESCARTE_SEGURO", "BAIXA_DEFINITIVA"], estado: "INSERVIVEL" },
    ];
    const contrato = await tx.contrato.findUnique({ where: { organizacaoId: organizacao.id } });
    for (const [indice, exemplo] of exemplos.entries()) {
      if (await tx.lote.findUnique({ where: { id: exemplo.id } })) continue;
      const dataEntrada = new Date(agora - (indice + 1) * 86400000);
      exigir(organizacao.ativo && contrato && contrato.dataAssinatura <= dataEntrada && contrato.dataVencimento >= dataEntrada,
        "A organização de demonstração existente deve estar ativa e ter contrato vigente nas datas dos exemplos. O seed foi revertido.");
      await tx.lote.create({ data: {
        id: exemplo.id, organizacaoId: organizacao.id, dataEntrada, notaFiscal: `DEMO-${indice + 1}`,
        transportadora: "Transporte Circular", statusProcessamento: exemplo.status,
        observacoes: "Massa de demonstração da AV2.",
        versao: ["RECEBIDO", "EM_TRIAGEM", "TRIAGEM_CONCLUIDA", "ENCAMINHADO", "FINALIZADO"].indexOf(exemplo.status) + 1,
        equipamentos: { create: {
          codigoBarrasInterno: `GC-DEMO-${indice + 1}`, tipo: "NOTEBOOK", marca: "Marca demonstrativa", modelo: `Modelo ${indice + 1}`,
          anoFabricacao: new Date().getUTCFullYear() - indice, estadoFisico: exemplo.estado,
          pesoQuilogramas: "2.500", posicaoNoLote: 1, statusRastreamento: exemplo.caminho.at(-1)!, versao: exemplo.caminho.length,
          historicoMovimentacao: { create: exemplo.caminho.map((destino, passo) => ({
            tipo: passo === 0 ? "RECEBIMENTO" : "STATUS",
            origem: exemplo.caminho[passo - 1] ?? "ENTRADA", destino,
            responsavelId: admin.id, responsavel: admin.usuario,
            dataHora: new Date(dataEntrada.getTime() + passo * 60000), observacao: "Etapa registrada na massa de demonstração.",
          })) },
        } },
      } });
      criados++;
    }
    if (criados > 0) {
      await tx.auditoria.create({ data: {
        operacao: "SEED", entidade: "Usuario", entidadeId: admin.id, usuarioResponsavelId: admin.id,
        dadosDepois: { registrosRaizCriados: criados, origem: "prisma/dadosExemplo.ts" },
      } });
    }
    return { registrosRaizCriados: criados, usuarios: contasExemplo.map(conta => conta.usuario) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15000 });
}
