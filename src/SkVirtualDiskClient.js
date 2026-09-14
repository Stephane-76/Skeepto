//=============================================================================
// SkVirtualDiskClient
// Example client for SkVirtualDisk that simulates Unix file system operations
// Author: Stéphane ALLEZ
//=============================================================================

function normalizeVirtualPath(p) {
    if (!p || typeof p !== 'string') return p;
    let out = p.replace(/\/+/g, '/');
    if (out.length > 1 && out.endsWith('/')) {
        out = out.slice(0, -1);
    }
    return out;
}

function joinVirtualPath(base, segment) {
    const seg = String(segment ?? '').replace(/^\/+/, '');
    if (!base || base === '/') {
        return normalizeVirtualPath('/' + seg);
    }
    return normalizeVirtualPath(`${base}/${seg}`);
}

/** SHA-256 hex; requires secure context (HTTPS or localhost). Returns '' if unavailable. */
async function sha256HexFromArrayBuffer(arrayBuffer) {
    const subtle = typeof window !== 'undefined' && window.crypto?.subtle;
    if (!subtle) {
        console.warn(
            'crypto.subtle unavailable (use HTTPS or localhost); file hash skipped'
        );
        return '';
    }
    const hashBuffer = await subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export class SkVirtualDiskClient {
    constructor(sInitialPath = null) {
        this.m_Owner = sessionStorage.getItem("email");
        this.m_Group = sessionStorage.getItem("group");
        this.m_BasePath = '/sker-files'; // Base path for all files
        
        // If an initial path is provided, normalize it and extract directory
        if (sInitialPath) {
            // Remove base path if present
            let normalizedPath = sInitialPath;
            if (normalizedPath.startsWith(this.m_BasePath)) {
                normalizedPath = normalizedPath.substring(this.m_BasePath.length) || '/';
            }
            
            // If it's a file (doesn't end with '/'), get its parent directory
            if (!normalizedPath.endsWith('/')) {
                const wParts = normalizedPath.split('/').filter(Boolean);
                if (wParts.length > 0) {
                    wParts.pop(); // Remove filename
                    this.m_CurrentPath = '/' + wParts.join('/');
                } else {
                    this.m_CurrentPath = '/';
                }
            } else {
                this.m_CurrentPath = normalizedPath || '/';
            }
        } else {
            this.m_CurrentPath = '/';
        }
        
        //console.log('SkVirtualDiskClient initialized with path:', this.m_CurrentPath);
    }

    // Normalize a path
    normalizePath(path) {
        // Absolute paths are combined with the base path
        if (path.startsWith('/')) {
            return this.m_BasePath + path;
        }
        // Otherwise combine with the current path
        return this.m_CurrentPath === '/' ? 
            `${this.m_BasePath}/${path}` : 
            `${this.m_CurrentPath}/${path}`;
    }

    // Create a directory under m_CurrentPath (same path convention as touch — logical paths like /docs/foo).
    async mkdir(dirName, sOptions = {}) {
        const cleanName = String(dirName || '').trim().replace(/^\/+|\/+$/g, '');
        if (!cleanName || cleanName.includes('/')) {
            throw new Error('Invalid folder name');
        }
        const fullPath = joinVirtualPath(this.m_CurrentPath, cleanName);

        const wDirData = {
            name: cleanName,
            path: fullPath,
            owner: this.m_Owner,
            group: this.m_Group,
            isDirectory: true,
            permissions: sOptions.permissions ?? 770,
        };

        try {
            /*
            console.log('Creating directory:', {
                name: cleanName,
                path: fullPath,
                owner: this.m_Owner,
                group: this.m_Group
            });
            */
            const wResponse = await window.WebInterface.postJson('/files', JSON.stringify(wDirData));
            //console.log('Raw response:', wResponse);

            // Check if response is already an object
            if (typeof wResponse === 'object') {
                if (wResponse.message === 'error') {
                    throw new Error(wResponse.error || 'Failed to create directory');
                }
                return wResponse;
            }

            // Try to parse if it's a string
            try {
                const wResult = JSON.parse(wResponse);
                if (wResult.message === 'error') {
                    throw new Error(wResult.error || 'Failed to create directory');
                }
                return wResult;
            } catch (parseError) {
                console.error('Error parsing response:', parseError);
                console.error('Response that failed to parse:', wResponse);
                throw new Error('Invalid response format from server');
            }
        } catch (error) {
            console.error('Error creating directory:', error);
            throw error;
        }
    }

    /** JSON fetch helper that preserves server error payloads (409 lock conflicts, etc.). */
    async _fetchJson(url, method, body) {
        const jwt = window.sessionStorage.getItem('jwt');
        const response = await fetch(url, {
            method,
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + jwt,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch {
            throw new Error(`Invalid server response: ${text}`);
        }

        if (!response.ok || result.message === 'error') {
            const error = new Error(result.error || result.message || `HTTP ${response.status}`);
            error.status = response.status;
            error.code = result.code;
            error.lock = result.lock;
            throw error;
        }

        return result;
    }

    /** Acquire or refresh a .html edit lock (30 min TTL, server-side). */
    async acquireDocumentLock(fullPath) {
        return this._fetchJson('/files/lock', 'POST', { path: fullPath });
    }

    /** Release a .html edit lock held by the current user. */
    async releaseDocumentLock(fullPath) {
        try {
            return await this._fetchJson('/files/lock', 'DELETE', { path: fullPath });
        } catch (error) {
            console.warn('releaseDocumentLock:', error?.message || error);
            return null;
        }
    }

    /** Read lock status for a .html path. */
    async getDocumentLock(fullPath) {
        const query = JSON.stringify({ path: fullPath });
        const response = await window.WebInterface.getJson('/files/lock', query);
        const data = typeof response === 'string' ? JSON.parse(response) : response;
        if (data.message === 'error') {
            throw new Error(data.error || 'Failed to read document lock');
        }
        return data;
    }

    /** Create a blank .sker on the server (WASM NewWorkBook + Mongo persistence). */
    async createSpreadsheet(sFileName, sOptions = {}) {
        const fullPath = joinVirtualPath(this.m_CurrentPath, sFileName);

        const body = {
            name: sFileName,
            path: fullPath,
            owner: this.m_Owner,
            group: this.m_Group,
            permissions: sOptions.permissions ?? 770,
        };

        try {
            const jwt = window.sessionStorage.getItem('jwt');
            const response = await fetch('/files/new-spreadsheet', {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + jwt,
                },
                body: JSON.stringify(body),
            });

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch {
                throw new Error(`Invalid server response: ${text}`);
            }

            if (!response.ok || result.message === 'error') {
                throw new Error(result.error || result.message || `HTTP ${response.status}`);
            }

            return result;
        } catch (error) {
            console.error('Error creating spreadsheet on server:', error);
            throw error;
        }
    }

    /**
     * Create a blank .html on the server (standalone HTML persisted in Directory).
     * @param {string} sFileName — file name only (e.g. "Untitled.html")
     * @param {{ permissions?: number }} sOptions
     */
    async createDocument(sFileName, sOptions = {}) {
        const fullPath = joinVirtualPath(this.m_CurrentPath, sFileName);

        const body = {
            name: sFileName,
            path: fullPath,
            owner: this.m_Owner,
            group: this.m_Group,
            permissions: sOptions.permissions ?? 770,
        };

        try {
            const jwt = window.sessionStorage.getItem('jwt');
            const response = await fetch('/files/new-document', {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + jwt,
                },
                body: JSON.stringify(body),
            });

            const text = await response.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch {
                throw new Error(`Invalid server response: ${text}`);
            }

            if (!response.ok || result.message === 'error') {
                throw new Error(result.error || result.message || `HTTP ${response.status}`);
            }

            return result;
        } catch (error) {
            console.error('Error creating document on server:', error);
            throw error;
        }
    }

    /** Read one virtual file metadata + inline content by full path. */
    async readFileContent(fullPath) {
        const normalized = normalizeVirtualPath(fullPath);
        const wQuery = JSON.stringify({ path: normalized });
        const wResponse = await window.WebInterface.getJson('/files', wQuery);
        const wData = typeof wResponse === 'string' ? JSON.parse(wResponse) : wResponse;
        if (wData.message !== 'success' || !wData.file) {
            throw new Error(wData.error || 'File not found');
        }
        return wData.file;
    }

    /** Create or update inline file content at a full virtual path. */
    async writeFileContent(fullPath, content, sOptions = {}) {
        const normalized = normalizeVirtualPath(fullPath);
        const segments = normalized.split('/').filter(Boolean);
        const name = segments.pop();
        if (!name) {
            throw new Error('Invalid file path');
        }

        const fileData = {
            name,
            path: normalized,
            content,
            owner: this.m_Owner,
            group: this.m_Group,
            isDirectory: false,
            permissions: sOptions.permissions ?? 770,
        };

        return this._fetchJson('/files', 'POST', fileData);
    }

    // Create a file
    async touch(sFileName, sContent = '', sOptions = {}) {
        const fullPath = joinVirtualPath(this.m_CurrentPath, sFileName);

        // If the content is a data URL (base64-encoded binary), skip chunking
        // and let the server decide GridFS (>16MB) vs inline.
        const CHUNK_SIZE = 1024 * 1024; // 1MB per chunk
        const isDataUrl = (typeof sContent === 'string') && sContent.startsWith('data:');
        const contentLength = new TextEncoder().encode(sContent).length;

        // .sker payloads must be parsed as a single JSON document server-side
        // (they are persisted in the Spreadsheet collection, with their own
        // GridFS overflow for large files). Chunked upload cannot work for
        // them: the empty placeholder POST would run JSON.parse('') and fail,
        // and the Directory GridFS chunks are ignored when a .sker is read
        // back. Always send them in a single POST (server body limit is 128MB).
        const nameLower = (typeof sFileName === 'string') ? sFileName.toLowerCase() : '';
        const isWholeParseFile = nameLower.endsWith('.sker');

        if (!isDataUrl && !isWholeParseFile && contentLength > CHUNK_SIZE) {
            console.error(`File is large (${(contentLength / (1024 * 1024)).toFixed(2)} MB), using chunks...`);
            // Create the empty file first
            const fileData = {
                name: sFileName,
                path: fullPath,
                content: '',
                owner: this.m_Owner,
                group: this.m_Group,
                isDirectory: false,
                permissions: 755
            };

            try {
                const wResponseRaw = await window.WebInterface.postJson('/files', JSON.stringify(fileData));
                const wResponse = (typeof wResponseRaw === 'string') ? JSON.parse(wResponseRaw) : wResponseRaw;
                if (!wResponse || wResponse.message === 'error') {
                    throw new Error(wResponse?.error || 'Failed to create placeholder file');
                }
                //console.log('Created empty file, now uploading content...');

                // Split the content into chunks
                const chunks = [];
                for (let i = 0; i < sContent.length; i += CHUNK_SIZE) {
                    chunks.push(sContent.slice(i, i + CHUNK_SIZE));
                }

                // Send each chunk
                for (let i = 0; i < chunks.length; i++) {
                    const chunkData = {
                        path: fullPath,
                        content: chunks[i],
                        chunkIndex: i,
                        totalChunks: chunks.length
                    };
                    const wChunkRaw = await window.WebInterface.postJson('/files/chunk', JSON.stringify(chunkData));
                    const wChunk = (typeof wChunkRaw === 'string') ? JSON.parse(wChunkRaw) : wChunkRaw;
                    if (!wChunk || wChunk.message === 'error') {
                        throw new Error(wChunk?.error || `Chunk ${i + 1}/${chunks.length} upload failed`);
                    }
                    //console.log(`Uploaded chunk ${i + 1}/${chunks.length} (${((i + 1) * CHUNK_SIZE / (1024 * 1024)).toFixed(2)} MB)`);
                }

                return { message: 'success', id: wResponse.id };
            } catch (error) {
                console.error('Error creating large file:', error);
                throw error;
            }
        } else {
            // For small files use the regular path
            const fileData = {
                name: sFileName,
                path: fullPath,
                content: sContent,
                owner: this.m_Owner,
                group: this.m_Group,
                isDirectory: false,
                permissions: 755,
                ...(sOptions && sOptions.originalSize ? { size: sOptions.originalSize } : {})
            };

            try {
                /*
                console.log('Creating file:', {
                    name: sFileName,
                    path: fullPath,
                    size: `${(contentLength / 1024).toFixed(2)} KB`,
                    owner: this.m_Owner,
                    group: this.m_Group
                });
                */
                const wResponse = await window.WebInterface.postJson('/files', JSON.stringify(fileData));
                //console.log('File created successfully');

                if (typeof wResponse === 'object') {
                    if (wResponse.message === 'error') {
                        throw new Error(wResponse.error || 'Failed to create file');
                    }
                    return wResponse;
                }

                try {
                    const wResult = JSON.parse(wResponse);
                    if (wResult.message === 'error') {
                        throw new Error(wResult.error || 'Failed to create file');
                    }
                    return wResult;
                } catch (parseError) {
                    console.error('Error parsing response:', parseError);
                    throw new Error('Invalid response format from server');
                }
            } catch (error) {
                console.error('Error creating file:', error);
                throw error;
            }
        }
    }

    /** Check read/write access for a virtual path before opening a file. */
    async checkFileAccess(sPath) {
        const wTargetPath = sPath || this.m_CurrentPath;
        // WebInterface.getJson encodes the query once — do not pre-encode (breaks paths with spaces).
        const wQuery = JSON.stringify({ path: wTargetPath });
        const wResponse = await window.WebInterface.getJson('/files/access', wQuery);
        let result;
        try {
            result = JSON.parse(wResponse);
        } catch {
            throw new Error(`Invalid server response: ${wResponse}`);
        }

        if (result.message === 'error') {
            throw new Error(result.error || 'Access check failed');
        }

        return result;
    }

    // List directory contents
    async loadFile(sPath = null) {
        try {
            const wTargetPath = sPath || this.m_CurrentPath;
            const wQuery = JSON.stringify({ path: wTargetPath });
            const wResponse = await window.WebInterface.getJson('/files', wQuery);
            //console.log('Raw response:', response);
            
            // Parse the response
            const wData = JSON.parse(wResponse);
            //console.log('Parsed data:', data);
            
            // Check if we have files in the response
            if (wData && wData.file) {
                //console.log('Found files:', data.enregs);
                return wData.file;
            }
            console.error('No files found in directory');
            return [];
        } catch (error) {
            console.error('Error listing directory contents:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack
            });
            return [];
        }
    }

    // Utility function to convert permissions number to Unix format string
  
    // Utility function to convert permissions number to Unix format string
    FormatUnixPermissions(sPermissions) {
        if (sPermissions === null || sPermissions === undefined) return '---------';
        
        const getPermString = (n) => {
          let perm = '';
          // Check bits in correct order: 4 (read), 2 (write), 1 (execute)
          perm += (n & 4) ? 'r' : '-';
          perm += (n & 2) ? 'w' : '-';
          perm += (n & 1) ? 'x' : '-';
          return perm;
        };
  
        // The input should be treated as if it were already in octal format
        // For example: 755 should be treated as 7, 5, 5
        // We need to extract each digit separately
        const wOwner = Math.floor(sPermissions / 100) % 10;
        const wGroup = Math.floor(sPermissions / 10) % 10;
        const wOthers = sPermissions % 10;
        
        return `${getPermString(wOwner)} ${getPermString(wGroup)} ${getPermString(wOthers)}`;
    };

    // List all files in a directory with detailed information
    async ls(sPath = null) {
        const wTargetPath = sPath || this.m_CurrentPath;
        const wEncodedPath = encodeURIComponent(wTargetPath);
        try {
            // Use provided path or current path
          
            //console.log('Listing directory contents for:', wTargetPath);

            // Make request to the list endpoint
            const wResponse = await window.WebInterface.getJson(`/files/list`,wEncodedPath);
            const wData = JSON.parse(wResponse);

            if (wData && wData.contents) {
                // Format the output
                const wResult = {
                    path: wData.currentPath,
                    files: wData.contents.map(file => ({
                        name: file.name,
                        type: file.isDirectory ? 'directory' : 'file',
                        path: file.path,
                        owner: file.owner,
                        group: file.group,
                        permissions: file.permissions,
                        size: file.size || 0,
                        lastModified: file.updatedAt || file.createdAt
                    }))
                };
                
                // Log the result
                //console.log(`Found ${result.files.length} items in ${result.path}`);
                /*
                result.files.forEach(file => {
                    const wPermissions = this.FormatUnixPermissions(file.permissions);
                    console.log(`${file.type === 'directory' ? 'd' : '-'} ${wPermissions} ${file.owner} ${file.group} ${file.size} ${file.lastModified} ${file.name}`);
                });
                */
                return wResult;
            }

            console.error('No files found in directory');
            return {
                path: wTargetPath,
                files: []
            };
        } catch (error) {
            console.error('Error listing directory:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack
            });
            return {
                path: wTargetPath,
                files: [],
                error: error.message
            };
        }
    }

    // Change directory
    async cd(sPath) {
        // Normalize path by removing base path if present
        let normalizedPath = sPath;
        if (normalizedPath.startsWith(this.m_BasePath)) {
            normalizedPath = normalizedPath.substring(this.m_BasePath.length) || '/';
        }
        
        if (normalizedPath === '..') {
            // Go up one directory
            const wParts = this.m_CurrentPath.split('/').filter(Boolean);
            wParts.pop();
            this.m_CurrentPath = '/' + wParts.join('/');
            if (this.m_CurrentPath === '') this.m_CurrentPath = '/';
        } else if (normalizedPath.startsWith('/')) {
            // Absolute path
            this.m_CurrentPath = normalizeVirtualPath(normalizedPath);
        } else {
            // Relative path
            this.m_CurrentPath = joinVirtualPath(this.m_CurrentPath, normalizedPath);
        }
        
        //console.log('Changed directory to:', this.m_CurrentPath);
        return this.m_CurrentPath;
    }

    // Change file permissions
    async chmod(sPath, sPermissions, options = {}) {
        try {
            let wTargetPath = sPath || this.m_CurrentPath;
            // Bare filenames are relative to m_CurrentPath (same convention as touch).
            if (wTargetPath && !wTargetPath.startsWith('/')) {
                wTargetPath = joinVirtualPath(this.m_CurrentPath, wTargetPath);
            } else if (wTargetPath) {
                wTargetPath = normalizeVirtualPath(wTargetPath);
            }

            //console.log('Changing permissions for:', wTargetPath);

            // chmod by path — do not GET /files first (GridFS files stream binary there).
            const wChmodPayload = { path: wTargetPath, permissions: sPermissions };
            if (options?.sharedAccess !== undefined) {
                wChmodPayload.sharedAccess = options.sharedAccess;
            }
            const wResponse = await window.WebInterface.postJson(
                '/files/chmod',
                JSON.stringify(wChmodPayload),
                'update'
            );
            const wData = typeof wResponse === 'string' ? JSON.parse(wResponse) : wResponse;  

            if (wData.message === 'success') {
                //console.log(`Successfully changed permissions for: ${sPath}`);
                return true;
            } else {
                throw new Error(`Failed to change permissions for: ${sPath}, ${wData.error}`);
            }
        } catch (error) {
            console.error('Error changing permissions:', error);
            throw error;
        }
    }

    // Remove a file or directory
    async rm(sPath) {
        try {
            // If path is not provided, use current path
            const wTargetPath = sPath || this.m_CurrentPath;
            const wQuery = JSON.stringify({path: wTargetPath});
            //console.log('Removing:', wTargetPath);

            // First check if the file/directory exists
            const wCheckResponse = await window.WebInterface.deleteJson('/files', wQuery);
            
            // Handle both string and object responses
            let wCheckData;
            if (typeof wCheckResponse === 'string') {
                wCheckData = JSON.parse(wCheckResponse);
            } else {
                wCheckData = wCheckResponse;
            }

            if (wCheckData.message !== 'success') {
                throw new Error(`File or directory not found: ${wTargetPath}, ${wCheckData.error}`);
            }

            return true;
        } catch (error) {
            console.error('Error removing file/directory:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    // Rename or move a file/directory in the virtual disk.
    // sNewName may be a bare name (rename within the same folder) or a full virtual path (move).
    async rename(sOldPath, sNewName) {
        const wOldPath = sOldPath || this.m_CurrentPath;
        if (!wOldPath || !sNewName) {
            throw new Error('rename requires a source path and a new name or path');
        }
        // A value containing a slash is treated as a full destination path, otherwise
        // keep the file inside its current parent directory.
        let wNewPath;
        if (sNewName.includes('/')) {
            wNewPath = sNewName;
        } else {
            const wParent = wOldPath.substring(0, wOldPath.lastIndexOf('/'));
            wNewPath = `${wParent}/${sNewName}`;
        }

        const wResponse = await window.WebInterface.postJson(
            '/files/rename',
            JSON.stringify({ oldPath: wOldPath, newPath: wNewPath })
        );
        const wData = typeof wResponse === 'string' ? JSON.parse(wResponse) : wResponse;
        if (wData.message !== 'success') {
            throw new Error(wData.error || 'Rename failed');
        }
        return wData.file || { path: wNewPath };
    }

    // Get the tree of the file system
    async tree() {
        const wResponse = await window.WebInterface.getJson(`/files/tree`);
        //console.log(wResponse);
        return JSON.parse(wResponse);
    }

    // Display tree structure recursively
    async displayTree(sPath = '', sIndent = '') {
        try {
            const wResponse = await window.WebInterface.getJson(`/files/tree`);
            const wData = JSON.parse(wResponse);

            if (!wData.tree) {
                console.log('No tree data available');
                return;
            }

            const displayNode = (node, indent) => {
                const wPrefix = node.isDirectory ? '📁 ' : '📄 ';
                const wPermissions = this.FormatUnixPermissions(node.permissions);
                const wOwner = node.owner;
                const wGroup = node.group;
                const wSize = node.size;
                console.log(`${indent}${wPrefix}${node.name} (${wPermissions}) ${wOwner} ${wGroup} ${wSize}`);

                if (node.isDirectory && node.children) {
                    node.children.forEach(child => {
                        displayNode(child, indent + '  ');
                    });
                }
            };

            console.log('\nFile system tree:');
            console.log('===================================');
            wData.tree.forEach(node => displayNode(node, sIndent));
            console.log('===================================\n');

        } catch (error) {
            console.error('Error while displaying the tree:', error);
        }
    }

    // Get MIME type for file extension
    getMimeType(sExtension) {
        const mimeTypes = {
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            'xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
            'xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
            'pdf': 'application/pdf',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'zip': 'application/zip',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            'txt': 'text/plain',
            'json': 'application/json',
            'html': 'text/html',
            'htm': 'text/html',
        };
        return mimeTypes[sExtension.toLowerCase()] || 'application/octet-stream';
    }

    // Helper function to convert ArrayBuffer to base64 in chunks to avoid stack overflow
    _arrayBufferToBase64(arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const chunkSize = 8192; // Process in 8KB chunks to avoid stack overflow
        let binary = '';
        
        for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.slice(i, i + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }
        
        return btoa(binary);
    }

    // Load binary files with proper MIME type handling
    async loadBinaryFiles(sFile, sClient) {
        try {
            const wFileName = sFile.name;
            const wExtension = wFileName.split('.').pop();
            const mimeType = this.getMimeType(wExtension);
            
            // Read file as ArrayBuffer
            const arrayBuffer = await sFile.arrayBuffer();
            
            // Convert to base64 in chunks to avoid "Maximum call stack size exceeded" error
            const base64Content = this._arrayBufferToBase64(arrayBuffer);
            const dataUrl = `data:${mimeType};base64,${base64Content}`;
            
            const fileHash = await sha256HexFromArrayBuffer(arrayBuffer);
            
            console.log(`Adding file ${wFileName} (${sFile.size} bytes)`);
            await sClient.touch(wFileName, dataUrl, {
                originalSize: sFile.size,
                hash: fileHash,
                mimeType: mimeType
            });
            
            return {
                name: wFileName,
                size: sFile.size,
                hash: fileHash,
                mimeType: mimeType
            };
        } catch (error) {
            console.error('Error in loadBinaryFiles:', error);
            throw error;
        }
    }

    _blobFromVirtualFilePayload(file, fallbackName) {
        const name = file.name || fallbackName || 'download';

        if (typeof file.content === 'string') {
            if (file.content.startsWith('data:')) {
                const commaIdx = file.content.indexOf(',');
                const meta = file.content.substring(5, commaIdx);
                const base64 = file.content.substring(commaIdx + 1);
                const byteChars = atob(base64);
                const byteNumbers = new Array(byteChars.length);
                for (let i = 0; i < byteChars.length; i++) {
                    byteNumbers[i] = byteChars.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const mime = meta.split(';')[0];
                return { blob: new Blob([byteArray], { type: mime }), fileName: name };
            }

            const ext = (name.split('.').pop() || '').toLowerCase();
            const mime = this.getMimeType(ext);
            return { blob: new Blob([file.content], { type: mime }), fileName: name };
        }

        if (file.content) {
            return {
                blob: new Blob([JSON.stringify(file.content, null, 2)], { type: 'application/json' }),
                fileName: name,
            };
        }

        throw new Error('Empty content');
    }

    _handleDownloadAuthFailure(response) {
        if (response.status !== 401 && response.status !== 403) {
            return;
        }
        if (typeof window.__skerPerformAppLogout === 'function') {
            void window.__skerPerformAppLogout({ reason: 'auth' });
            return;
        }
        window.sessionStorage.removeItem('jwt');
        window.sessionStorage.removeItem('user');
        window.sessionStorage.removeItem('email');
        if (typeof window.__skerNavigateLogin === 'function') {
            window.__skerNavigateLogin();
        }
    }

    /** Fetch virtual-disk file bytes (GridFS stream or inline JSON payload). */
    async fetchFileBlob(sPath) {
        const targetPath = sPath || this.m_CurrentPath;
        const queryObj = { path: targetPath };
        const url = `/files/${encodeURIComponent(JSON.stringify(queryObj))}?download=1`;

        const jwt = window.sessionStorage.getItem('jwt');
        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                authorization: 'Bearer ' + jwt,
                Accept: '*/*',
            },
        });

        if (!response.ok) {
            this._handleDownloadAuthFailure(response);
            throw new Error(`HTTP ${response.status}`);
        }

        const contentType = response.headers.get('content-type') || '';
        const fallbackName = targetPath.split('/').pop() || 'download';

        if (!contentType.includes('application/json')) {
            const blob = await response.blob();
            return { blob, fileName: fallbackName, targetPath };
        }

        const text = await response.text();
        const data = JSON.parse(text);
        if (data && data.file) {
            const { blob, fileName } = this._blobFromVirtualFilePayload(data.file, fallbackName);
            return { blob, fileName, targetPath };
        }

        throw new Error('Invalid download payload');
    }

    /**
     * Download a workbook for an external desktop app (Excel).
     * Browsers cannot launch Excel directly; we save the file with the correct MIME type.
     */
    async downloadForExternalOpen(sPath, options = {}) {
        const { blob, fileName } = await this.fetchFileBlob(sPath);
        const ext = (fileName.split('.').pop() || '').toLowerCase();
        const mimeType = blob.type && blob.type !== 'application/octet-stream'
            ? blob.type
            : this.getMimeType(ext);
        const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });

        if (
            options.trySavePicker !== false
            && typeof window.showSaveFilePicker === 'function'
        ) {
            try {
                const accept = { [mimeType]: ext ? [`.${ext}`] : [] };
                const handle = await window.showSaveFilePicker({
                    suggestedName: fileName,
                    types: [{ description: 'Excel workbook', accept }],
                });
                const writable = await handle.createWritable();
                await writable.write(typedBlob);
                await writable.close();
                return { method: 'savePicker', fileName };
            } catch (error) {
                if (error?.name === 'AbortError') {
                    return { method: 'cancelled', fileName };
                }
            }
        }

        this.saveBlob(fileName, typedBlob);
        return { method: 'download', fileName };
    }

  // Download a file by path
  async downloadFile(sPath) {
        try {
            const { blob, fileName } = await this.fetchFileBlob(sPath);
            this.saveBlob(fileName, blob);
            return true;
        } catch (error) {
            console.error('Error downloading file:', error);
            return false;
        }
    }

    saveBlob(fileName, blob) {
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    // List files by type
    async listFilesByType(sType) {
        try {
            const wResponse = await window.WebInterface.getJson(`/files/list`, encodeURIComponent('/home/sallez@skeema.fr/documents'));
            const wData = JSON.parse(wResponse);
            
            if (wData && wData.contents) {
                const files = wData.contents.filter(file => {
                    const ext = file.name.split('.').pop().toLowerCase();
                    return ext === sType.toLowerCase();
                });
                
                console.log(`\nFiles of type .${sType}:`);
                files.forEach(file => {
                    console.log(`- ${file.name} (${file.size} bytes)`);
                });
                
                return files;
            }
            return [];
        } catch (error) {
            console.error('Error listing files by type:', error);
            return [];
        }
    }

    // Verify file integrity after download
    async verifyFileIntegrity(sFile, sOriginalHash) {
        try {
            if (!sOriginalHash) return true;
            const arrayBuffer = await sFile.arrayBuffer();
            const currentHash = await sha256HexFromArrayBuffer(arrayBuffer);
            if (!currentHash) return true;
            const isIntegrityValid = currentHash === sOriginalHash;
            console.log(`File integrity check: ${isIntegrityValid ? 'PASSED' : 'FAILED'}`);
            return isIntegrityValid;
        } catch (error) {
            console.error('Error verifying file integrity:', error);
            return false;
        }
    }

    /** Create a labeled manual version snapshot for a .sker file. */
    async createSkerHistorySnapshot(sPath, sLabel, sComment = '') {
        const jwt = window.sessionStorage.getItem('jwt');
        const response = await fetch('/files/history/snapshot', {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + jwt,
            },
            body: JSON.stringify({
                path: sPath,
                label: sLabel,
                comment: sComment,
            }),
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch {
            throw new Error(`Invalid server response: ${text}`);
        }

        if (!response.ok || result.message === 'error') {
            throw new Error(result.error || result.message || `HTTP ${response.status}`);
        }

        return result;
    }

    /** List saved .sker versions for a virtual path. */
    async listSkerHistory(sPath, sLimit = 20) {
        const query = JSON.stringify({ path: sPath, limit: sLimit });
        const response = await window.WebInterface.getJson('/files/history', query);
        const data = typeof response === 'string' ? JSON.parse(response) : response;
        if (data.message === 'error') {
            throw new Error(data.error || 'Failed to load version history');
        }
        return data;
    }

    /** Restore a .sker file to a previous saved version. */
    async restoreSkerHistory(sPath, sVersionId) {
        const jwt = window.sessionStorage.getItem('jwt');
        const response = await fetch('/files/history/restore', {
            method: 'POST',
            mode: 'cors',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + jwt,
            },
            body: JSON.stringify({ path: sPath, versionId: sVersionId }),
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch {
            throw new Error(`Invalid server response: ${text}`);
        }

        if (!response.ok || result.message === 'error') {
            throw new Error(result.error || result.message || `HTTP ${response.status}`);
        }

        return result;
    }

    // Convert Excel file using SkExcel executable (async task + polling)
    async convertXlsx(sPath, options = {}) {
        const pollIntervalMs = options.pollIntervalMs ?? 2000;
        const pollTimeoutMs = options.pollTimeoutMs ?? 3 * 60 * 60 * 1000;

        try {
            const jwt = window.sessionStorage.getItem('jwt');
            const response = await fetch('/files/convert-xlsx', {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + jwt,
                },
                body: JSON.stringify({ path: sPath }),
            });

            const text = await response.text();
            let startPayload;
            try {
                startPayload = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid server response: ${text}`);
            }

            if (!response.ok && response.status !== 202) {
                const errorMsg = startPayload.error || startPayload.message || `HTTP ${response.status}`;
                throw new Error(`Error ${response.status}: ${errorMsg}`);
            }

            const mapSuccessResult = (result) => ({
                success: true,
                path: result.path,
                skerPath: result.createdSker?.targetPath || null,
                fileName: result.fileName,
                size: result.size,
                skExcelOutput: result.skExcelOutput || '',
                skExcelError: result.skExcelError || '',
            });

            if (response.status === 202 || startPayload.status === 'converting') {
                const taskId = startPayload.taskId;
                if (!taskId) {
                    throw new Error('Missing conversion taskId from server');
                }

                const startedAt = Date.now();
                while (Date.now() - startedAt < pollTimeoutMs) {
                    const pollResponse = await fetch(
                        `/files/convert-xlsx/tasks/${encodeURIComponent(taskId)}`,
                        {
                            method: 'GET',
                            mode: 'cors',
                            credentials: 'include',
                            headers: {
                                Authorization: 'Bearer ' + jwt,
                            },
                        },
                    );

                    const pollText = await pollResponse.text();
                    let taskPayload;
                    try {
                        taskPayload = JSON.parse(pollText);
                    } catch (e) {
                        throw new Error(`Invalid task response: ${pollText}`);
                    }

                    if (typeof options.onTaskUpdate === 'function') {
                        options.onTaskUpdate(taskPayload);
                    }

                    if (taskPayload.status === 'ready' && taskPayload.result) {
                        console.log('Excel conversion successful:', taskPayload.result);
                        return mapSuccessResult(taskPayload.result);
                    }

                    if (taskPayload.status === 'error') {
                        const details = taskPayload.result || {};
                        let errMsg = taskPayload.error || 'Conversion failed';
                        if (details.skExcelStderr) {
                            errMsg += `\n${details.skExcelStderr}`;
                        }
                        throw new Error(errMsg);
                    }

                    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                }

                throw new Error('Timeout waiting for Excel conversion');
            }

            if (startPayload.message === 'success') {
                console.log('Excel conversion successful:', startPayload);
                return mapSuccessResult(startPayload);
            }

            throw new Error(startPayload.error || 'Conversion failed');
        } catch (error) {
            console.error('Error converting Excel file:', error);
            throw error;
        }
    }

    // Export .sker to s_<name>.xlsx using SkExcel (async task + polling)
    async exportSkerToXlsx(sPath, options = {}) {
        const pollIntervalMs = options.pollIntervalMs ?? 2000;
        const pollTimeoutMs = options.pollTimeoutMs ?? 3 * 60 * 60 * 1000;

        try {
            const jwt = window.sessionStorage.getItem('jwt');
            const response = await fetch('/files/export-xlsx', {
                method: 'POST',
                mode: 'cors',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + jwt,
                },
                body: JSON.stringify({ path: sPath }),
            });

            const text = await response.text();
            let startPayload;
            try {
                startPayload = JSON.parse(text);
            } catch (e) {
                throw new Error(`Invalid server response: ${text}`);
            }

            if (!response.ok && response.status !== 202) {
                const errorMsg = startPayload.error || startPayload.message || `HTTP ${response.status}`;
                throw new Error(`Error ${response.status}: ${errorMsg}`);
            }

            const mapSuccessResult = (result) => ({
                success: true,
                path: result.path,
                xlsxPath: result.createdXlsx?.targetPath || null,
                fileName: result.fileName,
                size: result.size,
                skExcelOutput: result.skExcelOutput || '',
                skExcelError: result.skExcelError || '',
            });

            if (response.status === 202 || startPayload.status === 'converting') {
                const taskId = startPayload.taskId;
                if (!taskId) {
                    throw new Error('Missing export taskId from server');
                }

                const startedAt = Date.now();
                while (Date.now() - startedAt < pollTimeoutMs) {
                    const pollResponse = await fetch(
                        `/files/export-xlsx/tasks/${encodeURIComponent(taskId)}`,
                        {
                            method: 'GET',
                            mode: 'cors',
                            credentials: 'include',
                            headers: {
                                Authorization: 'Bearer ' + jwt,
                            },
                        },
                    );

                    const pollText = await pollResponse.text();
                    let taskPayload;
                    try {
                        taskPayload = JSON.parse(pollText);
                    } catch (e) {
                        throw new Error(`Invalid task response: ${pollText}`);
                    }

                    if (typeof options.onTaskUpdate === 'function') {
                        options.onTaskUpdate(taskPayload);
                    }

                    if (taskPayload.status === 'ready' && taskPayload.result) {
                        console.log('Sker export successful:', taskPayload.result);
                        return mapSuccessResult(taskPayload.result);
                    }

                    if (taskPayload.status === 'error') {
                        const details = taskPayload.result || {};
                        let errMsg = taskPayload.error || 'Export failed';
                        if (details.skExcelStderr) {
                            errMsg += `\n${details.skExcelStderr}`;
                        }
                        throw new Error(errMsg);
                    }

                    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                }

                throw new Error('Timeout waiting for Sker export');
            }

            if (startPayload.message === 'success') {
                console.log('Sker export successful:', startPayload);
                return mapSuccessResult(startPayload);
            }

            throw new Error(startPayload.error || 'Export failed');
        } catch (error) {
            console.error('Error exporting Sker file:', error);
            throw error;
        }
    }
}
