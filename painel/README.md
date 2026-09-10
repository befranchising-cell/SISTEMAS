# Painel de Fornecedores — Bem Brasil

Classificação financeira dos 241 fornecedores do extrato jan–fev/2026.
Página estática + uma função de servidor para guardar o preenchimento
compartilhado entre todo mundo da equipe.

## Como está publicado hoje

Pelo **GitHub Pages**, a partir deste repositório. Duas consequências:

- O repositório é **público**: o `index.html` traz os 241 fornecedores e os
  CNPJs, então esses dados estão abertos na internet.
- O GitHub Pages **não roda funções de servidor**. A `functions/api/dados.js`
  fica aqui pronta, mas inerte. Sem ela, o painel detecta a ausência da API e
  passa a salvar no `localStorage`: **o preenchimento não é compartilhado entre
  pessoas nem entre navegadores**, e o botão avisa "Salvo neste navegador".

Para ter preenchimento compartilhado e acesso protegido, siga a seção
*Publicação na Cloudflare Pages* abaixo — o mesmo código funciona nos dois
cenários, sem alteração.

## Arquivos

| Caminho | O que é |
|---|---|
| `index.html` | O painel inteiro: tabela, busca, abas, painel de avanço, exportação CSV |
| `fonts/*.woff2` | TT Firs Neue (Light, Regular, Medium, DemiBold, Medium Italic) |
| `functions/api/dados.js` | Lê e grava a classificação no KV da Cloudflare |

As 18 classificações já feitas vêm dentro do `index.html`. Elas são o ponto de
partida: no primeiro acesso o painel abre preenchido e o botão **Salvar
alterações** já vem ativo, para mandar esse estado inicial ao servidor.

## Como os dados circulam

- **Salvar alterações** → `PUT /api/dados` → grava no KV
- Ao abrir a página e a cada 20 segundos → `GET /api/dados` → traz o que a
  equipe salvou
- A sincronização nunca sobrescreve a linha que a pessoa está editando, nem
  alterações ainda não salvas
- Enquanto nada foi salvo, um rascunho fica no `localStorage` como rede de
  segurança

Nenhum dado de classificação vive no repositório — só no KV.

## Publicação na Cloudflare Pages

**1. Repositório.** Crie um repositório **privado** no GitHub e suba estes
arquivos na raiz.

**2. Projeto Pages.** cloudflare.com → *Workers & Pages* → *Create* →
*Pages* → *Connect to Git* → escolha o repositório.
Nas configurações de build, deixe tudo vazio:

- Framework preset: `None`
- Build command: *(vazio)*
- Build output directory: `/`

**3. Banco (KV).** *Storage & Databases* → *KV* → *Create namespace*,
nome `painel-fornecedores`.
Volte ao projeto Pages → *Settings* → *Bindings* → *Add* → *KV namespace*:

- Variable name: `PAINEL`  ← precisa ser exatamente isso
- KV namespace: `painel-fornecedores`

Faça um novo deploy para o binding valer.

**4. Login (Cloudflare Access).** Esta é a parte que protege os dados.
*Zero Trust* → *Access* → *Applications* → *Add an application* →
*Self-hosted*:

- Application domain: o domínio do projeto (`algo.pages.dev`)
- Session duration: 24 horas, por exemplo

Em *Policies*, crie uma política **Allow** com *Selector: Emails* e a lista
de e-mails de quem pode entrar. Em *Login methods*, deixe **One-time PIN**
ligado — a pessoa recebe um código no e-mail, sem senha para vazar.

Feito isso, quem não estiver na lista não recebe nem o HTML: o bloqueio
acontece antes da página ser servida.

## Manutenção

- **Tirar o acesso de alguém**: remova o e-mail da política no Access
- **Ver quem gravou por último**: aparece na barra do painel, ao lado do botão
  Salvar (vem do cabeçalho `cf-access-authenticated-user-email`)
- **Backup**: use o botão *Exportar CSV* no próprio painel
