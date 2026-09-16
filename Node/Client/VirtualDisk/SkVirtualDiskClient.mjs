//=============================================================================
// SkVirtualDiskClient.mjs
// Example client for SkVirtualDisk that simulates Unix file system operations
// Author: Stéphane ALLEZ
//=============================================================================

import { SkWebInterface } from '../SkWebInterface.mjs';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

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

class SkVirtualDiskClient {
    constructor(webInterface) {
        this.webInterface = webInterface;
        this.m_CurrentPath = '/';
        this.m_Owner = 'admin@sker.com';
        this.m_Group = 'admin';
    }

    // Set Owner
    setOwner(sOwner) {
        this.m_Owner = sOwner;
    }

    // Set Group

    setGroup(sGroup) {
        this.m_Group = sGroup;
    }

    // Check if the user is in the group
    isGroup(sGroup) {
        return this.m_Group === sGroup;
    }

    _encodedFilePathQuery(targetPath) {
        return encodeURIComponent(JSON.stringify({ path: normalizeVirtualPath(targetPath) }));
    }

    // Create a directory (dirName may be relative to m_CurrentPath or an absolute path like /var)
    async mkdir(dirName, options = {}) {
        const raw = String(dirName || '').trim();
        const fullPath = raw.startsWith('/')
            ? normalizeVirtualPath(raw)
            : joinVirtualPath(this.m_CurrentPath, raw.replace(/^\/+|\/+$/g, ''));
        const segments = fullPath.split('/').filter(Boolean);
        const cleanName = segments[segments.length - 1] || raw;

        const wDirData = {
            name: cleanName,
            path: fullPath,
            owner: this.m_Owner,
            group: this.m_Group,
            isDirectory: true,
            permissions: options.permissions ?? 775,
        };

        try {
            console.log('Creating directory:', {
                name: cleanName,
                path: fullPath,
                owner: this.m_Owner,
                group: this.m_Group
            });

            const wResponse = await this.webInterface.postJson('/files', JSON.stringify(wDirData));
            console.log('Raw response:', wResponse);

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
                console.log('Response that failed to parse:', wResponse);
                throw new Error('Invalid response format from server');
            }
        } catch (error) {
            console.error('Error creating directory:', error);
            throw error;
        }
    }

    // Create a file
    async touch(sFileName, sContent = '', metadata = {}) {
        const fullPath = joinVirtualPath(this.m_CurrentPath, sFileName);

        if (sFileName=="Budget.sker") {
                console.log('touch: ',sFileName);
        }
        // Si le contenu est trop grand, on le découpe en morceaux
        const CHUNK_SIZE = 1024 * 1024; // 1MB par morceau
        const contentLength = Buffer.byteLength(sContent);
        
        if (contentLength > CHUNK_SIZE) {
            console.log(`File is large (${(contentLength / (1024 * 1024)).toFixed(2)} MB), using chunks...`);
            // On crée d'abord le fichier vide
            const fileData = {
                name: sFileName,
                path: fullPath,
                content: '',
                owner: this.m_Owner,
                group: this.m_Group,
                isDirectory: false,
                permissions:775, // rwx-rwx r-x
                ...metadata
            };

            try {
                const wResponse = await this.webInterface.postJson('/files', JSON.stringify(fileData));
                console.log('Created empty file, now uploading content...');

                // On découpe le contenu en morceaux
                const chunks = [];
                for (let i = 0; i < sContent.length; i += CHUNK_SIZE) {
                    chunks.push(sContent.slice(i, i + CHUNK_SIZE));
                }

                // On envoie chaque morceau
                for (let i = 0; i < chunks.length; i++) {
                    const chunkData = {
                        path: fullPath,
                        content: chunks[i],
                        chunkIndex: i,
                        totalChunks: chunks.length
                    };
                    await this.webInterface.postJson('/files/chunk', JSON.stringify(chunkData));
                    console.log(`Uploaded chunk ${i + 1}/${chunks.length} (${((i + 1) * CHUNK_SIZE / (1024 * 1024)).toFixed(2)} MB)`);
                }

                return { message: 'success', id: wResponse.id };
            } catch (error) {
                console.error('Error creating large file:', error);
                throw error;
            }
        } else {
            // Pour les petits fichiers, on utilise la méthode normale
            const fileData = {
                name: sFileName,
                path: fullPath,
                content: sContent,
                owner: this.m_Owner,
                group: this.m_Group,
                isDirectory: false,
                permissions: 775,
                ...metadata
            };

            try {
                console.log('Creating file:', {
                    name: sFileName,
                    path: fullPath,
                    size: `${(contentLength / 1024).toFixed(2)} KB`,
                    owner: this.m_Owner,
                    group: this.m_Group
                });

                const wResponse = await this.webInterface.postJson('/files', JSON.stringify(fileData));
               
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

    // List directory contents
    async loadFile(sPath = null) {
        try {
            const wTargetPath = sPath || this.m_CurrentPath;
            // Create query to find all files in current directory
            const wEncodedQuery = this._encodedFilePathQuery(wTargetPath);
            const wResponse = await this.webInterface.getJson(`/files`, wEncodedQuery);
            //console.log('Raw response:', response);
            
            // Parse the response
            const wData = JSON.parse(wResponse);
            //console.log('Parsed data:', data);
            
            // Check if we have files in the response
            if (wData && wData.enregs) {
                //console.log('Found files:', data.enregs);
                return wData.enregs;
            }
            console.log('No files found in directory');
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
        try {
            // Use provided path or current path
            const wTargetPath = sPath || this.m_CurrentPath;
            const wEncodedPath = encodeURIComponent(wTargetPath);
            console.log('Listing directory contents for:', wTargetPath);

            // Make request to the list endpoint
            const wResponse = await this.webInterface.getJson(`/files/list`,wEncodedPath);
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
                return wResult;
            }

            console.log('No files found in directory');
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
        // Check if sPath is defined and is a string
        if (!sPath || typeof sPath !== 'string') {
            console.warn('cd: Invalid path provided:', sPath);
            return this.m_CurrentPath;
        }
        
        if (sPath === '..') {
            // Go up one directory
            const wParts = this.m_CurrentPath.split('/').filter(Boolean);
            wParts.pop();
            this.m_CurrentPath = '/' + wParts.join('/');
            if (this.m_CurrentPath === '') this.m_CurrentPath = '/';
        } else if (sPath.startsWith('/')) {
            // Absolute path
            this.m_CurrentPath = normalizeVirtualPath(sPath);
        } else {
            // Relative path
            this.m_CurrentPath = joinVirtualPath(this.m_CurrentPath, sPath);
        }
        return this.m_CurrentPath;
    }
   
        
    async chmod(sPath, sPermissions, options = {}) {
        try {
            let wTargetPath = sPath || this.m_CurrentPath;
            if (wTargetPath && !wTargetPath.startsWith('/')) {
                wTargetPath = joinVirtualPath(this.m_CurrentPath, wTargetPath);
            } else if (wTargetPath) {
                wTargetPath = normalizeVirtualPath(wTargetPath);
            }
            console.log('Changing permissions for:', wTargetPath, '=', sPermissions);

            // chmod by path — avoid GET /files, which streams GridFS binaries.
            const wChmodPayload = { path: wTargetPath, permissions: sPermissions };
            if (options?.sharedAccess !== undefined) {
                wChmodPayload.sharedAccess = options.sharedAccess;
            }
            const wResponse = await this.webInterface.postJson(
                '/files/chmod',
                JSON.stringify(wChmodPayload),
                'update',
            );
            const wData = (typeof wResponse === 'string') ? JSON.parse(wResponse) : wResponse;

            if (wData.message === 'success') {
                console.log(`Successfully changed permissions for: ${sPath}`);
                return true;
            }
            throw new Error(`Failed to change permissions for: ${sPath}, ${wData.error}`);
        } catch (error) {
            console.error('Error changing permissions:', error);
            console.error('Error details:', {
                message: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    // Remove a file or directory
    async rm(sPath) {
        try {
            // If path is not provided, use current path
            const wTargetPath = sPath || this.m_CurrentPath;
            const wQuery =  JSON.stringify({path: wTargetPath});
            console.log('Removing:', wTargetPath);

            // First check if the file/directory exists
            const wCheckResponse = await this.webInterface.deleteJson(`/files`,wQuery);
            const wCheckData = JSON.parse(wCheckResponse);

            if (wCheckData.message!=='success') {
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

    // Get the tree of the file system
    async tree() {
        const wResponse = await this.webInterface.getJson(`/files/tree`);
        console.log(wResponse);
        return JSON.parse(wResponse);
    }

    // Display tree structure recursively
    async displayTree(sPath = '', sIndent = '') {
        try {
            const wResponse = await this.webInterface.getJson(`/files/tree`);
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

            console.log('\nArborescence du système de fichiers :');
            console.log('===================================');
            wData.tree.forEach(node => displayNode(node, sIndent));
            console.log('===================================\n');

        } catch (error) {
            console.error('Erreur lors de l\'affichage de l\'arborescence:', error);
        }
    }

    // Download a file from MongoDB to disk
    async download(sPath, sDestinationPath = null) {
        try {
            const wTargetPath = sPath || this.m_CurrentPath;
            const wQuery = JSON.stringify({ path: wTargetPath });
            const wEncodedQuery = encodeURIComponent(wQuery);
            
            console.log('Downloading file:', wTargetPath);
            
            // Make the request to download the file
            const wResponse = await this.webInterface.getJson(`/files/download`, wEncodedQuery + (sDestinationPath ? `?path=${encodeURIComponent(sDestinationPath)}` : ''));
            const wData = JSON.parse(wResponse);
            
            if (wData.message === 'success') {
                console.log(`File downloaded successfully to: ${wData.path}`);
                return wData;
            } else {
                throw new Error(wData.error || 'Failed to download file');
            }
        } catch (error) {
            console.error('Error downloading file:', error);
            throw error;
        }
    }

    // Get MIME type for file extension
    getMimeType(sExtension) {
        const mimeTypes = {
            'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'xls': 'application/vnd.ms-excel',
            'pdf': 'application/pdf',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'doc': 'application/msword',
            'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'zip': 'application/zip',
            'tar': 'application/x-tar',
            'gz': 'application/gzip',
            'txt': 'text/plain',
            'html': 'text/html',
            'htm': 'text/html',
            'sker': 'application/x-sker',
            'json': 'application/json'
        };
        return mimeTypes[sExtension.toLowerCase()] || 'application/octet-stream';
    }

    // Load binary files with proper MIME type handling
    async loadBinaryFiles(sDirectory, sClient, sExtension) {
        try {
            await sClient.cd('/home/sallez@toto.fr/documents');
            
            const sFileNames = await fs.readdir(sDirectory);
            const mimeType = this.getMimeType(sExtension);
            
            for (const sFileName of sFileNames) {
                console.log('Processing file:', sFileName);
                const wFileName = path.parse(sFileName);
                
                if (wFileName.ext === "." + sExtension) {
                    try {
                        const filePath = path.join(sDirectory, sFileName);
                        const fileContent = await fs.readFile(filePath);
                        
                        // Get file stats for integrity check
                        const stats = await fs.stat(filePath);
                        const fileHash = crypto
                            .createHash('sha256')
                            .update(fileContent)
                            .digest('hex');
                        
                        const base64Content = fileContent.toString('base64');
                        const dataUrl = `data:${mimeType};base64,${base64Content}`;
                        
                        console.log(`Adding file ${wFileName.name + "." + sExtension}`);
                        await sClient.touch(wFileName.name + "." + sExtension, dataUrl, {
                            originalSize: stats.size,
                            hash: fileHash,
                            mimeType: mimeType
                        });
                    } catch (error) {
                        console.error(`Error processing file ${sFileName}:`, error);
                    }
                }
            }
        } catch (error) {
            console.error('Error in loadBinaryFiles:', error);
        }
    }


    // Verify file integrity after download
    async verifyFileIntegrity(sFilePath, sOriginalHash) {
        try {
            const fileContent = await fs.readFile(sFilePath);
            const currentHash = crypto
                .createHash('sha256')
                .update(fileContent)
                .digest('hex');
            
            const isIntegrityValid = currentHash === sOriginalHash;
            console.log(`File integrity check: ${isIntegrityValid ? 'PASSED' : 'FAILED'}`);
            return isIntegrityValid;
        } catch (error) {
            console.error('Error verifying file integrity:', error);
            return false;
        }
    }
}

// Display the content of a directory
async function show(sVirtualDiskClient,sPath) {
    console.log('Listing directory contents for:',sVirtualDiskClient.currentPath,sPath);
    await new Promise(resolve => setTimeout(resolve, 100));
    let contents = await sVirtualDiskClient.ls(sPath);
    //console.log(contentDirectory);
    for (const wFile of contents.files) {
        const wPermissions = sVirtualDiskClient.FormatUnixPermissions(wFile.permissions);
        console.log(`${wFile.type === 'directory' ? 'd' : '-'} ${wPermissions} ${wFile.owner} ${wFile.group} ${wFile.size} ${wFile.lastModified} ${wFile.name} ${wFile.path}`);
    }
    console.log('Nb Files:',contents.files.length);
}




export { SkVirtualDiskClient };