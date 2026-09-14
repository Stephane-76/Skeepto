import SkWebSocketManager from '../utility/SkWebSocketManager';
import {
    isActiveSpreadsheetReadOnly,
    isSpreadsheetWriteMessage,
} from '../SkActiveFile.js';

export class SkSpChat {
    constructor() {
        this.currentUser = null;
        this.currentRoom = 'spreadsheet';
        this.messages = [];
        this.isConnected = false;
        this.isTyping = false;
        this.typingUsers = [];
        this.connectedUsers = [];
        this.showJoinForm = true;
        this.showChat = false;
        
        // Initialize WebSocket manager
        this.wsManager = new SkWebSocketManager();
        this.typingTimeout = null;

        this.m_SpInterface=null;
        
        // Deferred resolvers for async join and roster loading
        this._joinResolve = null;
        this._roomUsersResolve = null;
        this.hasJoined = false;
        this.joiningInProgress = false;

        // Own Do/Undo/Redo echoes carry the same msg.opid as local PostMessage; skip re-applying GetMessage.
        this._spreadsheetOpIdsSeen = new Set();
        this._spreadsheetOpIdOrder = [];
        this._spreadsheetOpIdCap = 500;
        
        // Setup WebSocket manager
        this.setupWebSocketManager();
    }

    /**
     * Extract opid as a decimal string from raw JSON text (before JSON.parse).
     * uint64 opids exceed Number.MAX_SAFE_INTEGER; parse corrupts low bits and
     * would break echo dedup if the server forwards the original digits.
     */
    _extractSpreadsheetOpIdRaw(text) {
        if (typeof text !== 'string' || !text) {
            return null;
        }
        const m = text.match(/"opid"\s*:\s*"?(\d+)"?/);
        return m ? m[1] : null;
    }

    /** Remember opid when we send a spreadsheet op so WebSocket echo does not apply it twice. */
    _rememberSpreadsheetOpId(opid) {
        if (opid == null) {
            return;
        }
        const variants = new Set([String(opid)]);
        // Also remember the Number-corrupted form so mixed string/number wire formats still match.
        const asNum = Number(opid);
        if (Number.isFinite(asNum)) {
            variants.add(String(asNum));
        }
        for (const s of variants) {
            if (this._spreadsheetOpIdsSeen.has(s)) {
                continue;
            }
            this._spreadsheetOpIdsSeen.add(s);
            this._spreadsheetOpIdOrder.push(s);
        }
        while (this._spreadsheetOpIdOrder.length > this._spreadsheetOpIdCap) {
            const old = this._spreadsheetOpIdOrder.shift();
            this._spreadsheetOpIdsSeen.delete(old);
        }
    }


    setSpInterface(sSpInterface) {
        this.m_SpInterface = sSpInterface;
    }

    setupWebSocketManager() {
        // Set message callback
        this.wsManager.setMessageCallback(this.handleIncomingMessage.bind(this));
        
        // Set connection status callback
        this.wsManager.setConnectionChangeCallback((isConnected) => {
            this.isConnected = isConnected;
            if (!isConnected) {
                this.showChat = false;
                this.showJoinForm = true;
                // Stale hasJoined blocks joinRoom() after auto-reconnect (authenticated → join).
                this.hasJoined = false;
                this.joiningInProgress = false;
                this.connectedUsers = [];
                // Drop the multi-user flag on disconnect: we are, as far as the
                // backend is concerned, now the sole editor.
                this._syncMultiUserActive();
                return;
            }
            // Stay on join form until the server confirms room join ('joined' event).
            this.showJoinForm = !this.showChat;
        });
    }

    // Push the current roster size down to the C++ engine so that
    // IsRenameAllowed() reflects the real collaborative state. We treat
    // "several entries in connectedUsers" as multi-user, because the
    // roster already contains the local user. When we are disconnected,
    // the flag is forced back to false.
    _syncMultiUserActive() {
        const wMultiUser =
            this.isConnected &&
            Array.isArray(this.connectedUsers) &&
            this.connectedUsers.length > 1;
        // Avoid redundant round-trips to the worker when the state did
        // not actually change.
        if (this._lastMultiUserActive === wMultiUser) return;
        this._lastMultiUserActive = wMultiUser;

        const wApi = (typeof window !== 'undefined') ? window.SkUISpreadSheet : null;
        if (wApi && typeof wApi.setMultiUserActive === 'function') {
            // Fire-and-forget: setMultiUserActive returns a promise but we
            // do not block the chat pipeline on it. Errors are swallowed
            // because the JS wrapper falls back to a safe default
            // (rename-allowed) if the binding is missing on an old build.
            try {
                wApi.setMultiUserActive(wMultiUser).catch(() => {});
            } catch (e) {
                // Older engines without the binding: keep going silently.
            }
        }
    }

    /**
     * True if the given roster row represents the signed-in client (matches id or email/username).
     */
    _isRoomUserSelf(user) {
        if (!user) return false;
        const uid = user.id != null ? String(user.id) : '';
        const uemail = String(user.username ?? '').toLowerCase().trim();
        const myId = this.currentUser?.id != null ? String(this.currentUser.id) : '';
        let myEmail = String(this.currentUser?.username ?? '').toLowerCase().trim();
        if (!myEmail && typeof sessionStorage !== 'undefined') {
            myEmail = String(sessionStorage.getItem('email') || '').toLowerCase().trim();
        }
        if (myId && uid && myId === uid) return true;
        if (myEmail && uemail && myEmail === uemail) return true;
        return false;
    }

    /**
     * At least one other participant is in the spreadsheet room (excluding this client).
     * Used to skip needless cursor/moveCell websocket traffic when editing alone.
     */
    hasCollaboratorPeers() {
        const wWsUp =
            (this.wsManager && this.wsManager.isConnected === true) || this.isConnected;
        if (!wWsUp || !Array.isArray(this.connectedUsers)) {
            return false;
        }
        const canIdentifySelf =
            !!(this.currentUser?.id ||
                this.currentUser?.username ||
                (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('email')));
        if (canIdentifySelf) {
            return this.connectedUsers.some((u) => !this._isRoomUserSelf(u));
        }
        return this.connectedUsers.length > 1;
    }

    connect() {
        this.wsManager.connect();
    }

    disconnect() {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }
        this.wsManager.destroy();
    }

    joinRoom(roomId = 'spreadsheet') {
        console.log('=== DEBUG joinRoom ===');
        
        // Get user information from sessionStorage
        const user = sessionStorage.getItem('email');
        const email = sessionStorage.getItem('email');
        
        if (!user) {
            console.error('User not logged in');
            return Promise.resolve(false);
        }
        
        // Use user information from localStorage
        const userId = email || user; // Use email as userId if available
        const username = email || user;
        roomId = roomId || 'spreadsheet'; // Fixed room for spreadsheet
        
        console.log('Joining room:', roomId);
        console.log('User:', username);
        console.log('WebSocket status:', this.wsManager.getConnectionStatus());
        
        // If already joined same room, resolve immediately
        if (this.hasJoined && this.currentRoom === roomId) {
            return Promise.resolve(true);
        }
        // If a join is already in progress, chain resolution
        if (this.joiningInProgress && this._joinResolve) {
            return new Promise((resolve) => {
                const prev = this._joinResolve;
                this._joinResolve = (val) => { try { prev?.(val); } finally { resolve(val); } };
            });
        }
        return new Promise((resolve) => {
            // Keep only the latest resolver; chain if already set
            if (this._joinResolve) {
                const prev = this._joinResolve;
                this._joinResolve = (val) => { try { prev?.(val); } finally { resolve(val); } };
            } else {
                this._joinResolve = resolve;
            }
            
            const sendJoin = () => {
                if (this.hasJoined && this.currentRoom === roomId) {
                    const r = this._joinResolve; this._joinResolve = null; this.joiningInProgress = false;
                    r?.(true);
                    return;
                }
                this.joiningInProgress = true;
                const success = this.wsManager.joinRoom(roomId);
                if (success) {
                    console.log('Join room message sent successfully');
                    // Preserve userId from authentication if available, otherwise use email
                    // This ensures userId matches what the server sends in messages
                    if (!this.currentUser || !this.currentUser.id) {
                        this.currentUser = { id: userId, username: username };
                    } else {
                        // Update username but keep the authenticated userId
                        this.currentUser.username = username;
                    }
                    this.currentRoom = roomId;
                    this.hasJoined = true;
                    // Defer roster population to server events to avoid duplicates with real userId
                    // Try to request the full users list if server supports it
                    this.wsManager.requestRoomUsers?.(roomId);
                } else {
                    console.log('Failed to send join room message');
                    this.joiningInProgress = false;
                }
            };

            if (!this.wsManager.getConnectionStatus()) {
                // No chat server in the desktop build: resolve as "not joined" instead of
                // leaving the promise pending or attempting a doomed connection.
                if (this.wsManager.isDisabled?.()) {
                    this.joiningInProgress = false;
                    const r = this._joinResolve; this._joinResolve = null;
                    r?.(false);
                    return;
                }
                console.log('WebSocket not connected, connecting first...');
                this.wsManager.connect();
                setTimeout(sendJoin, 1000);
            } else {
                sendJoin();
            }
        });
    }

    leaveRoom() {
        this.wsManager.leaveRoom(this.currentRoom);
    }

    sendMessage(messageText) {
        if (!messageText || !this.wsManager.getConnectionStatus()) {
            return false;
        }
        
        // Generate unique message ID for local tracking
        const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Add message locally with "own" type for immediate display
        this.addMessage('own', messageText, {
            username: this.currentUser?.username,
            timestamp: new Date().toISOString(),
            messageId: messageId
        });
        
        const success = this.wsManager.sendChatMessage(messageText, this.currentRoom);
        
        if (success) {
            // Clear typing indicator
            this.clearTypingIndicator();
            return true;
        }
        
        return false;
    }

    sendSpreadsheetMessage(messageData, sendOptions = {}) {
        if (isActiveSpreadsheetReadOnly()) {
            let parsed = messageData;
            if (typeof messageData === 'string') {
                try {
                    parsed = JSON.parse(messageData);
                } catch {
                    parsed = null;
                }
            }
            if (isSpreadsheetWriteMessage(parsed)) {
                return false;
            }
        }
        /*
        console.log('=== DEBUG sendSpreadsheetMessage ===');
        console.log('Message data:', messageData);
        console.log('WebSocket connection status:', this.wsManager.getConnectionStatus());
        console.log('WebSocket object:', this.wsManager.ws);
        console.log('WebSocket readyState:', this.wsManager.ws?.readyState);
        console.log('Current room:', this.currentRoom);
        console.log('Show chat:', this.showChat);
        console.log('================================');
        */
        // Try to connect if not connected
        if (!this.wsManager.getConnectionStatus()) {
            // No chat server in the desktop build: skip silently instead of spamming retries.
            if (this.wsManager.isDisabled?.()) {
                return false;
            }
            console.log('WebSocket not connected, attempting to connect...');
            this.wsManager.connect();
            
            // Wait a bit for connection to establish
            setTimeout(() => {
                if (this.wsManager.getConnectionStatus()) {
                    console.log('Connection established, retrying to send message...');
                    this.sendSpreadsheetMessage(messageData, sendOptions);
                } else {
                    console.log('Failed to establish connection');
                }
            }, 1000);
            
            return false;
        }
        
        // Check if user is in the room
        if (!this.showChat || !this.currentRoom) {
            console.log('User not in room yet, joining room first...');
            this.joinRoom();
            
            // Wait for room join confirmation before sending message
            setTimeout(() => {
                if (this.showChat && this.currentRoom) {
                    console.log('Now in room, sending message...');
                    this.sendSpreadsheetMessage(messageData, sendOptions);
                } else {
                    console.log('Failed to join room');
                }
            }, 500);
            
            return false;
        }
        
        if (!messageData) {
            console.log('Cannot send spreadsheet message - invalid data:', messageData);
            return false;
        }

        // Parse once for opid handling and cursor elision (invalid JSON strings stay as-is for stringify below).
        let parsedPayload = messageData;
        if (typeof messageData === 'string') {
            try {
                parsedPayload = JSON.parse(messageData);
            } catch (_) {
                parsedPayload = null;
            }
        }

        // Skip cursor/moveCell when there is no other participant (see hasCollaboratorPeers).
        // forceCursorBroadcast: e.g. after user_joined so an existing editor reaches the newcomer.
        if (
            !sendOptions.forceCursorBroadcast &&
            parsedPayload &&
            typeof parsedPayload === 'object' &&
            parsedPayload.type === 'user' &&
            (parsedPayload.action === 'cursor' || parsedPayload.action === 'moveCell')
        ) {
            if (!this.hasCollaboratorPeers()) {
                return false;
            }
        }

        // Convert message data to string if it's an object
        const messageString = typeof messageData === 'string' ? messageData : JSON.stringify(messageData);

        // Register opid before network so any fast echo is dropped (avoids double GetMessage / corrupt recalc).
        // Prefer raw digits from the wire string — JSON.parse corrupts uint64 opids.
        try {
            const op = parsedPayload?.op;
            if ((op === 'Do' || op === 'Undo' || op === 'Redo') && parsedPayload?.msg) {
                const oidRaw = this._extractSpreadsheetOpIdRaw(messageString);
                const oid = oidRaw ?? parsedPayload.msg.opid ?? parsedPayload.msg.opId;
                if (oid != null) {
                    this._rememberSpreadsheetOpId(oid);
                }
            }
        } catch (_) {
            // ignore parse errors; send as-is
        }
        
        const success = this.wsManager.sendSpreadsheetMessage(messageString, this.currentRoom);
        
        if (success) {
            return true;
        } else {
            console.log('Failed to send spreadsheet message');
            return false;
        }
    }

    sendTypingIndicator(isTyping) {
        if (!this.wsManager.getConnectionStatus()) return;
        
        this.wsManager.sendTypingIndicator(isTyping);
    }

    clearTypingIndicator() {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }
        
        this.typingTimeout = setTimeout(() => {
            this.sendTypingIndicator(false);
        }, 1000);
    }

    // Wait until the roster is received (room_users) or timeout
    waitRoomUsers(timeoutMs = 5000) {
        if (Array.isArray(this.connectedUsers) && this.connectedUsers.length > 0) {
            return Promise.resolve(this.connectedUsers);
        }
        return new Promise((resolve) => {
            this._roomUsersResolve = resolve;
            // If we're already joined but no server roster, resolve on next tick as a safety net
            if (this.showChat && this.currentRoom) {
                setTimeout(() => {
                    if (this._roomUsersResolve) {
                        const r = this._roomUsersResolve; this._roomUsersResolve = null;
                        r(this.connectedUsers);
                    }
                }, 50);
            }
            if (timeoutMs > 0) {
                setTimeout(() => {
                    if (this._roomUsersResolve) {
                        const r = this._roomUsersResolve; this._roomUsersResolve = null;
                        r(this.connectedUsers);
                    }
                }, timeoutMs);
            }
        });
    }

    async handleIncomingMessage(message) {
        switch (message.type) {
            case 'authenticated':
                console.log('Authentication successful:', message);
                this.currentUser = { id: message.userId, username: message.username };
                // Force room re-join after reconnect (hasJoined was cleared on disconnect).
                this.hasJoined = false;
                this.joiningInProgress = false;
                this.joinRoom(this.currentRoom || 'spreadsheet');
                break;
                
            case 'joined':
                this.showJoinForm = false;
                this.showChat = true;
                this.addMessage('system', `Welcome to room ${message.roomId}!`);
                // When joined, add ourselves and attempt to fetch the full roster
                if (message.userId && message.username && message.roomId === this.currentRoom) {
                    this._addUserToRoster({ id: message.userId, username: message.username });
                }
                if (message.roomId === this.currentRoom) {
                    this.wsManager.requestRoomUsers?.(message.roomId);
                    // Fallback: resolve roster shortly if server does not support room_users
                    setTimeout(() => {
                        if (this._roomUsersResolve) {
                            const r = this._roomUsersResolve; this._roomUsersResolve = null;
                            r(this.connectedUsers);
                        }
                    }, 300);
                }
                // Resolve join promise if awaiting
                if (this._joinResolve && message.roomId === this.currentRoom) {
                    const resolve = this._joinResolve; this._joinResolve = null; this.joiningInProgress = false; this.hasJoined = true;
                    resolve(true);
                }
                break;
                
            case 'history':
                message.messages.forEach(msg => {
                    if (message.roomId !== 'spreadsheet') {
                    this.messages.push(this.createMessageFromServer(msg));
                    }
                });
                break;
                
            case 'message':
                // Handle regular chat messages
                if (message.roomId === 'spreadsheet') {
                    // Check if this is our own message by comparing userId or username
                    // Convert to strings for comparison to handle type mismatches
                    const messageUserId = String(message.userId || '');
                    const currentUserId = String(this.currentUser?.id || '');
                    const messageUsername = String(message.username || '').toLowerCase().trim();
                    const currentUsername = String(this.currentUser?.username || '').toLowerCase().trim();
                    
                    const isOwnMessage = (
                        messageUserId && currentUserId && messageUserId === currentUserId
                    ) || (
                        messageUsername && currentUsername && messageUsername === currentUsername
                    );

                    // Debug logging
                    console.log('=== DEBUG isOwnMessage check ===');
                    console.log('Message userId:', messageUserId, 'Current userId:', currentUserId);
                    console.log('Message username:', messageUsername, 'Current username:', currentUsername);
                    console.log('isOwnMessage:', isOwnMessage);
                    console.log('================================');

                    if (!isOwnMessage) {
                        this.addMessage('other', message.message, {
                            username: message.username,
                            timestamp: message.timestamp,
                            messageId: message.id
                        });
                    } else {
                        console.log('Skipping own message (already added locally)');
                    }
                }
                break;
            case 'spreadsheet':
                await this._handleSpreadsheetMessage(message);
                break;
                
            case 'user_joined':
                // Server must send roomId; tolerate older builds without it (spreadsheet single-room UX).
                if (message.roomId == null || message.roomId === this.currentRoom) {
                    this.addMessage('system', `${message.username} joined the room`);
                    if (message.userId && message.username) {
                        this._addUserToRoster({ id: message.userId, username: message.username });
                    }
                    // Re-broadcast our cursor so the freshly-joined collaborator
                    // discovers our position immediately. Cursor messages are
                    // only sent on local moves otherwise, so without this the
                    // newcomer would only see us once we move.
                    try {
                        const wSelfEmail = this.currentUser?.username || '';
                        if (this.m_SpInterface
                            && typeof this.m_SpInterface.sendMoveCell === 'function'
                            && message.username
                            && message.username.toLowerCase() !== wSelfEmail.toLowerCase()) {
                            const wCursor = this.m_SpInterface.m_Select && this.m_SpInterface.m_Select.cursor
                                ? this.m_SpInterface.m_Select.cursor()
                                : null;
                            if (wCursor) {
                                // force: roster / hasCollaboratorPeers can lag one tick; newcomer must receive this ping.
                                this.m_SpInterface.sendMoveCell(wCursor, { force: true });
                            }
                        }
                    } catch (e) {
                        console.warn('user_joined cursor re-broadcast failed', e);
                    }
                }
                break;
                
            case 'user_left':
                if (message.roomId == null || message.roomId === this.currentRoom) {
                    this.addMessage('system', `${message.username} left the room`);
                    if (message.userId) {
                        this._removeUserFromRoster(message.userId);
                    }
                    // Remove remote cursor for this user (username == email)
                    if (this.m_SpInterface && message.username) {
                        this.m_SpInterface.removeRemoteCursorByEmail(message.username);
                    }
                }
                break;

            case 'room_users':
                // Full roster response from server (if supported)
                if (message.roomId === this.currentRoom && Array.isArray(message.users)) {
                    this.connectedUsers = message.users.map(u => ({ id: u.id, username: u.username }));
                    this._syncMultiUserActive();
                    if (this._roomUsersResolve) {
                        const resolve = this._roomUsersResolve; this._roomUsersResolve = null;
                        resolve(this.connectedUsers);
                    }
                }
                break;
                
            case 'typing':
                if (message.isTyping && message.userId !== this.currentUser?.id) {
                    this.typingUsers = [
                        ...this.typingUsers.filter(u => u.id !== message.userId), 
                        { id: message.userId, username: message.username }
                    ];
                    
                    setTimeout(() => {
                        this.typingUsers = this.typingUsers.filter(u => u.id !== message.userId);
                    }, 3000);
                }
                break;
                
            case 'system':
                this.addMessage('system', message.message);
                break;
                
            case 'error':
                this.addMessage('system', `Error: ${message.error}`);
                break;
            default:
                break;
        }
    }

    async _handleSpreadsheetMessage(message) {
        if (message.roomId !== this.currentRoom) {
            return;
        }

        // Check if this is our own message using userId/username from the message envelope
        const isOwnMessageByEnvelope = (
            message.userId && this.currentUser?.id && message.userId === this.currentUser.id
        ) || (
            message.username && this.currentUser?.username && message.username === this.currentUser.username
        );

        if (isOwnMessageByEnvelope) {
            return;
        }

        let payload = message.message;
        if (typeof payload === 'string') {
            try { payload = JSON.parse(payload); } catch(_) {}
        }

        const selfEmail = this.currentUser?.username
            || (typeof window !== 'undefined' && window.sessionStorage?.getItem('email'))
            || (typeof window !== 'undefined' && window.localStorage?.getItem('email'))
            || '';

        // Check if this is our own message by comparing email in the payload
        // The message JSON structure has email at root level (from SkMessage.cpp WriteJson)
        if (payload && typeof payload === 'object') {
            // Root uses SkJsonKey short keys in WASM builds (em) or long keys when jsondebug.
            const payloadEmail = payload.email || payload.em || payload?.user?.m_Email;
            if (payloadEmail && selfEmail && payloadEmail.toLowerCase() === selfEmail.toLowerCase()) {
                // This is our own message, skip processing to avoid double processing
                return;
            }
        }

        let messageUri = null;
        if (message && typeof message.message === 'object' && message.message !== null) {
            messageUri = message.message.uri;
        }
        if (!messageUri && payload && typeof payload === 'object') {
            messageUri = payload.uri;
        }

        // Handle 'leaveWorkBook' before the uri-mismatch filter so collaborators
        // viewing a different workbook can also drop their stale cursor entry.
        if (payload && typeof payload === 'object' && payload.type === 'user' && payload.action === 'leaveWorkBook') {
            const email = payload?.user?.m_Email;
            if (this.m_SpInterface && email) {
                await this.m_SpInterface.removeRemoteCursorByEmailAndUri(email, payload.uri || '');
            }
            return;
        }

        let activeWorkBook = null;
        try {
            if (this.m_SpInterface && typeof this.m_SpInterface.getActiveWorkBook === 'function') {
                activeWorkBook = await this.m_SpInterface.getActiveWorkBook();
            } else if (typeof window !== 'undefined' && window.SkUISpreadSheet && typeof window.SkUISpreadSheet.getActiveWorkBook === 'function') {
                activeWorkBook = window.SkUISpreadSheet.getActiveWorkBook();
            }
        } catch (error) {
            console.error('Failed to resolve active workbook for spreadsheet message', error);
        }

        if (activeWorkBook && messageUri && messageUri !== activeWorkBook) {
            return;
        }

        let shouldReloadView = false;

        if (payload && typeof payload === 'object' && payload.type === 'user') {
            const action = payload.action;
            const email = payload?.user?.m_Email;
            const firstname = payload?.user?.m_Firstname || '';
            const lastname = payload?.user?.m_Name || '';
            const uri = payload.uri || '';
            const sheet = payload.sheet || '';
            const row = payload.row;
            const col = payload.col;
            if (action === 'moveCell' || action === 'cursor') {
                // Update remote cursor position; SkSpInterface filters on uri/sheet
                if (this.m_SpInterface && email) {
                    this.m_SpInterface.updateRemoteCursor(email, uri, sheet, row, col, firstname, lastname);
                }
            } else {
                console.log('Unknown action:', action);
            }
            // Do not reloadView for cursor-only traffic — getView can desync the grid vs WASM after heavy recalc.
        } else {
            const rawForOpId =
                typeof message.message === "string"
                    ? message.message
                    : (message.message != null ? JSON.stringify(message.message) : "");
            const op = payload?.op;
            if ((op === 'Do' || op === 'Undo' || op === 'Redo') && payload?.msg) {
                const opidRaw = this._extractSpreadsheetOpIdRaw(rawForOpId);
                const opid = opidRaw ?? payload.msg.opid ?? payload.msg.opId;
                if (opid != null && this._spreadsheetOpIdsSeen.has(String(opid))) {
                    // Echo of our own op (or duplicate); local WASM already applied via PostMessage path.
                    return;
                }
            }
            const ui =
                typeof window !== "undefined" && window.SkUISpreadSheet != null
                    ? window.SkUISpreadSheet
                    : null;
            if (ui != null && typeof ui.getMessage === "function") {
                const raw =
                    typeof message.message === "string"
                        ? message.message
                        : JSON.stringify(message.message);
                // Remote op must not move the receiver to the sender's active sheet.
                const wPrevSheet =
                    this.m_SpInterface?.m_UIView?.sheet &&
                    !this.m_SpInterface.isSystemSheetName?.(this.m_SpInterface.m_UIView.sheet)
                        ? this.m_SpInterface.m_UIView.sheet
                        : null;
                ui.getMessage(raw);
                if (wPrevSheet && typeof ui.setActiveSheet === "function") {
                    try {
                        const wNow = ui.getActiveSheet();
                        if (wNow !== wPrevSheet) {
                            ui.setActiveSheet(wPrevSheet);
                            if (this.m_SpInterface?.m_UIView) {
                                this.m_SpInterface.m_UIView.sheet = wPrevSheet;
                            }
                        }
                    } catch (_restoreSheetErr) {
                        /* best effort */
                    }
                }
            }
            shouldReloadView = true;
        }

        if (this.m_SpInterface != null && shouldReloadView) {
            await this.m_SpInterface.syncSheetTabsFromWasm();
            await this.m_SpInterface.reloadView();
        }
    }

    // Roster helpers
    _addUserToRoster(user) {
        if (!user?.id) return;
        const exists = this.connectedUsers.some(u => u.id === user.id);
        if (!exists) {
            this.connectedUsers.push({ id: user.id, username: user.username });
            this._syncMultiUserActive();
        }
    }

    _removeUserFromRoster(userId) {
        const wBefore = this.connectedUsers.length;
        this.connectedUsers = this.connectedUsers.filter(u => u.id !== userId);
        if (this.connectedUsers.length !== wBefore) {
            this._syncMultiUserActive();
        }
    }

    addMessageFromServer(message) {
        const email = localStorage.getItem('email');
        const isOwnMessage = message.username === email;
        
        console.log('=== DEBUG MESSAGE RECEPTION ===');
        console.log('Received message from server:', message);
        console.log('Message userId:', message.userId, 'Type:', typeof message.userId);
        console.log('Current user ID:', this.currentUser?.id, 'Type:', typeof this.currentUser?.id);
        console.log('Message username:', message.username);
        console.log('Current username:', this.currentUser?.username);
        console.log('Email from localStorage:', email);
        console.log('Is own message:', isOwnMessage);
        console.log('Message content:', message.message);
        console.log('================================');
        
        // For own messages, don't add them again since they were already added locally
        if (isOwnMessage) {
            console.log('Skipping own message that was already added locally');
            return;
        }
        
        console.log('Adding message from user:', message.username);
        this.addMessage('other', message.message, {
            username: message.username,
            timestamp: message.timestamp,
            messageId: message.id // Use server-generated ID if available
        });
    }

    createMessageFromServer(message) {
        const email = localStorage.getItem('email');
        const isOwnMessage = message.username === email;
        const messageClass = isOwnMessage ? 'own' : 'other';
        
        return {
            type: messageClass,
            text: message.message,
            metadata: {
                username: message.username,
                timestamp: message.timestamp
            }
        };
    }

    addMessage(type, text, metadata = {}) {
        const newMessage = {
            type,
            text,
            metadata
        };
        
        this.messages.push(newMessage);
    }

    // Getters for external access
    getMessages() {
        return this.messages;
    }

    getCurrentUser() {
        return this.currentUser;
    }

    getCurrentRoom() {
        return this.currentRoom;
    }

    getConnectionStatus() {
        return this.isConnected;
    }

    getTypingUsers() {
        return this.typingUsers;
    }

    // Connected users roster
    getConnectedUsers() {
        return this.connectedUsers;
    }

    getShowChat() {
        return this.showChat;
    }

    getShowJoinForm() {
        return this.showJoinForm;
    }
}

export default SkSpChat;
