/**
 * Parse virtual disk path from a /spreadsheet/... request URL.
 */

export function parseSpreadsheetRequestUrl(requestUrl) {
  let urlPath = requestUrl || '';
  const queryIndex = urlPath.indexOf('?');
  if (queryIndex !== -1) {
    urlPath = urlPath.substring(0, queryIndex);
  }
  urlPath = urlPath.replace(/^\/spreadsheet/, '');
  urlPath = urlPath.replace(/^\//, '');
  return urlPath;
}

export function normalizeSpreadsheetVirtualPath(pathSegment) {
  let decoded = pathSegment;
  try {
    decoded = decodeURIComponent(pathSegment);
  } catch (_) {
    decoded = pathSegment;
  }
  return decoded.startsWith('/') ? decoded : `/${decoded}`;
}

/**
 * Extract workbook virtual path after an optional route prefix (e.g. "content").
 * Returns null when the URL does not match the prefix.
 */
export function extractSpreadsheetVirtualPath(requestUrl, routePrefix = '') {
  let urlPath = parseSpreadsheetRequestUrl(requestUrl);
  if (routePrefix) {
    const prefixWithSlash = `${routePrefix}/`;
    if (!urlPath.startsWith(prefixWithSlash)) {
      return null;
    }
    urlPath = urlPath.slice(prefixWithSlash.length);
  }
  if (!urlPath || urlPath === '') {
    return null;
  }
  return normalizeSpreadsheetVirtualPath(urlPath);
}

/** Paths handled by dedicated routes — catch-all GET /spreadsheet/* must skip them. */
export const SPREADSHEET_RESERVED_URL_PREFIXES = [
  'pool/',
  'wasm/',
  'content/',
  'tasks/',
  'call',
  'persist',
];

export function isReservedSpreadsheetUrlPath(urlPath) {
  if (!urlPath) return true;
  if (urlPath === 'routes' || urlPath === '' || urlPath === 'post' || urlPath === 'open') {
    return true;
  }
  return SPREADSHEET_RESERVED_URL_PREFIXES.some((prefix) => urlPath.startsWith(prefix));
}
