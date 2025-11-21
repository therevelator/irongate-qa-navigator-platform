import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

export function setupWebSocket(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  
  wss.on('connection', (ws: WebSocket) => {
    console.log('🔌 Client connected to WebSocket');
    
    // Send welcome message
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      timestamp: new Date().toISOString()
    }));
    
    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('📨 Received message:', data);
        
        // Handle ping/pong for keep-alive
        if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 Client disconnected from WebSocket');
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });
  
  return wss;
}

// Broadcast to all connected clients
export function broadcast(wss: WebSocketServer, data: any): void {
  const message = JSON.stringify(data);
  
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
  
  console.log(`📡 Broadcasted to ${wss.clients.size} clients:`, data.type);
}

// Broadcast to specific company
export function broadcastToCompany(wss: WebSocketServer, companyId: string, data: any): void {
  // In a production app, you'd track which clients belong to which company
  // For now, broadcast to all
  broadcast(wss, { ...data, companyId });
}
