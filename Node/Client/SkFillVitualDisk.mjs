//=============================================================================
// SkVirtualDiskClient.mjs
// Example client for SkVirtualDisk that simulates Unix file system operations
// Author: Stéphane ALLEZ
//=============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SkVirtualDiskClient } from "./VirtualDisk/SkVirtualDiskClient.mjs";
import {
    HOME_SUBDIRS,
    HOME_ROOT_PERMISSIONS,
    HOME_DIR_PERMISSIONS,
    GLOBAL_SHARED_DIRS,
    globalSharedDirectoryPath,
    VAR_DIRECTORY_PATH,
    VAR_DIR_PERMISSIONS,
    userHomeDirectoryPath,
} from '../Server/SkVirtualDisk/SkUserHome.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export class SkFillVirtualDisk {
    constructor(webInterface) {
        this.m_WebInterface = webInterface;
        this.m_Client = new SkVirtualDiskClient(webInterface);
    }
    setOwner(sOwner) {
        this.m_Client.setOwner(sOwner);
    }
    setGroup(sGroup) {
        this.m_Client.setGroup(sGroup);
    }

    async ensureHomeRoot() {
        try {
            await this.m_Client.mkdir('/home', { permissions: HOME_ROOT_PERMISSIONS });
        } catch (error) {
            const message = String(error?.message || error);
            if (!message.toLowerCase().includes('exist')) {
                throw error;
            }
        }
        if (!(await this.m_Client.chmod('/home', HOME_ROOT_PERMISSIONS))) {
            throw new Error('Failed to set permissions on /home');
        }
    }

    /** Provision /template (read) and /share (write) at the virtual disk root. */
    async ensureGlobalSharedDirs() {
        for (const entry of GLOBAL_SHARED_DIRS) {
            const dirPath = globalSharedDirectoryPath(entry.name);
            try {
                await this.m_Client.mkdir(dirPath, { permissions: entry.permissions });
            } catch (error) {
                const message = String(error?.message || error);
                if (!message.toLowerCase().includes('exist')) {
                    throw error;
                }
            }
            if (!(await this.m_Client.chmod(dirPath, entry.permissions, {
                sharedAccess: entry.sharedAccess,
            }))) {
                throw new Error(`Failed to configure shared folder ${dirPath}`);
            }
        }
    }

    /** Provision /var at the virtual disk root. */
    async ensureVarDirectory() {
        try {
            await this.m_Client.mkdir(VAR_DIRECTORY_PATH, { permissions: VAR_DIR_PERMISSIONS });
        } catch (error) {
            const message = String(error?.message || error);
            if (!message.toLowerCase().includes('exist')) {
                throw error;
            }
        }
        if (!(await this.m_Client.chmod(VAR_DIRECTORY_PATH, VAR_DIR_PERMISSIONS))) {
            throw new Error(`Failed to set permissions on ${VAR_DIRECTORY_PATH}`);
        }
    }

    /** @param {string} sEmail — user email, e.g. sallez@toto.fr → /home/sallez@toto.fr */
    async fillVirtualDiskForUser(sEmail) {
        const wEmail = String(sEmail || '').trim().toLowerCase();
        if (!wEmail) {
            return;
        }
        const wHomePath = userHomeDirectoryPath(wEmail);
        await this.m_Client.cd('/home');
        await this.m_Client.mkdir(wEmail, { permissions: HOME_DIR_PERMISSIONS });
        if (!(await this.m_Client.chmod(wHomePath, HOME_DIR_PERMISSIONS))) {
            throw new Error(`Failed to set permissions on ${wHomePath}`);
        }
        await this.m_Client.cd(wHomePath);
        for (const wSubdir of HOME_SUBDIRS) {
            await this.m_Client.mkdir(wSubdir, { permissions: HOME_DIR_PERMISSIONS });
            if (!(await this.m_Client.chmod(`${wHomePath}/${wSubdir}`, HOME_DIR_PERMISSIONS))) {
                throw new Error(`Failed to set permissions on ${wHomePath}/${wSubdir}`);
            }
        }
    }

    async Fill() {
        await this.ensureHomeRoot();
        await this.ensureGlobalSharedDirs();
        await this.ensureVarDirectory();

        const wVarDirectory = path.join(__dirname, 'var');
        try {
            const wFiles = fs.readdirSync(wVarDirectory);
            await this.m_Client.cd(VAR_DIRECTORY_PATH);
            for (const wFile of wFiles) {
                const wFullPath = path.join(wVarDirectory, wFile);
                const wStats = fs.statSync(wFullPath);
                if (wStats.isFile()) {
                    let wContent = '';
                    try {
                        wContent = fs.readFileSync(wFullPath, 'utf8');
                    } catch (e) {
                        console.error('Failed to read file:', wFullPath, e.message);
                        continue;
                    }
                    if (!wContent || !wContent.trim()) {
                        console.warn('Skipping empty file:', wFullPath);
                        continue;
                    }
                    console.log('Copying file to /var:', wFile);
                    await this.m_Client.touch(wFile, wContent);
                    if (!(await this.m_Client.chmod(`${VAR_DIRECTORY_PATH}/${wFile}`, VAR_DIR_PERMISSIONS))) {
                        throw new Error(`Failed to set permissions on ${VAR_DIRECTORY_PATH}/${wFile}`);
                    }
                }
            }
        } catch (e) {
            console.error('Failed to copy files from var directory:', wVarDirectory, e.message);
        }
    }
}
