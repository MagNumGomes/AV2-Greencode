# GreenCode — AV2

API REST monolítica para gestão de logística reversa de equipamentos eletrônicos, desenvolvida com **Node.js, TypeScript, Fastify, Prisma ORM e PostgreSQL**.

## Executar

Pré-requisitos: **Node.js 22.12 ou superior** e **PostgreSQL 17**. O `compose.yaml` disponibiliza o banco pelo Docker; também é possível utilizar uma instalação local do PostgreSQL ajustando `DATABASE_URL`.

Entre na pasta `AV2-Greencode` e copie a configuração:

```powershell
# Windows / PowerShell
Copy-Item .env.example .env
```

```sh
# Ubuntu / Linux
cp .env.example .env
```

Defina `JWT_SECRET` no `.env`. Para gerar uma chave:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Os próximos comandos são iguais nas duas plataformas:

```sh
npm ci
npm run db:generate
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm run dev
```

Com um PostgreSQL já instalado, configure sua conexão no `.env` e execute os demais comandos a partir de `npm ci`, sem iniciar o contêiner.

- **API:** <http://localhost:3333/api>
- **Swagger UI:** <http://localhost:3333/docs/>
- **OpenAPI JSON:** <http://localhost:3333/docs/json>
- **Saúde e conexão:** <http://localhost:3333/health>

Para executar o código compilado:

```sh
npm run build
npm start
```

`Ctrl+C` ou `SIGTERM` inicia o encerramento controlado: o servidor deixa de aceitar trabalho, aguarda as requisições em andamento e desconecta o Prisma. O limite de encerramento é de 30 segundos.

### Configuração

| Variável | Finalidade |
| --- | --- |
| `DATABASE_URL` | Conexão PostgreSQL usada pelo servidor, Prisma CLI e seed |
| `HOST` | Interface de escuta; padrão `127.0.0.1` |
| `PORT` | Porta HTTP; padrão `3333` |
| `JWT_SECRET` | Chave de assinatura, com pelo menos 32 bytes |
| `JWT_EXPIRES_IN` | Validade absoluta do token; padrão `30m` |
| `CORS_ORIGINS` | Origens autorizadas separadas por vírgula |
| `SEED_PASSWORD` | Senha inicial das contas de demonstração |

### Dados de exemplo

O seed cria quatro contas: `admin`, `operador`, `gestor` e `auditor`. A senha é o valor de `SEED_PASSWORD` no `.env`; o exemplo utiliza `Greencode-demo-2026!`.

Também cria duas organizações, uma com contrato e outra ainda sem contrato, além de quatro lotes com equipamentos em recebimento, triagem, reciclagem e baixa definitiva. Cada equipamento inclui o histórico correspondente. As datas são calculadas relativamente à execução.

O seed é **idempotente**: uma nova execução inclui apenas os exemplos ausentes e preserva os dados e as senhas existentes. A carga é transacional. Pode ser executado por `npm run db:seed` ou `npx prisma db seed`.

Se a organização de demonstração já estiver cadastrada, ela deve estar ativa e seu contrato deve cobrir as datas dos novos lotes de exemplo. Caso contrário, a carga é revertida com uma mensagem explicativa.

## Utilizar a API

No Swagger, execute `POST /api/auth/login`:

```json
{
  "usuario": "admin",
  "senha": "Greencode-demo-2026!"
}
```

Copie o campo `token` da resposta para **Authorize**. As operações autenticadas utilizam:

```http
Authorization: Bearer SEU_TOKEN
```

Os esquemas completos de entradas, respostas, enumerações e erros estão no Swagger, que também permite executar as requisições.

### Permissões

| Operação | Administrador | Operador de cadastro | Gestor de almoxarifado | Auditor |
| --- | :---: | :---: | :---: | :---: |
| Consultar organizações, lotes e rastreabilidade | ✓ | ✓ | ✓ | ✓ |
| Cadastrar/alterar organizações e contratos | ✓ | ✓ | | |
| Receber lotes, triar, movimentar e destinar equipamentos | ✓ | | ✓ | |
| Gerenciar contas e papéis | ✓ | | | |
| Consultar relatórios e auditoria | ✓ | | | ✓ |
| Alterar a própria senha | ✓ | ✓ | ✓ | ✓ |

### Rotas

Todas as rotas abaixo possuem prefixo `/api`.

| Método | Caminho | Finalidade |
| --- | --- | --- |
| POST | `/auth/login` | Autenticar e obter JWT |
| GET | `/auth/me` | Consultar conta e versão atuais |
| PATCH | `/auth/senha` | Trocar senha e revogar tokens anteriores |
| GET, POST | `/usuarios` | Listar/criar usuários |
| PATCH | `/usuarios/:id` | Alterar papel ou ativação |
| GET, POST | `/organizacoes` | Listar/cadastrar organizações |
| GET, PATCH | `/organizacoes/:id` | Consultar/alterar organização |
| POST | `/organizacoes/:id/contrato` | Vincular contrato à organização |
| PATCH | `/contratos/:id/renovacao` | Renovar vencimento |
| GET, POST | `/lotes` | Listar/receber lotes com equipamentos |
| GET | `/lotes/:id` | Consultar equipamentos, versão e peso total |
| POST | `/lotes/:id/equipamentos` | Adicionar equipamentos antes da triagem |
| PATCH | `/lotes/:id/status` | Iniciar/concluir triagem, encaminhar e finalizar |
| GET | `/equipamentos` | Filtrar por lote, status ou código de barras |
| GET | `/equipamentos/:id` | Rastreabilidade e depreciação |
| PATCH | `/equipamentos/:id/status` | Alterar destinação |
| PATCH | `/equipamentos/:id/estado-fisico` | Alterar estado físico |
| POST | `/equipamentos/:id/movimentacoes` | Mudar localização |
| GET | `/relatorios/organizacoes/:id` | Relatório operacional por período |
| GET | `/relatorios/status` | Equipamentos por status |
| GET | `/relatorios/financeiro` | Mensalidades dos contratos no período |
| GET | `/auditoria` | Consultar alterações registradas |

Listagens usam `pagina` e `limite` (padrões 1 e 20, máximo 100 por página) e retornam `{ dados, total, pagina, limite }`. Períodos usam `inicio` e `fim` em ISO 8601 com fuso, por exemplo `2026-10-23T00:00:00.000Z`. Os limites são inclusivos.

**Valores monetários e pesos são strings decimais**: `"1500.00"` e `"2.500"`. Isso preserva a precisão na comunicação e no armazenamento. O peso total tem três casas e o total financeiro duas casas; valores individuais podem vir sem zeros finais.

### Versões e transações

Toda alteração informa `versao` no corpo. Use a versão devolvida pela consulta do registro:

```json
{
  "versao": 1,
  "status": "EM_TRIAGEM",
  "justificativa": "Início da inspeção dos equipamentos."
}
```

A API retorna `409 CONFLITO_VERSAO` se outro processo já alterou o registro. Consulte novamente antes de reaplicar sua decisão. Criar um contrato exige a **versão da organização**; renová-lo exige a **versão do contrato**. A inclusão de equipamentos exige a **versão do lote**. Uma mudança em equipamento também incrementa a versão do lote, portanto consulte o lote antes de avançar sua etapa.

Lote + equipamentos + recebimentos, triagem coletiva, e equipamento + movimentação + auditoria são gravados em transações. Uma falha reverte a operação inteira.

### Regras principais

- CNPJ numérico com dígitos verificadores, normalização de máscara e unicidade.
- Organização com contrato opcional; recebimento de lote exige organização ativa e contrato vigente **na data de entrada**.
- Entrada entre o instante atual e 90 dias anteriores; peso positivo; fabricação não futura.
- Códigos de barras únicos, informados pelo cliente ou gerados com UUID; posições únicas por lote.
- Fluxo de lote: `RECEBIDO → EM_TRIAGEM → TRIAGEM_CONCLUIDA → ENCAMINHADO → FINALIZADO`.
- Início/conclusão de triagem sincronizam todos os equipamentos e registram os eventos na mesma transação.
- Desmonte e destinação só acontecem após triagem completa. Após `AGUARDANDO_DESMONTE`, o equipamento pode seguir para desmonte, reaproveitamento ou descarte; material reciclável exige desmonte prévio. Os três destinos permitem baixa definitiva.
- Queda de duas ou mais categorias de estado físico exige uma justificativa na própria requisição.
- Finalização exige baixa definitiva de todos os equipamentos; equipamentos baixados ficam encerrados.
- Movimentações e auditoria são registros imutáveis, com responsável derivado da autenticação.
- O PostgreSQL também confere a coerência dos estados do lote e dos equipamentos ao confirmar a transação.

Erros usam `{ "erro": { "codigo": "...", "mensagem": "..." }, "requestId": "..." }`. Códigos HTTP: `400` formato inválido, `401` autenticação, `403` permissão, `404` inexistente, `409` duplicidade/concorrência e `422` regra de negócio.

## Estrutura

```text
src/
  http/controllers/          Rotas HTTP e delegação aos serviços
  http/schemas.ts            Contratos JSON Schema e documentação OpenAPI
  application/              Casos de uso, autorização e transações
  domain/                   Regras, validações e contratos de entrada
  infrastructure/           Repositórios Prisma, banco e hashing
  app.ts                    Composição da aplicação
  server.ts                 Inicialização e encerramento
prisma/
  schema.prisma             Modelo relacional
  migrations/               Esquema SQL, constraints e triggers versionados
  dadosExemplo.ts            Massa de demonstração idempotente
  seed.ts                   Comando de carga
test/                       Regras e integração HTTP/PostgreSQL
```

## Decisões arquiteturais

- **Monólito Controller–Service–Repository:** mantém implantação simples e transações locais. Controllers recebem HTTP, serviços aplicam regras e autorização, repositórios acessam o Prisma. Microsserviços acrescentariam comunicação distribuída sem benefício proporcional nesta etapa.
- **Fastify:** escolhido pela integração com JSON Schema, plugins e OpenAPI. Express exigiria integrações adicionais para obter a mesma validação e documentação.
- **Prisma e PostgreSQL:** fornecem migrações versionadas, transações, FKs, UUID e JSONB. O contrato opcional é único por organização; lotes, equipamentos e movimentações ficam em tabelas relacionadas. Valores monetários e pesos usam decimais exatos, evitando erros de ponto flutuante.
- **JWT e senhas:** `node:crypto` foi mantido da AV1, usando scrypt com salt em vez de SHA-256 simples. JWT contém identificador, papel e versão de acesso. Consultar a conta em cada requisição custa uma leitura, mas permite revogar tokens imediatamente após mudança de senha, papel ou ativação, sem sessões em memória.
- **Atomicidade e concorrência:** transações Serializable e atualização condicionada por `versao` protegem operações compostas. Alterar equipamento também incrementa a versão do lote; isso aumenta a contenção entre equipamentos do mesmo lote, mas preserva a consistência da triagem e finalização. Conflitos retornam 409 para nova consulta do cliente.
- **Integridade e histórico:** índices únicos, checks e triggers complementam as validações dos serviços. Auditoria e movimentações são imutáveis. A coerência entre lote e equipamentos é conferida no COMMIT, permitindo atualizá-los em instruções distintas dentro da mesma transação.
- **Carga representativa:** o seed transacional e idempotente foi escolhido entre as estratégias permitidas pela atividade. Os exemplos cobrem diferentes estados sem sobrescrever cadastros existentes.
- **Relatórios:** contratos são renovados no próprio registro, preservando alterações na auditoria. O relatório financeiro soma mensalidades cuja vigência intersecta o período; não representa faturamento histórico nem receita recebida. Isso exigiria registros próprios de cobrança.
- **Execução multiplataforma:** scripts npm e APIs Node funcionam em Windows e Linux. O servidor verifica o banco antes de abrir a porta e encerra requisições antes de desconectar o Prisma.

## Verificações

```sh
npm run check
npx prisma validate
npm test
npm run build
```

`npm test` inicia um **PostgreSQL 17 temporário real**, aplica as migrações, executa o seed e testa a API. O banco é criado em uma pasta temporária exclusiva e removido ao final. Os testes independem de `.env`, Docker ou banco de desenvolvimento. A dependência de desenvolvimento `embedded-postgres` fornece os binários para Windows e Linux; preserve os scripts de instalação do npm.

A suíte cobre autenticação, permissões, jornada completa, validações, unicidade, idempotência, rollback, concorrência, imutabilidade do histórico, filtros, valores decimais, revogação de tokens e encerramento HTTP. Os 37 testes foram aprovados em Windows 11 e Ubuntu 24.04.5 com Node.js 22.20.0.
