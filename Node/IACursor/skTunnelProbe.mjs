#!/usr/bin/env node
//=============================================================================
// skTunnelProbe.mjs — check trycloudflare / ngrok URL reachability (DNS + HTTP)
//=============================================================================

import dns from 'node:dns';
import { Resolver } from 'node:dns/promises';
import fs from 'node:fs';
import { request as httpsRequest } from 'node:https';

/** Cloudflare API / dashboard hosts that appear in error logs — not quick-tunnel URLs. */
const RESERVED_TRYCLOUDFLARE_HOSTS = new Set(['api.trycloudflare.com', 'dash.trycloudflare.com']);

/** Public resolvers — macOS system DNS often misses fresh *.trycloudflare.com records. */
const PUBLIC_DNS = ['1.1.1.1', '8.8.8.8'];

/**
 * @param {string} hostname
 * @returns {Promise<string[]>}
 */
async function resolveHostA(hostname) {
  const wTrycloudflare = hostname.endsWith('.trycloudflare.com');
  const wResolvers = [];

  if (wTrycloudflare) {
    const wPublic = new Resolver();
    wPublic.setServers(PUBLIC_DNS);
    wResolvers.push(wPublic);
  }

  wResolvers.push(dns.promises);

  for (const wResolver of wResolvers) {
    try {
      const wIps = await wResolver.resolve4(hostname);
      if (Array.isArray(wIps) && wIps.length > 0) {
        return wIps;
      }
    } catch {
      // try next resolver
    }
  }
  return [];
}

/**
 * @param {string} hostname
 * @param {string} path
 * @param {string} ip
 * @returns {Promise<string>}
 */
function httpsGetStatus(hostname, path, ip) {
  return new Promise((resolve) => {
    const req = httpsRequest(
      {
        host: ip,
        servername: hostname,
        path: path || '/',
        method: 'GET',
        timeout: 8000,
        headers: { Host: hostname },
      },
      (res) => {
        res.resume();
        resolve(String(res.statusCode ?? '000'));
      }
    );
    req.on('error', () => resolve('000'));
    req.on('timeout', () => {
      req.destroy();
      resolve('000');
    });
    req.end();
  });
}

/**
 * Pick the last quick-tunnel URL from a cloudflared log.
 * Ignores https://api.trycloudflare.com (API endpoint in error lines).
 * @param {string} logText
 * @returns {string}
 */
export function extractQuickTunnelUrl(logText) {
  const wMatches = String(logText || '').match(
    /https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com/g
  );
  if (!wMatches) {
    return '';
  }
  for (let i = wMatches.length - 1; i >= 0; i--) {
    try {
      const wHost = new URL(wMatches[i]).hostname.toLowerCase();
      if (!RESERVED_TRYCLOUDFLARE_HOSTS.has(wHost)) {
        return wMatches[i];
      }
    } catch {
      // skip malformed match
    }
  }
  return '';
}

/**
 * @param {string} filePath
 * @returns {string}
 */
export function extractQuickTunnelUrlFromLogFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return '';
  }
  return extractQuickTunnelUrl(fs.readFileSync(filePath, 'utf8'));
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isReservedTrycloudflareUrl(url) {
  try {
    return RESERVED_TRYCLOUDFLARE_HOSTS.has(new URL(String(url || '').trim()).hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @returns {Promise<{ ok: boolean, url: string, httpCode: string, dns: string[], error?: string }>}
 */
export async function probeTunnelUrl(url) {
  const wBase = String(url || '').trim().replace(/\/$/, '');
  if (!wBase) {
    return { ok: false, url: '', httpCode: '000', dns: [], error: 'empty url' };
  }

  let wHost;
  let wPath = '/';
  try {
    const wParsed = new URL(wBase);
    wHost = wParsed.hostname;
    wPath = `${wParsed.pathname || '/'}${wParsed.search || ''}` || '/';
  } catch {
    return { ok: false, url: wBase, httpCode: '000', dns: [], error: 'invalid url' };
  }

  if (RESERVED_TRYCLOUDFLARE_HOSTS.has(String(wHost || '').toLowerCase())) {
    return {
      ok: false,
      url: wBase,
      httpCode: '000',
      dns: [],
      error: `${wHost} is the Cloudflare API, not a quick tunnel`,
    };
  }

  const wDns = await resolveHostA(wHost);
  if (wDns.length === 0) {
    return {
      ok: false,
      url: wBase,
      httpCode: '000',
      dns: [],
      error: `DNS NXDOMAIN or no A record for ${wHost}`,
    };
  }

  let wCode = '000';
  for (const wIp of wDns) {
    wCode = await httpsGetStatus(wHost, wPath, wIp);
    if (/^2\d{2}$/.test(wCode)) {
      break;
    }
  }

  const wOk = /^2\d{2}$/.test(wCode);
  return {
    ok: wOk,
    url: wBase,
    httpCode: wCode,
    dns: wDns,
    error: wOk ? undefined : `HTTP ${wCode} via ${wDns[0]}`,
  };
}

async function main() {
  if (process.argv[2] === '--from-log') {
    const wUrl = extractQuickTunnelUrlFromLogFile(process.argv[3] || '');
    if (!wUrl) {
      process.exit(1);
    }
    console.log(wUrl);
    process.exit(0);
  }

  const wUrl = process.argv[2] || '';
  const wResult = await probeTunnelUrl(wUrl);
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(wResult, null, 2));
  } else {
    console.log(
      wResult.ok
        ? `OK ${wResult.url} HTTP ${wResult.httpCode} (${wResult.dns[0]})`
        : `FAIL ${wResult.url} — ${wResult.error || 'unreachable'}`
    );
  }
  process.exit(wResult.ok ? 0 : 1);
}

if (process.argv[1]?.endsWith('skTunnelProbe.mjs')) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(1);
  });
}
