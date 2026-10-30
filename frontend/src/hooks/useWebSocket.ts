import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

export function useWebSocket(event: string, handler: (data: unknown) => void) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    socketRef.current = io({ path: '/socket.io', transports: ['websocket'] });
    socketRef.current.on(event, handler);
    return () => {
      socketRef.current?.off(event, handler);
      socketRef.current?.disconnect();
    };
  }, [event, handler]);
}
