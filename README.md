# ⚔ DUOQ.GG

Rede social para encontrar duo no League of Legends.  
Feed estilo Twitter · Chat em tempo real · Sincronização com a Riot API · Ranking por elo

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Frontend | HTML + CSS + JS puro (sem build), servido via nginx |
| Backend | Node.js + Express + Socket.io |
| Banco | MySQL 8.0 |
| Infra | Docker Compose |

---

## Subir localmente

```bash
# 1. Clone o repositório
git clone https://github.com/seu-usuario/duoq-gg.git
cd duoq-gg

# 2. Copie e configure as variáveis de ambiente
cp .env.example .env
# edite o .env com suas credenciais

# 3. Suba os containers
docker compose up -d --build

# 4. Acesse
# Frontend: http://localhost
# Backend:  http://localhost:3001/health
```

---

## Deploy no EasyPanel

### 1. Crie um novo projeto no EasyPanel

No painel do EasyPanel clique em **+ New Project** e dê o nome `duoq-gg`.

### 2. Configure o repositório

Dentro do projeto, clique em **+ New Service → App** e aponte para o seu repositório GitHub.

### 3. Configure as variáveis de ambiente

Adicione no EasyPanel as variáveis abaixo (equivalem ao seu `.env`):

```
MYSQL_ROOT_PASSWORD=  (senha forte)
MYSQL_USER=duoq
MYSQL_PASSWORD=       (senha forte)
JWT_SECRET=           (string longa e aleatória, ex: openssl rand -hex 64)
RIOT_API_KEY=RGAPI-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
FRONTEND_URL=https://seudominio.com
```

### 4. Use Docker Compose no EasyPanel

EasyPanel suporta `docker-compose.yml` diretamente:

1. Na aba **Source** selecione **Docker Compose**
2. Aponte para o arquivo `docker-compose.yml` na raiz do repositório
3. Clique em **Deploy**

Os 3 serviços sobem automaticamente: `mysql`, `backend`, `frontend`.

### 5. Configure o domínio

Na aba **Domains** do serviço `frontend`, adicione seu domínio.  
O nginx já está configurado para fazer proxy das rotas `/api/` e `/socket.io/` para o backend.

---

## Chave da Riot API

1. Acesse [developer.riotgames.com](https://developer.riotgames.com)
2. Faça login com sua conta Riot
3. Em **Dashboard** copie sua **Development API Key** (válida por 24h para testes)
4. Para produção, solicite uma **Production Key** em **My Apps → Submit**
5. Cole no `.env` como `RIOT_API_KEY=RGAPI-...`

> Sem a chave da Riot, o cadastro e o feed funcionam normalmente.  
> Apenas o botão **Sincronizar Elo** retornará um aviso.

---

## Estrutura de pastas

```
duoq-gg/
├── docker-compose.yml
├── .env.example
├── mysql-init/
│   └── 001_schema.sql        ← cria todas as tabelas automaticamente
├── backend/
│   ├── Dockerfile
│   ├── server.js             ← ponto de entrada, Express + Socket.io
│   ├── routes/
│   │   ├── auth.js           ← register / login / logout
│   │   ├── posts.js          ← feed, curtidas, comentários
│   │   ├── users.js          ← perfil, amigos, busca, sync elo
│   │   ├── messages.js       ← chat privado
│   │   └── notifications.js  ← notificações
│   ├── middleware/auth.js    ← validação JWT
│   ├── db/connection.js      ← pool MySQL
│   └── socket/index.js       ← Socket.io (tempo real)
└── frontend/
    ├── Dockerfile
    ├── nginx.conf
    └── public/
        ├── index.html        ← SPA completo
        ├── css/style.css
        └── js/app.js
```

---

## Funcionalidades

- [x] Cadastro e login com JWT
- [x] Perfil com nick#tag do LoL
- [x] Feed com posts de Solo/Duo e Flex
- [x] Curtidas e comentários com notificações automáticas
- [x] Filtro de feed por tipo de fila
- [x] Explorar jogadores com busca
- [x] Solicitação e aceite de amizades
- [x] Chat privado em tempo real via Socket.io
- [x] Status online/offline em tempo real
- [x] Notificações de curtidas, comentários, amizades e mensagens
- [x] Sincronização de elo via Riot API
- [x] Histórico de elo
- [x] Contador de invocadores online procurando duo
- [x] Responsivo (mobile)

---

## Variáveis de ambiente — referência completa

| Variável | Descrição | Padrão |
|----------|-----------|--------|
| `MYSQL_ROOT_PASSWORD` | Senha root do MySQL | — |
| `MYSQL_USER` | Usuário da aplicação | `duoq` |
| `MYSQL_PASSWORD` | Senha do usuário | — |
| `JWT_SECRET` | Segredo para assinar tokens | — |
| `RIOT_API_KEY` | Chave da Riot Games API | — |
| `RIOT_REGION` | Região do servidor LoL | `br1` |
| `FRONTEND_URL` | URL do frontend (CORS) | `*` |
| `PORT` | Porta do backend | `3001` |
