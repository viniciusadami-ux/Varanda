# Varanda

Um aplicativo de chat e voz privado para você e seus amigos — inspirado no Discord, mas com identidade própria.

## Sobre

A **Varanda** permite que você crie seu próprio servidor de chat e voz para até **8 pessoas** simultâneas. Funciona na rede local ou pela internet com Tailscale, sem precisar de IP fixo.

## Jogar com amigos pela internet (Tailscale)

O jeito mais simples de jogar fora da rede de casa é pelo [Tailscale](https://tailscale.com/download). Ele monta uma rede privada entre os computadores, então ninguém precisa abrir porta no roteador nem ter IP fixo. O plano gratuito do Tailscale atende até 6 pessoas.

### No computador de quem hospeda

1. Instale o Tailscale e entre com uma conta (Google, Microsoft ou GitHub).
2. Clique no ícone do Tailscale na bandeja do Windows e anote o endereço que começa com `100.`. É esse número que os amigos vão usar, não o `192.168.x.x` da rede local.
3. Abra a Varanda, clique em **Hospedar** e depois em **Iniciar Servidor**.
4. Anote a **porta** que aparecer (normalmente `3000`).
5. Se o Windows perguntar se pode liberar o aplicativo no firewall, marque **Redes privadas**.

### Para cada amigo

1. Instale o Tailscale e entre com a conta dele.
2. Aceite o convite que o host enviou.
3. Abra a Varanda e clique em **Conectar**.
4. Preencha o endereço com o `100.x.x.x` do host, a porta `3000` e o código que o host passou.
5. Clique em **Testar conexão** e depois em **Conectar**. Crie a conta ou faça login.

### Como convidar

No painel do Tailscale, abra **Machines**, encontre o computador do host e clique em **Share**.

- **Link:** escolha "Copy invite link" e mande no grupo. O link serve até 1.000 usos e expira em 30 dias.
- **Email:** cada pessoa recebe um convite individual.

O convite dá acesso só àquele computador, não à sua rede inteira. Quem recebe precisa ter conta no Tailscale e aceitar o convite. Também dá para convidar todos para o mesmo tailnet em **Users**, mas aí cada um enxerga todas as suas máquinas.

### Se não conectar

- Confirme que os dois lados aparecem como conectados no Tailscale.
- No navegador do amigo, abra `http://100.x.x.x:3000/health`. Se responder `{"status":"ok"}`, o servidor está no ar e o problema é o app ou o firewall.
- Libere a Varanda no firewall do Windows para **Redes privadas**.
- Voz, webcam e compartilhamento de tela dispensam TURN nesse modo, porque os computadores já se enxergam direto pela rede do Tailscale.

## Instalação

1. Baixe o `Varanda-Setup.exe`.
2. Execute o instalador e abra o aplicativo.

### Testar sozinho, no mesmo computador

- Endereço: `localhost`
- Porta: `3000`
- Código: pode deixar em branco

### Hospedagem em VPS (opcional)

Se você quiser um endereço público, com HTTPS e TURN, sem depender do Tailscale, a estrutura com Docker e Caddy está em [`deploy/README.md`](deploy/README.md).

## Funcionalidades

- **Chat em tempo real** — Mensagens instantâneas com Socket.IO
- **Canais de texto** — Organize conversas por tópicos
- **Canais de voz** — Chamadas de voz com WebRTC
- **Webcam** — Videochamada (opcional)
- **Compartilhamento de tela** — Compartilhe sua tela em tempo real
- **Servidores privados** — Crie servidores com convites
- **Amigos** — Sistema de amizade com DM
- **Temas** — Escuro e claro
- **Upload de arquivos** — Imagens, PDFs, ZIPs

## Tecnologias

- Electron + React + TypeScript
- Node.js + Express + Socket.IO
- SQLite (banco de dados local)
- WebRTC (voz/vídeo)
- Tailwind CSS

## Estrutura do Projeto

```
varanda/
├── app/              # Electron main + preload
├── client/           # Frontend React
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── store/
│       └── hooks/
├── server/           # Backend Node.js
│   └── src/
│       ├── routes/
│       └── database.js
├── database/         # SQLite
├── uploads/          # Arquivos enviados
└── assets/           # Ícones
```

## Desenvolvimento

```bash
# Instalar dependências
npm install

# Desenvolvimento (cliente + servidor + Electron)
npm run dev

# Build do cliente
cd client && npm run build

# Build do instalador .exe
npm run dist
```

## Requisitos

- Windows 10/11
- Não requer Node.js instalado (tudo empacotado)

## Versão

1.0.0

---

Feito para jogar e conversar com amigos.
