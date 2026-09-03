# Publicar o Discord 2 para amigos

Esta pasta sobe três serviços em uma VPS: o servidor do Discord 2, HTTPS
automático com Caddy e um servidor TURN. Você precisa de uma VPS Linux com
Docker, um domínio e acesso ao DNS desse domínio.

## Antes de subir

1. Aponte um domínio, por exemplo `discord.seudominio.com`, para o IP público
   da VPS.
2. Abra no firewall: `80/tcp`, `443/tcp`, `443/udp`, `3478/tcp`, `3478/udp` e
   a faixa `49160-49200/udp`.
3. Copie `.env.example` para `.env` e preencha todos os valores. Não publique
   o arquivo `.env` e não o envie a ninguém.

## Subir e atualizar

No diretório `deploy` da VPS:

```powershell
docker compose up -d --build
```

O endereço a enviar aos amigos será `https://` seguido do valor de `DOMAIN`.
No aplicativo, eles escolhem **Conectar**, informam esse endereço e deixam a
porta em branco ou usam `443`.

## O que cada pessoa instala

Envie o instalador em `dist-electron`. Cada amigo cria a própria conta no
mesmo endereço público. Depois use os convites de servidor do app para todos
entrarem no mesmo servidor e nos mesmos canais de voz.

TURN permite que voz, câmera e compartilhamento de tela funcionem mesmo quando
as redes domésticas não conseguem estabelecer uma conexão direta. Faça backup
periódico do volume `discord2-data`; nele ficam banco e anexos.
