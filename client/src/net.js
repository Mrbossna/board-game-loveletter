import { io } from 'socket.io-client';

// Connect to the same origin that served the page. Under Discord this is the
// activity's proxied origin; the /socket.io path is mapped to our server.
export function connectSocket() {
  return io({
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    reconnection: true,
  });
}

// Promise wrapper around socket.emit with an ack callback.
export function emit(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, (res) => resolve(res || { ok: false, error: 'no response' }));
  });
}
