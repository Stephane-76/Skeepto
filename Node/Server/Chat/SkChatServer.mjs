//=====================================================================
// SkChat - Chat Management System (Generate by Claude) Cursor
//=====================================================================
import dependenciesContainer from '../Depency/SkDepencyManager.mjs';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';

/**
 * SkChat - Real-time chat management system
 * Handles WebSocket connections, message broadcasting, and user management
 */
export class SkChat extends EventEmitter {
  constructor(server, options = {}) {
    super();
    
    // Initialize WebSocket server
    this.wss = new WebSocketServer({ 
      server,
      path: options.path || '/chat'
    });
    
    // Chat configuration
    this.config = {
      maxMessageLength: options.maxMessageLength || 1000,
      maxUsersPerRoom: options.maxUsersPerRoom || 50,
      messageHistorySize: options.messageHistorySize || 100,
      jwtVerifier: options.jwtVerifier || null, // JWT verification function
      ...options
    };
    
    // Internal state
    this.rooms = new Map(); // roomId -> room data
    this.users = new Map(); // userId -> user data
    this.messageHistory = new Map(); // roomId -> message array
    
    // Initialize WebSocket event handlers
    this._initializeWebSocketHandlers();
    dependenciesContainer.register('SkChat',this);
    console.log('SkChat initialized with WebSocket server');
  }

  /**
   * Initialize WebSocket event handlers
   */
  _initializeWebSocketHandlers() {
    this.wss.on('connection', (ws, request) => {
      // Generate unique connection ID
      ws.connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      console.log(`New WebSocket connection established: ${ws.connectionId}`);
      console.log('Total active connections:', this.wss.clients.size);
      
      // Set up connection metadata
      ws.isAlive = true;
      ws.missedPings = 0;
      ws.userId = null;
      ws.roomId = null;
      ws.authenticated = false;
      
      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          //console.log('Received message:', data.toString());
          const message = JSON.parse(data.toString());
          //console.log('Parsed message:', message);
          
          // Check if this is an authentication message
          if (message.type === 'authenticate') {
            this._handleAuthentication(ws, message.data);
            return;
          }
          
          // Require authentication for all other messages
          if (!ws.authenticated) {
            this._sendError(ws, 'Authentication required');
            return;
          }
          
          this._handleMessage(ws, message);
        } catch (error) {
          console.error('Error parsing message:', error);
          this._sendError(ws, 'Invalid message format');
        }
      });
      
      // Handle connection close
      ws.on('close', () => {
        // Only handle disconnect if user didn't leave voluntarily
        if (!ws.isLeaving) {
          this._handleUserDisconnect(ws);
        }
      });
      
      // Handle pong responses for keep-alive
      ws.on('pong', () => {
        ws.isAlive = true;
        ws.missedPings = 0;
      });
      
      // Send welcome message
      this._sendMessage(ws, {
        type: 'system',
        message: 'Connected to SkChat server. Please authenticate.',
        timestamp: Date.now()
      });
    });
    
    // Keep-alive: tolerate short WASM/event-loop stalls (do not drop on first missed pong).
    const wPingIntervalMs = 30000;
    const wMaxMissedPings = 3;
    setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          ws.missedPings = (ws.missedPings || 0) + 1;
          if (ws.missedPings >= wMaxMissedPings) {
            console.warn(`WebSocket terminated after ${ws.missedPings} missed pings: ${ws.connectionId}`);
            return ws.terminate();
          }
        } else {
          ws.missedPings = 0;
        }
        ws.isAlive = false;
        ws.ping();
      });
    }, wPingIntervalMs);
  }

  /**
   * Handle WebSocket authentication
   */
  _handleAuthentication(ws, data) {
    const { token } = data;
    
    if (!token) {
      return this._sendError(ws, 'Token is required for authentication');
    }
    
    // Use JWT verifier if available
    if (this.config.jwtVerifier) {
      const result = this.config.jwtVerifier(token);
      
      if (!result.success) {
        return this._sendError(ws, result.error || 'Authentication failed');
      }
      
      // Debug: Log the JWT payload
      console.log('JWT payload received:', JSON.stringify(result.user, null, 2));
      
      // Store user information from JWT
      ws.userId = result.user.userId;
      ws.username = result.user.userEmail; // Use userEmail from JWT token
      ws.userData = result.user;
      ws.authenticated = true;
      
      // Send authentication success
      this._sendMessage(ws, {
        type: 'authenticated',
        userId: ws.userId,
        username: ws.username,
        timestamp: Date.now()
      });
      
      console.log(`User ${ws.username} authenticated via JWT`);
      this.emit('userAuthenticated', { userId: ws.userId, username: ws.username });
    } else {
      // Fallback to simple token check if no JWT verifier
      ws.userId = data.userId;
      ws.username = data.username;
      ws.authenticated = true;
      
      this._sendMessage(ws, {
        type: 'authenticated',
        userId: ws.userId,
        username: ws.username,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  _handleMessage(ws, message) {
    const { type, data } = message;
    
    switch (type) {
      case 'join':
        this._handleJoin(ws, data);
        break;
      case 'get_room_users':
        this._handleGetRoomUsers(ws, data);
        break;
      case 'message':
        this._handleChatMessage(ws, data);
        break;
      case 'spreadsheet':
        this._handleSpreadsheetMessage(ws, data);
        break;
      case 'leave':
        this._handleLeave(ws, data);
        break;
      case 'typing':
        this._handleTyping(ws, data);
        break;
      default:
        this._sendError(ws, `Unknown message type: ${type}`);
    }
  }

  /**
   * Handle user joining a room
   */
  _handleJoin(ws, data) {
    const { roomId } = data;
    
    if (!roomId) {
      return this._sendError(ws, 'Missing required field: roomId');
    }
    
    // Use authenticated user information
    const userId = ws.userId;
    const username = ws.username;
    
    if (!userId || !username) {
      return this._sendError(ws, 'User not authenticated');
    }
    
    // Check if room exists, create if not
    if (!this.rooms.has(roomId)) {
      this.rooms.set(roomId, {
        id: roomId,
        users: new Set(),
        createdAt: Date.now()
      });
      this.messageHistory.set(roomId, []);
    }
    
    const room = this.rooms.get(roomId);
    
    // Check room capacity
    if (room.users.size >= this.config.maxUsersPerRoom) {
      return this._sendError(ws, 'Room is full');
    }
    
    // Add user to room
    room.users.add(ws);
    ws.userId = userId;
    ws.username = username;
    ws.roomId = roomId;
    
    // Store user data
    this.users.set(userId, {
      id: userId,
      username,
      roomId,
      joinedAt: Date.now(),
      ws
    });
    
    // Send join confirmation
    this._sendMessage(ws, {
      type: 'joined',
      roomId,
      userId,
      username,
      timestamp: Date.now()
    });
    
    // Send current room users list to the newly joined user (dedup by userId)
    try {
      const seen = new Set();
      const users = [];
      for (const u of room.users) {
        if (u && u.userId && !seen.has(u.userId)) {
          seen.add(u.userId);
          users.push({ id: u.userId, username: u.username });
        }
      }
      this._sendMessage(ws, {
        type: 'room_users',
        roomId,
        users,
        timestamp: Date.now()
      });
    } catch (_) {}
    
    // Send room history
    const history = this.messageHistory.get(roomId) || [];
    this._sendMessage(ws, {
      type: 'history',
      messages: history.slice(-this.config.messageHistorySize),
      timestamp: Date.now()
    });
    
    // Broadcast user joined to room (include roomId so clients can match currentRoom)
    this._broadcastToRoom(roomId, {
      type: 'user_joined',
      roomId,
      userId,
      username,
      timestamp: Date.now()
    }, ws);
    
    console.log(`User ${username} joined room ${roomId}`);
    this.emit('userJoined', { userId, username, roomId });
  }

  /**
   * Handle explicit request for room users list
   */
  _handleGetRoomUsers(ws, data) {
    const { roomId } = data || {};
    const rid = roomId || ws.roomId;
    if (!rid) {
      return this._sendError(ws, 'Missing roomId for get_room_users');
    }
    const room = this.rooms.get(rid);
    if (!room) {
      return this._sendError(ws, 'Room not found');
    }
    const seen = new Set();
    const users = [];
    for (const u of room.users) {
      if (u && u.userId && !seen.has(u.userId)) {
        seen.add(u.userId);
        users.push({ id: u.userId, username: u.username });
      }
    }
    this._sendMessage(ws, {
      type: 'room_users',
      roomId: rid,
      users,
      timestamp: Date.now()
    });
  }

  /**
   * Handle spreadsheet messages
   */
  _handleSpreadsheetMessage(ws, data) {
    const { message, roomId } = data;
    
    if (!ws.userId || !ws.roomId) {
      return this._sendError(ws, 'User not joined to any room');
    }
    
    if (!message || typeof message !== 'string') {
      return this._sendError(ws, 'Invalid message');
    }
    
    // Parse the spreadsheet message
    let spreadsheetData;
    try {
      spreadsheetData = JSON.parse(message);
    } catch (error) {
      return this._sendError(ws, 'Invalid spreadsheet message format');
    }
    
    const spreadsheetMessage = {
      id: this._generateMessageId(),
      userId: ws.userId,
      username: ws.username,
      message: spreadsheetData,
      roomId: ws.roomId,
      timestamp: Date.now(),
      messageType: 'spreadsheet'
    };
    
    // Store message in history
    const history = this.messageHistory.get(ws.roomId) || [];
    history.push(spreadsheetMessage);
    
    // Keep history size limited
    if (history.length > this.config.messageHistorySize) {
      history.shift();
    }
    
    this.messageHistory.set(ws.roomId, history);
    
    // Broadcast spreadsheet message to room
    this._broadcastToRoom(ws.roomId, {
      type: 'spreadsheet',
      ...spreadsheetMessage
    });
    
    //console.log(`Spreadsheet message from ${ws.username} in room ${ws.roomId}:`, spreadsheetData);
    this.emit('spreadsheetMessage', spreadsheetMessage);
  }

  /**
   * Broadcast a spreadsheet collab message as a virtual user (e.g. AI assistant).
   * When skipServerApply is true, WASM on the server already applied the op — only peers get it.
   * @param {{ userId: string, username: string, roomId?: string, message: object|string, skipServerApply?: boolean }} params
   * @returns {boolean}
   */
  dispatchSpreadsheetMessageAsUser({
    userId,
    username,
    roomId = 'spreadsheet',
    message,
    skipServerApply = false,
  }) {
    if (!userId || !username || message == null) {
      return false;
    }

    let spreadsheetData;
    if (typeof message === 'string') {
      try {
        spreadsheetData = JSON.parse(message);
      } catch {
        return false;
      }
    } else if (typeof message === 'object') {
      spreadsheetData = message;
    } else {
      return false;
    }

    const spreadsheetMessage = {
      id: this._generateMessageId(),
      userId,
      username,
      message: spreadsheetData,
      roomId,
      timestamp: Date.now(),
      messageType: 'spreadsheet',
    };

    const history = this.messageHistory.get(roomId) || [];
    history.push(spreadsheetMessage);
    if (history.length > this.config.messageHistorySize) {
      history.shift();
    }
    this.messageHistory.set(roomId, history);

    this._broadcastToRoom(roomId, {
      type: 'spreadsheet',
      ...spreadsheetMessage,
    });

    if (!skipServerApply) {
      this.emit('spreadsheetMessage', spreadsheetMessage);
    }

    return true;
  }

  /**
   * Handle chat messages
   */
  _handleChatMessage(ws, data) {
    const { message, roomId } = data;
    
    if (!ws.userId || !ws.roomId) {
      return this._sendError(ws, 'User not joined to any room');
    }
    
    if (!message || typeof message !== 'string') {
      return this._sendError(ws, 'Invalid message');
    }
    
    if (message.length > this.config.maxMessageLength) {
      return this._sendError(ws, `Message too long (max ${this.config.maxMessageLength} characters)`);
    }
    
    const chatMessage = {
      id: this._generateMessageId(),
      userId: ws.userId,
      username: ws.username,
      message: message.trim(),
      roomId: ws.roomId,
      timestamp: Date.now()
    };
    
    // Store message in history
    const history = this.messageHistory.get(ws.roomId) || [];
    history.push(chatMessage);
    
    // Keep history size limited
    if (history.length > this.config.messageHistorySize) {
      history.shift();
    }
    
    this.messageHistory.set(ws.roomId, history);
    
    // Broadcast message to room
    this._broadcastToRoom(ws.roomId, {
      type: 'message',
      ...chatMessage
    });
    
    //console.log(`Message from ${ws.username} in room ${ws.roomId}: ${message}`);
    this.emit('message', chatMessage);
  }

  /**
   * Handle user leaving
   */
  _handleLeave(ws, data) {
    // Mark user as leaving to prevent double disconnect handling
    ws.isLeaving = true;
    this._handleUserDisconnect(ws);
  }

  /**
   * Handle typing indicators
   */
  _handleTyping(ws, data) {
    const { isTyping } = data;
    
    if (!ws.userId || !ws.roomId) {
      return;
    }
    
    this._broadcastToRoom(ws.roomId, {
      type: 'typing',
      userId: ws.userId,
      username: ws.username,
      isTyping,
      timestamp: Date.now()
    }, ws);
  }

  /**
   * Handle user disconnection
   */
  _handleUserDisconnect(ws) {
    if (!ws.userId || !ws.roomId) {
      return;
    }
    
    const room = this.rooms.get(ws.roomId);
    if (room) {
      room.users.delete(ws);
      
      // Remove empty rooms
      if (room.users.size === 0) {
        this.rooms.delete(ws.roomId);
        this.messageHistory.delete(ws.roomId);
      }
    }
    
    // Remove user data
    this.users.delete(ws.userId);
    
    // Broadcast user left
    if (ws.roomId) {
      this._broadcastToRoom(ws.roomId, {
        type: 'user_left',
        roomId: ws.roomId,
        userId: ws.userId,
        username: ws.username,
        timestamp: Date.now()
      });
    }
    
    //console.log(`User ${ws.username} disconnected from room ${ws.roomId}`);
    this.emit('userLeft', { userId: ws.userId, username: ws.username, roomId: ws.roomId });
  }

  /**
   * Broadcast message to all users in a room
   */
  _broadcastToRoom(roomId, message, excludeWs = null) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    
    room.users.forEach((ws) => {
      if (ws !== excludeWs && ws.readyState === 1) { // 1 = WebSocket.OPEN
        this._sendMessage(ws, message);
      }
    });
  }

  /**
   * Send message to specific WebSocket connection
   */
  _sendMessage(ws, message) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message to WebSocket connection
   */
  _sendError(ws, error) {
    this._sendMessage(ws, {
      type: 'error',
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Generate unique message ID
   */
  _generateMessageId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  /**
   * Get room information
   */
  getRoomInfo(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    return {
      id: room.id,
      userCount: room.users.size,
      createdAt: room.createdAt,
      users: Array.from(room.users).map(ws => ({
        id: ws.userId,
        username: ws.username
      }))
    };
  }
  
  /**
   * Get user information
   */
  getUserInfo(userId) {
    return this.users.get(userId);
  }
  //++
// GetAllUsers
//++
  getAllUsers() {
    return Array.from(this.users.values());
  }

  /**
   * Get all rooms
   */
  getAllRooms() {
    const rooms = [];
    for (const [roomId, room] of this.rooms) {
      rooms.push({
        id: roomId,
        userCount: room.users.size,
        createdAt: room.createdAt
      });
    }
    return rooms;
  }

  /**
   * Get message history for a room
   */
  getMessageHistory(roomId, limit = 50) {
    const history = this.messageHistory.get(roomId) || [];
    return history.slice(-limit);
  }

  /**
   * Send system message to a room
   */
  sendSystemMessage(roomId, message) {
    const systemMessage = {
      type: 'system',
      message,
      timestamp: Date.now()
    };
    
    this._broadcastToRoom(roomId, systemMessage);
    return systemMessage;
  }

  /**
   * Kick user from room
   */
  kickUser(userId, roomId, reason = 'Kicked by administrator') {
    const user = this.users.get(userId);
    if (!user || user.roomId !== roomId) {
      return false;
    }
    
    const ws = user.ws;
    if (ws && ws.readyState === 1) {
      this._sendMessage(ws, {
        type: 'kicked',
        reason,
        timestamp: Date.now()
      });
      ws.close();
    }
    
    return true;
  }

  /**
   * Get server statistics
   */
  getStats() {
    return {
      totalConnections: this.wss.clients.size,
      totalRooms: this.rooms.size,
      totalUsers: this.users.size,
      uptime: process.uptime()
    };
  }

  /**
   * Close the chat server
   */
  close() {
    this.wss.close();
    this.emit('closed');
  }
}

// Export default instance creator
export function createSkChat(server, options = {}) {
  return new SkChat(server, options);
}
