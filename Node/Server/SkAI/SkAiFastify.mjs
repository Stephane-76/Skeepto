//=============================================================================
// SkAiFastify.mjs — POST /ai/ask + MCP HTTP /mcp for Cursor cloud agents
//=============================================================================

import { randomUUID } from 'node:crypto';
import { GridFSBucket } from 'mongodb';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { registerSkMcpTools } from './SkMcpToolRegistrar.mjs';
import { SkeeptoTools } from './SkeeptoTools.mjs';
import {
  getAiProviderStatus as getCursorProviderStatus,
  probeMcpPublicTunnel,
  runCursorAgentAsk,
} from './SkAiCursorProvider.mjs';
import { getLlamaProviderStatus, runLlamaAsk } from './SkAiLlamaProvider.mjs';
import { getAiUserLocale, setAiUserLocale } from './SkAiLocaleContext.mjs';
import { normalizeSpreadsheetContextFromRequest } from './SkAiSpreadsheetContext.mjs';

const GRIDFS_CHUNK_SIZE = 14 * 1024 * 1024;

function getActiveAiProvider() {
  return (process.env.SK_AI_PROVIDER || 'cursor').toLowerCase();
}

async function getUnifiedAiProviderStatus() {
  const wProvider = getActiveAiProvider();
  if (wProvider === 'llama') {
    const wStatus = await getLlamaProviderStatus();
    const wAgent = Boolean(wStatus.llamaMcp);
    return {
      ...wStatus,
      /** Can edit the open workbook via MCP tools (any provider). */
      spreadsheetAgent: wAgent,
      /** Text only — no workbook or MCP tools required. */
      textOnly: !wAgent,
      /** Public MCP tunnel must be reachable before /ai/ask (Cursor cloud). */
      requiresMcpTunnel: false,
    };
  }

  const wStatus = getCursorProviderStatus();
  return {
    ...wStatus,
    spreadsheetAgent: Boolean(wStatus.configured),
    textOnly: false,
    requiresMcpTunnel: true,
  };
}

/** @type {Record<string, StreamableHTTPServerTransport>} */
const mcpTransports = {};

/**
 * @param {import('fastify').FastifyRequest} request
 */
function getUserContext(request) {
  return {
    userEmail: request.user?.userEmail || 'anonymous@local',
    group: request.user?.group || 'default',
  };
}

/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {string}
 */
function extractBearerToken(request) {
  const wHeader = request.headers.authorization || '';
  const wParts = wHeader.split(' ');
  return wParts.length === 2 ? wParts[1] : '';
}

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {import('mongodb').GridFSBucket|null} gridFSBucket
 * @param {import('fastify').FastifyRequest} request
 */
function createToolsForRequest(fastify, gridFSBucket, request) {
  const { userEmail, group } = getUserContext(request);
  return new SkeeptoTools({
    fastify,
    userEmail,
    group,
    gridFSBucket,
    spreadsheetLang: getAiUserLocale(userEmail),
  });
}

/**
 * @param {import('./SkeeptoTools.mjs').SkeeptoTools} tools
 */
function createMcpServer(tools) {
  const wServer = new McpServer({
    name: 'sker-spreadsheet',
    version: '0.1.0',
  });
  registerSkMcpTools(wServer, tools);
  return wServer;
}

export async function SkAiFastify(fastify) {
  let gridFSBucket = null;
  try {
    gridFSBucket = new GridFSBucket(fastify.mongo.db, {
      chunkSizeBytes: GRIDFS_CHUNK_SIZE,
      bucketName: 'files',
    });
  } catch (err) {
    console.error('SkAiFastify: GridFS init failed:', err?.message || err);
  }

  fastify.get('/ai/status', async function (request, reply) {
    const wStatus = await getUnifiedAiProviderStatus();

    if (!wStatus.requiresMcpTunnel) {
      return {
        message: 'success',
        ...wStatus,
      };
    }

    const wMcpBase = wStatus.mcpPublicUrl?.replace(/\/mcp$/, '') || null;
    let wTunnelReachable = null;
    if (wMcpBase) {
      wTunnelReachable = await probeMcpPublicTunnel(wMcpBase);
      if (!wTunnelReachable) {
        wStatus.hints = [
          ...(wStatus.hints || []),
          'SK_MCP_PUBLIC_URL is not reachable from this machine — restart cloudflared/ngrok and update .env.',
        ];
      }
    }
    return {
      message: 'success',
      ...wStatus,
      mcpTunnelReachable: wTunnelReachable,
    };
  });

  fastify.post('/ai/ask', async function (request, reply) {
    const wAbort = new AbortController();
    const wOnClientDisconnect = () => {
      if (reply.sent) {
        return;
      }
      if (!wAbort.signal.aborted) {
        wAbort.abort(new Error('Client disconnected'));
      }
    };
    request.raw.on('aborted', wOnClientDisconnect);
    const wOnClientClose = () => {
      if (request.raw.aborted) {
        wOnClientDisconnect();
      }
    };
    request.raw.on('close', wOnClientClose);

    try {
      const wBody = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
      const wPrompt = typeof wBody?.prompt === 'string' ? wBody.prompt.trim() : '';

      if (!wPrompt) {
        return reply.status(400).send({ message: 'error', error: 'prompt is required' });
      }

      const wProvider = getActiveAiProvider();
      if (wProvider !== 'cursor' && wProvider !== 'llama') {
        return reply.status(501).send({
          message: 'error',
          error: `Provider not implemented yet: ${wProvider}`,
        });
      }

      const wUserJwt = extractBearerToken(request);
      if (!wUserJwt) {
        return reply.status(401).send({ message: 'error', error: 'JWT required' });
      }

      setAiUserLocale(request.user?.userEmail, wBody?.spreadsheetLang);

      const wSpreadsheetContext = normalizeSpreadsheetContextFromRequest(wBody);

      const wAskOptions = {
        prompt: wPrompt,
        workbookPath: wBody?.workbookPath || wBody?.path || wSpreadsheetContext?.workbookPath,
        spreadsheetLang: wBody?.spreadsheetLang,
        spreadsheetContext: wSpreadsheetContext ?? undefined,
        timeoutMs: wBody?.timeoutMs,
        abortSignal: wAbort.signal,
        history: Array.isArray(wBody?.history) ? wBody.history : undefined,
      };

      let wResult;
      if (wProvider === 'llama') {
        wResult = await runLlamaAsk({
          ...wAskOptions,
          spreadsheetTools: createToolsForRequest(fastify, gridFSBucket, request),
          userEmail: request.user?.userEmail,
        });
      } else {
        const wMcpBase = getCursorProviderStatus().mcpPublicUrl?.replace(/\/mcp$/, '');
        if (wMcpBase && !(await probeMcpPublicTunnel(wMcpBase))) {
          return reply.status(503).send({
            message: 'error',
            error:
              'Tunnel MCP injoignable (cloudflared/ngrok arrêté ou URL expirée). ' +
              'Relancez le tunnel, mettez à jour SK_MCP_PUBLIC_URL dans .env et redémarrez SkServer.',
            hints: getCursorProviderStatus().hints,
          });
        }

        wResult = await runCursorAgentAsk({
          ...wAskOptions,
          userJwt: wUserJwt,
        });
      }

      if (wAbort.signal.aborted || request.raw.aborted) {
        return;
      }
      return {
        message: 'success',
        ...wResult,
      };
    } catch (error) {
      const wAborted =
        wAbort.signal.aborted ||
        request.raw.aborted ||
        error?.code === 'ABORTED' ||
        error?.statusCode === 499 ||
        error?.name === 'AbortError';
      if (wAborted) {
        if (!reply.sent) {
          try {
            return reply.status(499).send({ message: 'error', error: 'Requête annulée.' });
          } catch {
            return;
          }
        }
        return;
      }
      const wPrematureClose =
        error?.code === 'ERR_STREAM_PREMATURE_CLOSE' ||
        /premature close/i.test(String(error?.message || ''));
      if (wPrematureClose || reply.sent) {
        return;
      }
      const wStatus = error?.statusCode || 500;
      console.error('POST /ai/ask error:', error?.message || error);
      return reply.status(wStatus).send({
        message: 'error',
        error: error?.message || 'AI request failed',
        details: error?.details,
        hints: (await getUnifiedAiProviderStatus()).hints,
      });
    } finally {
      request.raw.off('aborted', wOnClientDisconnect);
      request.raw.off('close', wOnClientClose);
    }
  });

  const mcpHandler = async function (request, reply) {
    const wSessionId = request.headers['mcp-session-id'];
    const wMethod = request.body?.method || request.body?.params?.method || '';
    if (request.body?.method === 'initialize' || (!wSessionId && isInitializeRequest(request.body))) {
      console.log('[mcp] initialize from', request.ip, 'user=', request.user?.userEmail || '?');
    } else if (wSessionId) {
      console.log('[mcp]', request.method, request.body?.method || '?', 'session=', String(wSessionId).slice(0, 8));
    }

    const wTools = createToolsForRequest(fastify, gridFSBucket, request);

    try {
      let wTransport;

      if (wSessionId && mcpTransports[wSessionId]) {
        wTransport = mcpTransports[wSessionId];
      } else if (!wSessionId && isInitializeRequest(request.body)) {
        wTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            mcpTransports[sessionId] = wTransport;
          },
        });

        wTransport.onclose = () => {
          const wSid = wTransport.sessionId;
          if (wSid && mcpTransports[wSid]) {
            delete mcpTransports[wSid];
          }
        };

        const wServer = createMcpServer(wTools);
        await wServer.connect(wTransport);
      } else {
        return reply.status(400).send({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Bad Request: invalid MCP session' },
          id: null,
        });
      }

      reply.hijack();
      await wTransport.handleRequest(request.raw, reply.raw, request.body);
    } catch (error) {
      console.error('MCP /mcp error:', error?.message || error);
      if (!reply.sent) {
        return reply.status(500).send({
          message: 'error',
          error: error?.message || 'MCP request failed',
        });
      }
    }
  };

  fastify.route({
    method: ['POST', 'GET', 'DELETE'],
    url: '/mcp',
    handler: mcpHandler,
  });

  console.log('SkAiFastify registered (/ai/ask, /ai/status, /mcp)');
}
