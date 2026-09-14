import React from 'react';
import SkComponent from './SkComponent';
import SkWebSocketManager from '../utility/SkWebSocketManager';
import PropTypes from 'prop-types';
import { showAlert } from '../skDialog.js';
import './SkComponent.css';

export class SkChat extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            currentUser: null,
            currentRoom: null,
            messages: [],
            isConnected: false,
            isTyping: false,
            typingUsers: [],
            showJoinForm: true,
            showChat: false
        };
        
        // Initialize WebSocket manager
        this.wsManager = new SkWebSocketManager();
        this.messageInputRef = React.createRef();
        this.messagesContainerRef = React.createRef();
        this.typingTimeout = null;
    }

    componentDidMount() {
        this.setupWebSocketManager();
        this.wsManager.connect();
    }

    componentWillUnmount() {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }
        this.wsManager.destroy();
    }

    setupWebSocketManager = () => {
        // Set message callback
        this.wsManager.setMessageCallback(this.handleIncomingMessage);
        
        // Set connection status callback
        this.wsManager.setConnectionChangeCallback((isConnected) => {
            this.setState({ 
                isConnected,
                showChat: isConnected ? this.state.showChat : false,
                showJoinForm: !isConnected
            });
        });
    }

    joinRoom = async () => {
        // Get user information from sessionStorage
        const user = sessionStorage.getItem('user');
        const email = sessionStorage.getItem('email');
        
        if (!user) {
            await showAlert({ message: 'Please login first' });
            return;
        }
        
        // Use user information from sessionStorage
        const userId = email || user; // Use email as userId if available
        const username = email || user;
        const roomId = this.props.roomId || 'general';
        
        if (!this.wsManager.getConnectionStatus()) {
            this.wsManager.connect();
            setTimeout(() => this.joinRoom(), 1000);
            return;
        }
        
        const success = this.wsManager.joinRoom(roomId);
        
        if (success) {
            this.setState({
                currentUser: { id: userId, username: username },
                currentRoom: roomId
            });
        }
    }

    sendMessage = () => {
        const message = this.messageInputRef.current.value.trim();
        
        if (!message || !this.wsManager.getConnectionStatus()) {
            return;
        }
        
        // Generate unique message ID for local tracking
        const messageId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Add message locally with "own" type for immediate display
        this.addMessage('own', message, {
            username: this.state.currentUser?.username,
            timestamp: new Date().toISOString(),
            messageId: messageId
        });
        
        const success = this.wsManager.sendChatMessage(message, this.state.currentRoom);
        
        if (success) {
            this.messageInputRef.current.value = '';
            // Clear typing indicator
            this.clearTypingIndicator();
        }
    }

    handleKeyPress = (event) => {
        if (event.key === 'Enter') {
            this.sendMessage();
        } else {
            // Send typing indicator
            this.sendTypingIndicator(true);
        }
    }

    sendTypingIndicator = (isTyping) => {
        if (!this.wsManager.getConnectionStatus()) return;
        
        this.wsManager.sendTypingIndicator(isTyping);
    }

    clearTypingIndicator = () => {
        if (this.typingTimeout) {
            clearTimeout(this.typingTimeout);
        }
        
        this.typingTimeout = setTimeout(() => {
            this.sendTypingIndicator(false);
        }, 1000);
    }

    handleIncomingMessage = (message) => {
        switch (message.type) {
            case 'authenticated':
                console.log('Authentication successful:', message);
                this.setState({
                    currentUser: { id: message.userId, username: message.username }
                });
                // Automatically join the default room after authentication
                this.joinRoom();
                break;
                
            case 'joined':
                this.setState({
                    showJoinForm: false,
                    showChat: true
                });
                this.addMessage('system', `Welcome to room ${message.roomId}!`);
                break;
                
            case 'history':
                const newMessages = [...this.state.messages];
                message.messages.forEach(msg => {
                    newMessages.push(this.createMessageFromServer(msg));
                });
                this.setState({ messages: newMessages });
                break;
                
            case 'message':
                this.addMessageFromServer(message);
                break;
                
            case 'user_joined':
                this.addMessage('system', `${message.username} joined the room`);
                break;
                
            case 'user_left':
                this.addMessage('system', `${message.username} left the room`);
                break;
                
            case 'typing':
                if (message.isTyping && message.userId !== this.state.currentUser?.id) {
                    this.setState({
                        typingUsers: [...this.state.typingUsers.filter(u => u.id !== message.userId), 
                                    { id: message.userId, username: message.username }]
                    });
                    
                    setTimeout(() => {
                        this.setState({
                            typingUsers: this.state.typingUsers.filter(u => u.id !== message.userId)
                        });
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

    addMessageFromServer = (message) => {
        const email = sessionStorage.getItem('email');
        const isOwnMessage = message.username === email;
        /*
        console.log('=== DEBUG MESSAGE RECEPTION ===');
        console.log('Received message from server:', message);
        console.log('Message userId:', message.userId, 'Type:', typeof message.userId);
        console.log('Current user ID:', this.state.currentUser?.id, 'Type:', typeof this.state.currentUser?.id);
        console.log('Message username:', message.username);
        console.log('Current username:', this.state.currentUser?.username);
        console.log('Email from sessionStorage:', email);
        console.log('Is own message:', isOwnMessage);
        console.log('Message content:', message.message);
        console.log('================================');
        */
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

    createMessageFromServer = (message) => {
        const email = sessionStorage.getItem('email');
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

    addMessage = (type, text, metadata = {}) => {
        const newMessage = {
            type,
            text,
            metadata
        };
        
        this.setState(prevState => ({
            messages: [...prevState.messages, newMessage]
        }), () => {
            // Scroll to bottom after message is added
            if (this.messagesContainerRef.current) {
                this.messagesContainerRef.current.scrollTop = this.messagesContainerRef.current.scrollHeight;
            }
        });
    }

    render() {
        const { 
            isConnected, 
            showJoinForm, 
            showChat, 
            messages, 
            currentUser, 
            currentRoom, 
            typingUsers 
        } = this.state;

        console.log('=== RENDER DEBUG ===');
        console.log('showChat:', showChat);
        console.log('messages count:', messages.length);
        console.log('messages:', messages);
        console.log('showJoinForm:', showJoinForm);
        console.log('isConnected:', isConnected);
        console.log('==================');

        // Check if user is logged in
        const user = sessionStorage.getItem('email');
        const isLoggedIn = !!user;

        return (
            <div className="SkChat" ref={this.m_Ref} style={this.props.style}>
                <h3>Chat</h3>
                
                {!isLoggedIn && (
                    <div className="login-required">
                        <p>Please login to access the chat.</p>
                    </div>
                )}
                
                {isLoggedIn && showJoinForm && (
                    <div className="join-form">
                        <h3>Chat Connection</h3>
                        <p>Connected user: <strong>{user}</strong></p>
                        <p>Default room: <strong>{this.props.roomId || 'general'}</strong></p>
                        <button onClick={this.joinRoom}>Join Chat</button>
                    </div>
                )}
                
                <div className={`connection-status ${isConnected ? 'connected' : 'disconnected'}`}>
                    {isConnected ? 'Connected' : 'Disconnected'}
                </div>
                
                {showChat && (
                    <div className="chat-container">
                        <div className="chat-header">
                            <h3>Room: <span>{currentRoom}</span></h3>
                            <p>User: <span>{currentUser?.username}</span></p>
                        </div>
                        
                        <div className="chat-messages" ref={this.messagesContainerRef}>
                            {messages.map((msg, index) => (
                                <div key={index} className={`message ${msg.type}`}>
                                    {msg.metadata?.username && msg.metadata?.timestamp && (
                                        <div className="message-info">
                                            {msg.metadata.username} - {new Date(msg.metadata.timestamp).toLocaleTimeString()}
                                        </div>
                                    )}
                                    <div>{msg.text}</div>
                                </div>
                            ))}
                        </div>
                        
                        {typingUsers.length > 0 && (
                            <div className="typing-indicator">
                                {typingUsers.map(user => user.username).join(', ')} typing...
                            </div>
                        )}
                        
                        <div className="chat-input">
                            <input 
                                type="text" 
                                ref={this.messageInputRef}
                                placeholder="Type your message..." 
                                onKeyPress={this.handleKeyPress}
                            />
                            <button onClick={this.sendMessage}>Send</button>
                        </div>
                    </div>
                )}

                <style jsx>{`
                    .SkChat {
                        max-width: 800px;
                        margin: 0 auto;
                        padding: 2px;
                    }
                    
                    .chat-container {
                        background: white;
                        border-radius: 8px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                        overflow: hidden;
                    }
                    
                    .chat-header {
                        background: #007bff;
                        color: white;
                        padding: 15px;
                        text-align: center;
                    }
                    
                    .chat-messages {
                        height: 400px;
                        overflow-y: auto;
                        padding: 15px;
                        background: #f8f9fa;
                    }
                    
                    .message {
                        margin-bottom: 10px;
                        padding: 8px 12px;
                        border-radius: 15px;
                        max-width: 70%;
                        word-wrap: break-word;
                    }
                    
                    .message.own {
                        background: #007bff;
                        color: white;
                        margin-left: auto;
                    }
                    
                    .message.other {
                        background: #e9ecef;
                        color: #333;
                    }
                    
                    .message.system {
                        background: #ffc107;
                        color: #333;
                        text-align: center;
                        font-style: italic;
                    }
                    
                    .message-info {
                        font-size: 0.8em;
                        opacity: 0.7;
                        margin-bottom: 2px;
                    }
                    
                    .chat-input {
                        display: flex;
                        padding: 15px;
                        background: white;
                        border-top: 1px solid #dee2e6;
                    }
                    
                    .chat-input input {
                        flex: 1;
                        padding: 10px;
                        border: 1px solid #dee2e6;
                        border-radius: 20px;
                        margin-right: 10px;
                    }
                    
                    .chat-input button {
                        padding: 10px 20px;
                        background: #007bff;
                        color: white;
                        border: none;
                        border-radius: 20px;
                        cursor: pointer;
                    }
                    
                    .chat-input button:hover {
                        background: #0056b3;
                    }
                    
                    .connection-status {
                        padding: 10px;
                        text-align: center;
                        font-weight: bold;
                    }
                    
                    .connected {
                        background: #d4edda;
                        color: #155724;
                    }
                    
                    .disconnected {
                        background: #f8d7da;
                        color: #721c24;
                    }
                    
                    .join-form {
                        background: white;
                        padding: 20px;
                        border-radius: 8px;
                        margin-bottom: 20px;
                        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    }
                    
                    .join-form input {
                        padding: 10px;
                        margin: 5px;
                        border: 1px solid #dee2e6;
                        border-radius: 4px;
                    }
                    
                    .join-form button {
                        padding: 10px 20px;
                        background: #28a745;
                        color: white;
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                    }
                    
                    .typing-indicator {
                        font-style: italic;
                        color: #6c757d;
                        padding: 5px 15px;
                    }
                    
                    .login-required {
                        background: #fff3cd;
                        color: #856404;
                        padding: 15px;
                        border-radius: 8px;
                        text-align: center;
                        margin-bottom: 20px;
                        border: 1px solid #ffeaa7;
                    }
                `}</style>
            </div>
        );
    }
}

SkChat.propTypes = {
    roomId: PropTypes.string,
    style: PropTypes.object
};

SkChat.defaultProps = {
    roomId: 'general',
    style: {}
};

export default SkChat; 