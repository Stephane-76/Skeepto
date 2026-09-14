// Chat/collaboration transport is disabled in the desktop (Electron) build: the app is
// served by Electron's internal static file server, which has no /chat WebSocket endpoint.
// Any connection attempt fails the handshake (server answers HTTP 200 with the SPA index
// instead of 101 Switching Protocols) and then spams reconnect attempts. Use the canonical
// desktop signal (window.skerDesktop, injected by electron/preload.js) to skip it entirely.
export function isChatTransportDisabled() {
    try {
        return typeof window !== "undefined" && !!window.skerDesktop;
    } catch (wErr) {
        return false;
    }
}

export class SkWebSocketManager {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.onMessageCallback = null;
        this.onConnectionChangeCallback = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
    }

    // Set callback for message handling
    setMessageCallback(callback) {
        this.onMessageCallback = callback;
    }

    // Set callback for connection status changes
    setConnectionChangeCallback(callback) {
        this.onConnectionChangeCallback = callback;
    }

    // True when the chat transport is disabled for this runtime (e.g. desktop/Electron).
    isDisabled() {
        return isChatTransportDisabled();
    }

    // Connect to WebSocket
    connect() {
        // Desktop build has no /chat server behind window.location.host — do not even try.
        if (isChatTransportDisabled()) {
            return;
        }
        // Prevent multiple connections
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket already connected, skipping connection attempt');
            return;
        }
        
        if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
            console.log('WebSocket connection already in progress, skipping connection attempt');
            return;
        }
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/chat`;
        
        console.log('Connecting to WebSocket:', wsUrl);
        this.ws = new WebSocket(wsUrl);
        
        this.ws.onopen = () => {
            console.log('WebSocket connected');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            this.updateConnectionStatus();
            
            // Authenticate with JWT token
            this.authenticateWithJWT();
        };
        
        this.ws.onclose = () => {
            console.log('WebSocket disconnected');
            this.isConnected = false;
            this.updateConnectionStatus();
            
            // Only attempt to reconnect if this wasn't a manual disconnect
            if (this.reconnectAttempts < this.maxReconnectAttempts && this.ws !== null) {
                console.log(`Attempting automatic reconnection (${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})...`);
                this.attemptReconnect();
            } else {
                console.log('No more reconnection attempts or manual disconnect');
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.isConnected = false;
            this.updateConnectionStatus();
        };
        
        this.ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (this.onMessageCallback) {
                this.onMessageCallback(message);
            }
        };
    }

    // Attempt to reconnect
    attemptReconnect() {
        this.reconnectAttempts++;
        console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            if (this.reconnectAttempts <= this.maxReconnectAttempts) {
                this.connect();
            }
        }, this.reconnectDelay * this.reconnectAttempts);
    }

    // Authenticate with JWT token
    authenticateWithJWT() {
        const token = sessionStorage.getItem('jwt');
        const user = sessionStorage.getItem('email');
        
        if (!token) {
            console.error('No JWT token found in sessionStorage');
            if (this.onMessageCallback) {
                this.onMessageCallback({
                    type: 'system',
                    message: 'Error: Missing authentication token'
                });
            }
            return;
        }
        
        if (!user) {
            console.error('No user information found in sessionStorage');
            if (this.onMessageCallback) {
                this.onMessageCallback({
                    type: 'system',
                    message: 'Error: Missing user information'
                });
            }
            return;
        }
        
        // Send authentication message
        const authMessage = {
            type: 'authenticate',
            data: { token }
        };
        
        this.sendMessage(authMessage);
        console.log('Authentication message sent');
    }

    // Send message through WebSocket
    sendMessage(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            console.log('WebSocket Manager - Sending message:', message);
            this.ws.send(JSON.stringify(message));
            console.log('WebSocket Manager - Message sent successfully');
            return true;
        } else {
            console.error('WebSocket is not connected');
            return false;
        }
    }
    
    // Send spreadsheet message
    sendSpreadsheetMessage(message, roomId) {
        const spreadsheetMessage = {
            type: 'spreadsheet',
            data: {
                message: message,
                roomId: roomId
            }
        };
        
        console.log('WebSocket Manager - Sending spreadsheet message:', spreadsheetMessage);
        return this.sendMessage(spreadsheetMessage);
    }

    // Join a room
    joinRoom(roomId) {
        const joinMessage = {
            type: 'join',
            data: {
                roomId: roomId
            }
        };
        
        return this.sendMessage(joinMessage);
    }

    // Leave a room
    leaveRoom(roomId) {
        const leaveMessage = {
            type: 'leave',
            data: {
                roomId: roomId
            }
        };
        
        return this.sendMessage(leaveMessage);
    }

    // Send chat message
    sendChatMessage(message, roomId) {
        const chatMessage = {
            type: 'message',
            data: {
                message: message,
                roomId: roomId
            }
        };
        
        return this.sendMessage(chatMessage);
    }

    // Send typing indicator
    sendTypingIndicator(isTyping) {
        const typingMessage = {
            type: 'typing',
            data: {
                isTyping: isTyping
            }
        };
        
        return this.sendMessage(typingMessage);
    }

    // Request room users list
    requestRoomUsers(roomId) {
        const usersRequest = {
            type: 'get_room_users',
            data: {
                roomId: roomId
            }
        };
        
        return this.sendMessage(usersRequest);
    }

    // Update connection status and notify callback
    updateConnectionStatus() {
        if (this.onConnectionChangeCallback) {
            this.onConnectionChangeCallback(this.isConnected);
        }
    }

    // Get connection status
    getConnectionStatus() {
        return this.isConnected;
    }

    // Disconnect WebSocket
    disconnect() {
        if (this.ws) {
            console.log('Disconnecting WebSocket...');
            // Remove event listeners to prevent memory leaks
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.onopen = null;
            
            // Close the connection
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
        this.updateConnectionStatus();
        console.log('WebSocket disconnected');
    }

    // Clean up resources
    destroy() {
        this.disconnect();
        this.onMessageCallback = null;
        this.onConnectionChangeCallback = null;
    }
}

export default SkWebSocketManager; 