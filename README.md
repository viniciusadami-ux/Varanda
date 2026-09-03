# Discord 2

Um aplicativo de chat e voz privado para você e seus amigos — inspirado no Discord, mas com identidade própria.

## Sobre

O **Discord 2** permite que você crie seu próprio servidor de chat e voz para até **8 pessoas** simultâneas. Funciona em rede local ou pela internet (se o host tiver IP externo configurado).

## Usar com amigos pela internet

Enviar apenas o `.exe` não conecta todos automaticamente: cada pessoa precisa
usar o mesmo servidor online. A estrutura pronta para hospedar o backend com
HTTPS e TURN está em [`deploy/README.md`](deploy/README.md). TURN é o que faz
voz, câmera e compartilhamento de tela continuarem funcionando entre redes
domésticas diferentes.

## Instalação

### Para o Host (Quem vai hospedar o servidor)

1. Baixe o `Discord2-Setup.exe`
2. Execute o instalador
3. Abra o aplicativo
4. Clique em **Hospedar**
5. Clique em **Iniciar Servidor**
6. Anote o **IP**, **Porta** e **Código**
7. Envie esses dados para seus amigos

### Para os Amigos (Quem vai conectar)

1. Baixe e instale o `Discord2-Setup.exe`
2. Abra o aplicativo
3. Clique em **Conectar**
4. Digite o **IP** do host
5. Digite a **Porta** (padrão: 3000)
6. Clique em **Testar conexão** e depois em **Conectar**
7. Crie sua conta ou faça login

### Testar Localmente

Para testar no mesmo computador:
- IP: `localhost`
- Porta: `3000`
- Código: (deixe em branco)

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
discord2/
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
