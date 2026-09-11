# Sistema de Gestão de Consultoria (multiempresa)

Aplicação web para consultorias gerenciarem, de forma **isolada por empresa cliente**,
colaboradores, contratações, dados bancários, pagamentos, calendários, rotinas
operacionais, usuários/permissões e um **Cofre de Credenciais** protegido por
**PIN individual** por usuário.

O nome, logotipo e cores são configuráveis no painel administrativo (o nome
provisório é `[NOME DO SISTEMA]`).

> ⚠️ Todos os dados de demonstração são **totalmente fictícios**. Nunca utilize
> dados pessoais, bancários ou credenciais reais em ambiente de demonstração.

## Stack

- **Backend:** Node.js + Express, banco relacional **SQLite** (`better-sqlite3`).
- **Frontend:** SPA em JavaScript modular (sem dependências de runtime no cliente),
  responsiva, em português do Brasil.
- **Segurança:** JWT em cookie `httpOnly`, `bcrypt` para senhas e PINs,
  **AES-256-GCM** para as credenciais do Cofre (criptografia reversível), Helmet
  (CSP), rate limiting, isolamento de dados por cliente validado **no servidor**.

## Como executar

```bash
npm install        # instala dependências
npm run seed       # cria o banco e popula dados fictícios de demonstração
npm start          # inicia em http://localhost:3000
```

O servidor gera automaticamente as chaves de assinatura (JWT) e a chave-mestra do
Cofre na primeira execução, gravadas em `data/.jwt.secret` e `data/.vault.key`
(fora do controle de versão). **Em produção**, defina-as por variáveis de
ambiente / KMS:

| Variável            | Uso                                                        |
|---------------------|------------------------------------------------------------|
| `APP_JWT_SECRET`    | Assinatura das sessões (JWT).                              |
| `VAULT_MASTER_KEY`  | Deriva a chave AES que cifra as credenciais do Cofre.     |
| `PORT`              | Porta HTTP (padrão 3000).                                  |
| `NODE_ENV`          | `production` ativa cookies `Secure`.                      |

A chave de criptografia do Cofre **nunca** é armazenada como registro no banco
(requisito §22/§31): fica apenas no ambiente.

## Usuários de demonstração

| Perfil        | E-mail                    | Senha            | PIN do Cofre |
|---------------|---------------------------|------------------|--------------|
| Administrador | `admin@demo.local`        | `admin123`       | `902471` (2FA de login: `000000`) |
| Consultor     | `consultor@demo.local`    | `consultor123`   | `573920`     |
| Cliente       | `cliente@demo.local`      | `cliente123`     | — (sem acesso ao Cofre) |
| Operacional   | `operacional@demo.local`  | `operacional123` | — (sem acesso ao Cofre) |

## Isolamento multiempresa

Cada usuário não-administrador possui uma lista explícita de clientes autorizados
(`user_clients`). Toda consulta, relatório, notificação, calendário e o Cofre são
filtrados no servidor por esse escopo (`clientScopeFilter`). Usuários vinculados a
uma empresa **nunca** enxergam dados de outra.

## Cofre de Credenciais (destaque de segurança)

- **PIN individual por usuário** (nunca compartilhado) — permite identificar
  exatamente quem visualizou, copiou, alterou ou excluiu cada credencial.
- PIN validado por **hash** (`bcrypt`), nunca recuperável; política de força
  (mínimo 6 dígitos, sem sequências/repetições) e **bloqueio após 5 tentativas**.
- Senhas externas cifradas com **AES-256-GCM** (reversível, pois precisam ser
  recuperadas por usuários autorizados); a senha **nunca** aparece em listas,
  relatórios, logs, notificações, histórico ou no HTML da página.
- Desbloqueio por PIN cria uma **sessão do Cofre** com expiração por inatividade;
  revelar/copiar/editar/excluir exigem **nova confirmação do PIN**.
- **Log de auditoria** dedicado (`vault_logs`) para cada acesso, sem conteúdo
  sensível; redefinição de PIN encerra todas as sessões do Cofre.

## Documentação

Os artefatos solicitados na especificação (§33) estão em [`docs/`](docs/):

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — banco de dados, entidades,
  relacionamentos, mapa de telas, fluxos, regras de recorrência e permissões,
  plano de segurança e critérios de aceite.

## Estrutura

```
server/            API Express
  config.js        segredos / configuração
  crypto.js        AES-GCM, hashing, política de PIN, mascaramento
  db.js            esquema relacional + dados de referência
  auth.js          JWT, RBAC, isolamento por cliente
  vault.service.js regras do Cofre (PIN, sessões, permissões)
  recurrence.js    geração de datas (pagamentos e rotinas)
  routes/          endpoints REST
public/            SPA (HTML/CSS/JS modular)
docs/              documentação de arquitetura e segurança
```
