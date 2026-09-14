//=====================================================================
// Server Fastify SkSpreadSheet
//=====================================================================

import Fastify from 'fastify'
import cors from '@fastify/cors'
import compress from '@fastify/compress'
import compressible from 'compressible'
import jwt  from 'jsonwebtoken'
import fastifyStatic from "@fastify/static"
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'node:fs'
import { JWT_SECRET, SkLogin } from './SkLogin/SkLogin.mjs';
import dependenciesContainer from './Depency/SkDepencyManager.mjs';


import SkSpSpreadSheet from './SkSpreadSheet/SkSpSpreadSheet.mjs';
import SkSpFastify from './SkSpreadSheet/SkSpFastify.mjs';

import { SkMetaModel } from '../MetaModel/SkMetaModel.mjs';
import { SkUsersDb } from './Mongo/SkUsersDb.mjs'
import { SkMetaModelDb } from './Mongo/SkMetaModelDb.mjs'
import { SkGenericDb } from './Mongo/SkGenericDb.mjs';
import { SkDependencyContainer } from './Depency/SkDepencyContainer.mjs'
import { SkVirtualDiskDb } from './SkVirtualDisk/SkVirtualDiskDb.mjs';
import { SkSQL } from './Mongo/SkSQL.mjs';
import { createSkChat } from './Chat/SkChatServer.mjs';
import { SkAiFastify } from './SkAI/SkAiFastify.mjs';
import { registerAiSpreadsheetUser } from './SkAI/SkAiMessageBus.mjs';

import fastifyMongodb from '@fastify/mongodb'
const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

// Table for store routes
const registeredRoutes = [];

const fastify = Fastify({
  logger: true,
  logger: {
     level: 'warn' // Change the level to silent error warn info
  },
  // Match SkVirtualDisk FILES_UPLOAD_BODY_LIMIT (large .sker uploads).
  bodyLimit: 128 * 1024 * 1024,
  // convert-xlsx / SkExcel can run 30+ minutes on large workbooks.
  connectionTimeout: 0,
  requestTimeout: 0,
})

// Gzip/deflate for static assets (JS/CSS/HTML). Skip application/json — gzip breaks JSON API bodies (login).
await fastify.register(compress, {
  global: true,
  threshold: 256,
  encodings: ['gzip', 'deflate'],
  customTypes: (contentType) => {
    const type = String(contentType || '').split(';')[0].trim().toLowerCase()
    if (type === 'application/json') return false
    if (type === 'text/event-stream') return false
    return compressible(type)
  },
})

// Register static files (React Index.html ..)
// STATIC_ROOT can be provided via environment; fallback to ../../build if exists
const DEFAULT_BUILD = path.resolve(__dirname, '../../build');
const STATIC_ROOT = process.env.STATIC_ROOT || (fs.existsSync(DEFAULT_BUILD) ? DEFAULT_BUILD : undefined);
if (STATIC_ROOT) {
  // Serve WASM source maps with correct Content-Type for Chrome debug
  // Register route for .wasm.map files BEFORE static handler (so it takes priority)
  fastify.get('/SkReactSpreadSheet.wasm.map', async (request, reply) => {
    const mapPath = path.join(STATIC_ROOT, 'SkReactSpreadSheet.wasm.map');
    if (fs.existsSync(mapPath)) {
      reply.type('application/json');
      const fileContent = fs.readFileSync(mapPath, 'utf8');
      return reply.send(fileContent);
    }
    return reply.status(404).send({ error: 'Source map not found' });
  });
  
  fastify.register(fastifyStatic, {
    root: STATIC_ROOT,
  });
  fastify.log.info(`Serving static files from ${STATIC_ROOT}`);
} else {
  fastify.log.warn('STATIC_ROOT not set and default build not found; static files will not be served');
}

// Serve C++ source files for WASM debugging (Chrome DevTools)
// These paths are referenced in the .wasm.map source map
const SKER_ROOT = path.resolve(__dirname, '../../../sker');
if (fs.existsSync(SKER_ROOT)) {
  // Serve Libraries/* source files
  fastify.register(fastifyStatic, {
    root: path.join(SKER_ROOT, 'Libraries'),
    prefix: '/Libraries/',
    decorateReply: false
  });
  
  // Serve SkReactSpreadSheet/* source files
  fastify.register(fastifyStatic, {
    root: path.join(SKER_ROOT, 'SkReactSpreadSheet'),
    prefix: '/SkReactSpreadSheet/',
    decorateReply: false
  });
  
  fastify.log.info(`Serving C++ source files from ${SKER_ROOT} for WASM debugging`);
} else {
  fastify.log.warn(`Sker root not found at ${SKER_ROOT}; C++ source files will not be available for debugging`);
}

// Initialize SkChat after server creation
let skChat = null;

// Initialize SkSpreadSheetServer
let wSkSpreadSheet = new SkSpSpreadSheet();

await wSkSpreadSheet.initializeSkerSpreadSheet();

// Add JWT verification for WebSocket connections
const verifyJWTForWebSocket = (token) => {
  try {
    const user = jwt.verify(token, JWT_SECRET);
    return { success: true, user };
  } catch (err) {
    console.log("❌ Error verifying JWT token for WebSocket:", err);
    return { success: false, error: 'Invalid token' };
  }
};

/* Debug */
// Request metadata is available before body parsing.
fastify.addHook('onRequest', async (request, reply) => {
  console.log('\n=== New incoming request ===');
  console.log('URL:', request.url);
  console.log('Method:', request.method);
  console.log('Content-Type:', request.headers['content-type']);
  if (request.headers['x-operation-mode']) {
    console.log('X-Operation-Mode:', request.headers['x-operation-mode']);
  }
});

// Body is parsed by Fastify before preHandler runs.
fastify.addHook('preHandler', async (request, reply) => {
  try {
    let bodyStr = '';
    if (typeof request.body === 'string') {
      bodyStr = request.body;
    } else if (request.body !== undefined && request.body !== null) {
      try {
        bodyStr = JSON.stringify(request.body);
      } catch {
        bodyStr = String(request.body);
      }
    }
    if (bodyStr) {
      const preview = bodyStr.length > 50 ? bodyStr.substring(0, 50) + '…' : bodyStr;
      console.log('Body (first 50):', preview);
    }
  } catch (e) {
    console.log('Body (error displaying):', e?.message || e);
  }
  console.log('==============================\n');
});

fastify.addHook('onResponse', async (request, reply) => {
  console.log(`Response: ${reply.statusCode} ${request.method} ${request.url}`);
  
  // Log error responses in detail
  if (reply.statusCode >= 400) {
    console.error('Error Response Details:', {
      statusCode: reply.statusCode,
      url: request.url,
      method: request.method,
      headers: reply.getHeaders(),
      payload: reply.payload
    });
  }
  
  // Log response time for performance monitoring (using modern property)
  if (reply.elapsedTime !== undefined) {
    console.log(`Response time: ${reply.elapsedTime}ms for ${request.method} ${request.url}`);
  }
});

/**
 * Protected API prefixes require JWT. GET /spreadsheet alone is the React shell
 * (browser refresh sends no Authorization header); API lives under /spreadsheet/...
 */
function requiresJwtAuth(request) {
  const pathname = (request.originalUrl || request.url || '').split('?')[0].replace(/\/+$/, '') || '/';
  const segments = pathname.slice(1).split('/');
  const first = (segments[0] || '').toLowerCase();

  if (request.method === 'GET' && first === 'spreadsheet' && segments.length < 2) {
    return false;
  }

  const protectedPrefixes = ['/mdb', '/meta', '/users', '/files', '/sql', '/spreadsheet', '/ai', '/mcp'];
  return protectedPrefixes.some((prefix) => pathname.toLowerCase().startsWith(prefix));
}

// Add a hook to check the JWT token BEFORE registering other plugins
fastify.addHook('preHandler', async (request, reply) => {
      if (!requiresJwtAuth(request)) {
        return;
      }

      const authHeader = request.headers.authorization;
      const token = authHeader && authHeader.split(' ')[1];

      if (!token) {
        console.log("No token found");
        return reply.status(401).send({ error: 'No authorized' }); // Unauthorized
      }

      try {
        const user = jwt.verify(token, JWT_SECRET);
        request.user = user; // Stocker les informations sur l'utilisateur
      } catch (err) {
        console.log("❌ Error verifying token:", err);
        return reply.status(401).send({ error: 'Invalid token' }); // Unauthorized (expired / bad JWT)
      }
});

// Register plugins AFTER the preHandler hook

/**
 * Mongo connection URL: never put credentials in source — use .env or Docker env.
 * - MONGO_URL: full URI (optional)
 * - Or MONGO_USER + MONGO_PASSWORD + MONGO_HOST (password encoded for spaces/special chars)
 */
function resolveMongoUrl() {
  if (process.env.MONGO_URL?.trim()) {
    return process.env.MONGO_URL.trim()
  }
  const host = process.env.MONGO_HOST || 'localhost'
  const port = process.env.MONGO_PORT || '27017'
  const db = process.env.MONGO_DB || 'skeepto'
  const authSource = process.env.MONGO_AUTH_SOURCE || 'admin'
  const noAuth =
    process.env.MONGO_NO_AUTH === '1' ||
    process.env.MONGO_NO_AUTH === 'true'
  if (noAuth) {
    return `mongodb://${host}:${port}/${db}`
  }
  const user = process.env.MONGO_USER?.trim()
  const password = process.env.MONGO_PASSWORD
  if (user && password != null && password !== '') {
    const u = encodeURIComponent(user)
    const p = encodeURIComponent(password)
    return `mongodb://${u}:${p}@${host}:${port}/${db}?authSource=${authSource}`
  }
  return `mongodb://${host}:${port}/${db}?authSource=${authSource}`
}

// Register MongoDB first
await fastify.register(fastifyMongodb, {
  forceClose: true,
  url: resolveMongoUrl()
})
console.log('MongoDB registered');

// Register MongoDB in dependency container for internal use
dependenciesContainer.register("MongoDb", fastify.mongo);

// Ensure required collections exist to prevent NamespaceNotFound (code 26)
async function ensureMongoCollections() {
  try {
    const db = fastify.mongo.db;
    const required = new Set([
      'Directory',
      'Spreadsheet',
      'User',
      'metamodel', // utilisé par SkMetaModelDb (lowercase)
      'files.files', // GridFS
      'files.chunks'
    ]);
    const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name);
    for (const name of required) {
      if (!existing.includes(name)) {
        try {
          await db.createCollection(name);
          console.log(`Created missing collection: ${name}`);
        } catch (e) {
          // Ignore if created concurrently
          if (e?.codeName !== 'NamespaceExists') {
            console.warn(`Could not create collection ${name}:`, e?.message || e);
          }
        }
      }
    }
  } catch (e) {
    console.warn('ensureMongoCollections error:', e?.message || e);
  }
}
await ensureMongoCollections();

// Configuration CORS ========================================================
await fastify.register(cors, {
  //origin: 'http://localhost:8000', // URL of the React app
  methods: ['GET', 'PUT', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-operation-mode'],
  credentials: true,
  maxAge: 86400 // 24 heures
})

// Global error handlers ===================================================
fastify.setErrorHandler(function (error, request, reply) {
  const wPrematureClose =
    error?.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
    /premature close/i.test(String(error?.message || ''));
  if (wPrematureClose) {
    return;
  }

  console.error('Global error handler caught:', error);
  
  // Log detailed error information
  console.error('Error details:', {
    message: error.message,
    stack: error.stack,
    statusCode: error.statusCode,
    url: request.url,
    method: request.method
  });
  
  // Handle specific error types
  if (error.validation) {
    return reply.status(400).send({
      error: 'Validation Error',
      message: error.message,
      details: error.validation
    });
  }
  
  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.name || 'Error',
      message: error.message
    });
  }
  
  // Default error response
  return reply.status(500).send({
    error: 'Internal Server Error',
    message: error.message || 'An unexpected error occurred'
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Register =================================================================
fastify.register(SkLogin);
fastify.register(SkMetaModelDb);
fastify.register(SkGenericDb);
fastify.register(SkUsersDb);
fastify.register(SkVirtualDiskDb);
fastify.register(SkSQL);  
fastify.register(SkSpFastify);
fastify.register(SkAiFastify);

// add hook to capture routes at the time of registration
fastify.addHook('onRoute', (routeOptions) => {
  //console.log(`Route registered: ${routeOptions.method} ${routeOptions.path}`);
  registeredRoutes.push(routeOptions);
});

// add hook to display routes
fastify.ready(() => {
  console.log('\n=== Available routes ===');
  if (registeredRoutes.length > 0) {
    registeredRoutes.forEach(route => {
      console.log(`${route.method} ${route.url}`);
    });
  } else {
    console.log('No routes found');
  }
  console.log('========================\n');
});

fastify.get('/index', (request, reply) => {
  console.log('Index request received');
    reply.sendFile('index.html' )
})

// Serve root path to index.html when static serving is enabled
fastify.get('/', (request, reply) => {
  try {
    return reply.sendFile('index.html');
  } catch {
    return reply.status(404).send({ message: 'Not Found' });
  }
})

// List routes
fastify.get('/routes', async (request, reply) => {
  if (registeredRoutes.length === 0) {
    return { error: 'No routes found' };
  }
  return registeredRoutes;
});

// -----------------------------------------------------------------------------
// SPA fallback (React Router): Safari / trackpad "swipe back" performs a real
// GET on /virtualdisk, /spreadsheet, etc. Without this, Fastify returns JSON 404.
// Only enable when we serve the CRA build from STATIC_ROOT.
// -----------------------------------------------------------------------------
if (STATIC_ROOT) {
  const ASSET_EXT_RE = /\.[a-z0-9][a-z0-9._-]*$/i;

  function isApiOrAssetPath(pathname) {
    if (!pathname) return true;
    if (ASSET_EXT_RE.test(pathname)) return true;
    const p = pathname.split('?')[0].replace(/\/+$/, '') || '/';
    if (p === '/') return true;
    const segments = p.slice(1).split('/');
    const first = (segments[0] || '').toLowerCase();

    switch (first) {
      case 'mdb':
      case 'meta':
      case 'sql':
      case 'protected':
      case 'routes':
      case 'chat':
      case 'users':
      case 'files':
      case 'api':
        return true;
      case 'libraries':
      case 'skreactspreadsheet':
        return true;
      case 'spreadsheet':
        // React route is GET /spreadsheet; API paths are /spreadsheet/...
        return segments.length >= 2;
      default:
        return false;
    }
  }

  fastify.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split('?')[0];
    if (request.method === 'GET' && !isApiOrAssetPath(pathname)) {
      return reply.sendFile('index.html');
    }
    return reply.status(404).send({
      message: `Route ${request.method}:${pathname} not found`,
      error: 'Not Found',
      statusCode: 404,
    });
  });

  fastify.log.info('SPA shell: unhandled GET paths serve build/index.html');
}

function Init() {
  console.log('-->Loading Metamodel')
  let wError='';
  let wMetaModel=new SkMetaModel("Sker Model","Version 1.0")
  // Load Metamodel File (Synchronous) ======================================
  let wFile=path.join(__dirname, "./Model/DataModel.json")
  let wData= fs.readFileSync(wFile,'utf8') 
    try {
      wMetaModel.Parse(wData)
    } catch(sError) {
      console.log('Error parsing metamodel',sError)
    }
    
  wError=wMetaModel.Verify(this)
  if (wError==="") {
    wMetaModel.Link()
    global['metamodel']=wMetaModel
  }  
  /*
  // Example of code injection with dependencies 
  function looseJsonParse(obj) {
    return Function('"use strict";return (' + obj + ")")();
  }
  let wObj=looseJsonParse("{a:(4-1), b:function(){ console.log('Ok') }, c:new Date()}");
  
  /// Register dependencies with the container
  wSkDependencyContainer.Register('logger',console.log('logger'))
  wSkDependencyContainer.Register('userService', console.log("useService"));
  
  wSkDependencyContainer.Resolve('logger');
  wObj.b()
  */
  return(wError)
}

function Success() {
  // Initialize SkChat after server is ready ==================================
  try {
    skChat = createSkChat(fastify.server, {
      path: '/chat',
      maxMessageLength: 100000,
      maxUsersPerRoom: 50,
      messageHistorySize: 100,
      jwtVerifier: verifyJWTForWebSocket // Pass JWT verification function
    });
    
    console.log('SkChat initialized successfully');
    registerAiSpreadsheetUser();

    // Add REST API routes for chat management with JWT verification
    fastify.get('/api/chat/rooms', async (request, reply) => {
      // JWT verification is already handled by preHandler hook
      return {
        success: true,
        rooms: skChat.getAllRooms()
      };
    });
    
    fastify.get('/api/chat/rooms/:roomId', async (request, reply) => {
      // JWT verification is already handled by preHandler hook
      const { roomId } = request.params;
      const roomInfo = skChat.getRoomInfo(roomId);
      
      if (!roomInfo) {
        return reply.status(404).send({
          success: false,
          error: 'Room not found'
        });
      }
      
      return {
        success: true,
        room: roomInfo
      };
    });
    
    fastify.get('/api/chat/rooms/:roomId/history', async (request, reply) => {
      // JWT verification is already handled by preHandler hook
      const { roomId } = request.params;
      const { limit = 50 } = request.query;
      
      const history = skChat.getMessageHistory(roomId, parseInt(limit));
      
      return {
        success: true,
        roomId,
        messages: history
      };
    });
    
    fastify.post('/api/chat/rooms/:roomId/system-message', async (request, reply) => {
      // JWT verification is already handled by preHandler hook
      const { roomId } = request.params;
      const { message } = request.body;
      
      if (!message) {
        return reply.status(400).send({
          success: false,
          error: 'Message is required'
        });
      }
      
      const systemMessage = skChat.sendSystemMessage(roomId, message);
      
      return {
        success: true,
        message: systemMessage
      };
    });
    
    fastify.delete('/api/chat/users/:userId', async (request, reply) => {
      // JWT verification is already handled by preHandler hook
      const { userId } = request.params;
      const { roomId, reason } = request.body;
      
      if (!roomId) {
        return reply.status(400).send({
          success: false,
          error: 'Room ID is required'
        });
      }
      
      const kicked = skChat.kickUser(userId, roomId, reason);
      
      if (!kicked) {
        return reply.status(404).send({
          success: false,
          error: 'User not found in room'
        });
      }
      
      return {
        success: true,
        message: 'User kicked successfully'
      };
    });
    
    fastify.get('/api/chat/stats', async (request, reply) => {
      // JWT verification is already handled by preHandler hook
      return {
        success: true,
        stats: skChat.getStats()
      };
    });
    
    // Event listeners for chat events
    skChat.on('userJoined', (data) => {
      console.log(`User joined: ${data.username} in room ${data.roomId}`);
      dependenciesContainer.resolve("SkSpreadSheet").chatJoin(data.username);
    });
    
    skChat.on('userLeft', (data) => {
      console.log(`User left: ${data.username} from room ${data.roomId}`);
      dependenciesContainer.resolve("SkSpreadSheet").chatLeave(data.username);
    });
    
    skChat.on('message', (data) => {
      console.log(`New message: ${data.username} in room ${data.roomId}: ${data.message}`);
    });
    
    // Listen spreadsheet-specific messages and forward to SkSpreadSheet
    skChat.on('spreadsheetMessage', (data) => {
      try {
        const payload = typeof data.message === 'string' ? data.message : JSON.stringify(data.message);
        dependenciesContainer.resolve("SkSpreadSheet").chatReceiveMessage(payload);
      } catch (err) {
        console.error('Error forwarding spreadsheet message to SkSpreadSheet:', err);
      }
    });
    
  } catch (error) {
    console.error('Error initializing SkChat:', error);
  }
  
  // Run the server ! ===========================================================
  try {
    const port = Number(process.env.PORT) || 8000;
    // Localhost by default (nginx reverse proxy). Set BIND_HOST=0.0.0.0 for Docker direct expose.
    const host = process.env.BIND_HOST || '127.0.0.1';
    const wsHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`SkServer Version 1.0, Listening on ${host}:${port}`)
    console.log(`SkChat WebSocket endpoint: ws://${wsHost}:${port}/chat`)
    fastify.listen({ port, host }, (err, address) => {
      if (err) {
        fastify.log.error(err)
        process.exit(1)
      }
      console.log(`Server listening at ${address}`)
    })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}


function Catch(sCatch) {
  console.log('Catch ',sCatch);
}

console.log('-->Begin')
const wPromesseInit = new Promise((Success, Catch) => {
  try {
    //Init
   Init()
   // Launch Server
   Success()
  } catch(sError) {
    Catch(sError)
  }
}).then(Success).catch(Catch)

//const CloseSpreadSheet=SkSppreadSheet.CloseSpreadSheet();
//CloseSpreadSheet();

console.log("--->End")
