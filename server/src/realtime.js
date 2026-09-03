// Small bridge between HTTP routes and Socket.IO. Route modules do not import
// the application entrypoint, avoiding a circular dependency during startup.
let socketServer = null;

export function setSocketServer(io) {
  socketServer = io;
}

export function emitToUser(userId, event, payload = {}) {
  socketServer?.to(`user_${userId}`).emit(event, payload);
}

export function emitToServer(serverId, event, payload = {}) {
  socketServer?.to(`server_${serverId}`).emit(event, payload);
}
