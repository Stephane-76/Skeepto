import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SkGridTreeView } from './component/SkGridTreeView';
import SkModal from './component/SkModal';
import SkInput from './component/SkInput';
import SkLoadingSpinner from './component/SkLoadingSpinner.js';
import { ReactComponent as SvgHtmlFile } from './svg/html-editor48.svg';
import { SkVirtualDiskClient } from './SkVirtualDiskClient';
import {
    setActiveFilePath,
    clearActiveFile,
    syncSpreadsheetSession,
    syncTextDocumentSession,
} from './SkActiveFile.js';
import { defaultVirtualDiskPathForSession, isAllowedVirtualDiskPathForUser, getGlobalSharedDirectoryPaths } from './virtualDiskHomePath';
import { showAlert, showConfirm, showError } from './skDialog.js';

const SK_EXCEL_WORKBOOK_EXTENSIONS = new Set(['xlsx', 'xls', 'xlsm', 'xlsb']);

const VD_FILE_PERMISSION_PRESET_DEFS = [
    { id: 'private', value: 600, label: 'Private' },
    { id: 'team-edit', value: 660, label: 'Team edit' },
    { id: 'collaborative', value: 770, label: 'Collaborative', default: true },
    { id: 'read-only-others', value: 640, label: 'Read-only sharing' },
    { id: 'public-read', value: 644, label: 'Public (read)' },
    { id: 'public-write', value: 666, label: 'Public (edit)' },
];

const VD_DIR_PERMISSION_PRESET_DEFS = [
    { id: 'private', value: 700, label: 'Private' },
    { id: 'team-edit', value: 770, label: 'Team edit' },
    { id: 'collaborative', value: 770, label: 'Collaborative', default: true },
    { id: 'read-only-others', value: 750, label: 'Read-only sharing' },
    { id: 'public-read', value: 755, label: 'Public (read)' },
    { id: 'public-write', value: 777, label: 'Public (edit)' },
];

function buildPermissionPresetDescription(presetId, isDirectory, groupCode) {
    const groupLabel = groupCode || 'your group';
    switch (presetId) {
        case 'private':
            return isDirectory
                ? 'Only you (the owner) can open and manage this folder.'
                : 'Only you (the owner) can read and edit.';
        case 'team-edit':
            return isDirectory
                ? `Members of group "${groupLabel}" can change files; everyone else is blocked.`
                : `Members of group "${groupLabel}" can edit; everyone else is blocked.`;
        case 'collaborative':
            return isDirectory
                ? `Members of group "${groupLabel}" have full access; everyone else is blocked.`
                : `Members of group "${groupLabel}" have full access; everyone else is blocked.`;
        case 'read-only-others':
            return isDirectory
                ? `You manage the folder; members of group "${groupLabel}" can browse only.`
                : `You can edit; members of group "${groupLabel}" can view only.`;
        case 'public-read':
            return isDirectory
                ? 'All signed-in users can open and list this folder; only you can create or delete items.'
                : 'All signed-in users can read this file; only you can modify it.';
        case 'public-write':
            return isDirectory
                ? 'All signed-in users can read, create, and change files in this folder.'
                : 'All signed-in users can read and edit this file.';
        default:
            return '';
    }
}

export class SkVirtualDisk extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            selectedRow: null,
            data: [],
            expandedNodes: new Set(), // Add expandedNodes to state
            createFolderModalOpen: false,
            createSpreadsheetModalOpen: false,
            createDocumentModalOpen: false,
            renameModalOpen: false,
            modalRenameName: '',
            modalFolderName: 'New folder',
            modalSpreadsheetName: 'Untitled.sker',
            modalDocumentName: 'Untitled.html',
            modalSpreadsheetPermissionPreset: 'collaborative',
            modalDocumentPermissionPreset: 'collaborative',
            modalFolderPermissionPreset: 'collaborative',
            chmodModalOpen: false,
            chmodPermissionPreset: 'collaborative',
            chmodTargetPath: null,
            chmodTargetIsDirectory: false,
            chmodSharedAccess: 'off',
            vdModalBusy: false,
            historyModalOpen: false,
            historyVersions: [],
            historyLoading: false,
            historyBusy: false,
            historyError: null,
            historyMaxVersions: 50,
            selectedHistoryVersionId: null,
            historyTargetPath: null,
            snapshotModalOpen: false,
            snapshotLabel: '',
            snapshotComment: '',
            snapshotBusy: false,
            snapshotError: null,
            snapshotTargetPath: null,
            documentLockNoticeOpen: false,
            documentLockNoticeLockedBy: '',
            documentLockNoticeFileName: '',
            documentLockNoticePending: null,
            actionsMenuOpen: false,
            /** Shown immediately on double-click while a file is opening. */
            openingFile: null,
            /** Shown while Excel → .sker conversion runs on the server. */
            convertingExcel: null,
            exportingSker: null,
        };

        // Check if there's a saved selection to initialize the client with
        const savedSelection = sessionStorage.getItem('SkVirtualDiskSelection');
        let initialPath = null;
        const sessionEmail = sessionStorage.getItem('email') || '';
        if (savedSelection) {
            try {
                const selectionData = JSON.parse(savedSelection);
                const savedPath = selectionData.path;
                if (
                    !savedPath ||
                    this.isCurrentUserAdmin() ||
                    isAllowedVirtualDiskPathForUser(savedPath, sessionEmail, this.isCurrentUserAdmin())
                ) {
                    initialPath = savedPath;
                }
            } catch (error) {
                console.error('Error parsing saved selection:', error);
            }
        } else {
            const defaultPath = defaultVirtualDiskPathForSession();
            if (defaultPath && defaultPath !== '/') {
                initialPath = defaultPath;
            }
        }

        // Initialize the client with the selected file path if available
        this.client = new SkVirtualDiskClient(initialPath);

        // Add gridRef for the SkGridTreeView component
        this.gridRef = React.createRef();

        this.m_data = {
            columns: [
                { header: 'Name', field: 'name', width: '300px' },
                { header: 'Size', field: 'sizeStr', width: '100px', align: 'right' },
                { header: 'Owner', field: 'owner', width: '150px' },
                { header: 'Group', field: 'group', width: '100px' },
                { header: 'Permissions', field: 'permissions', width: '100px' },
                { header: 'Created', field: 'createdAt', width: '150px' },
                { header: 'Updated', field: 'updatedAt', width: '150px' }
            ],
            data: []
        };

        // File type icons definition
        this.fileIcons = {
            // Directories
            directory: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 4H8L6 2H2C1.44772 2 1 2.44772 1 3V13C1 13.5523 1.44772 14 2 14H14C14.5523 14 15 13.5523 15 13V5C15 4.44772 14.5523 4 14 4Z" fill="#FFD700"/>
                </svg>
            ),
            // Excel files
            excel: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 1H2C1.44772 1 1 1.44772 1 2V14C1 14.5523 1.44772 15 2 15H14C14.5523 15 15 14.5523 15 14V2C15 1.44772 14.5523 1 14 1Z" fill="#217346" stroke="#000000"/>
                    <path d="M4 4H12M4 7H12M4 10H12" stroke="#FFFFFF" strokeWidth="1.5"/>
                    <path d="M4 4L7 7L4 10" stroke="#FFFFFF" strokeWidth="1.5"/>
                    <path d="M12 4L9 7L12 10" stroke="#FFFFFF" strokeWidth="1.5"/>
                </svg>
            ),
            // SKER files
            sker: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="14" height="14" rx="2" fill="#6C5CE7" stroke="#000000"/>
                    <path d="M4 5H12" stroke="#FFFFFF" strokeWidth="1.5"/>
                    <path d="M4 8H12" stroke="#FFFFFF" strokeWidth="1.5"/>
                    <path d="M4 11H9" stroke="#FFFFFF" strokeWidth="1.5"/>
                    <text x="8" y="10" textAnchor="middle" fontSize="5" fill="#FFFFFF" fontFamily="Verdana">SK</text>
                </svg>
            ),
            // Text files
            text: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 1H2C1.44772 1 1 1.44772 1 2V14C1 14.5523 1.44772 15 2 15H14C14.5523 15 15 14.5523 15 14V2C15 1.44772 14.5523 1 14 1Z" fill="#FFFFFF" stroke="#000000"/>
                    <path d="M4 4H12M4 7H12M4 10H8" stroke="#000000" strokeWidth="1.5"/>
                </svg>
            ),
            // HTML files
            html: (
                <SvgHtmlFile width="18" height="18" className="SkVirtualDisk-fileIcon--html" aria-hidden="true" />
            ),
            // Image files
            image: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 1H2C1.44772 1 1 1.44772 1 2V14C1 14.5523 1.44772 15 2 15H14C14.5523 15 15 14.5523 15 14V2C15 1.44772 14.5523 1 14 1Z" fill="#FFFFFF" stroke="#000000"/>
                    <path d="M5 6C5.55228 6 6 5.55228 6 5C6 4.44772 5.55228 4 5 4C4.44772 4 4 4.44772 4 5C4 5.55228 4.44772 6 5 6Z" fill="#000000"/>
                    <path d="M1 11L5 7L8 10L11 7L15 11" stroke="#000000" strokeWidth="1.5"/>
                </svg>
            ),
            // Executable files
            executable: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 1H2C1.44772 1 1 1.44772 1 2V14C1 14.5523 1.44772 15 2 15H14C14.5523 15 15 14.5523 15 14V2C15 1.44772 14.5523 1 14 1Z" fill="#FFFFFF" stroke="#000000"/>
                    <path d="M6 4L10 8L6 12" stroke="#000000" strokeWidth="1.5"/>
                </svg>
            ),
            // Archive files
            archive: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 1H2C1.44772 1 1 1.44772 1 2V14C1 14.5523 1.44772 15 2 15H14C14.5523 15 15 14.5523 15 14V2C15 1.44772 14.5523 1 14 1Z" fill="#FFFFFF" stroke="#000000"/>
                    <path d="M4 4H12M4 7H12M4 10H12" stroke="#000000" strokeWidth="1.5"/>
                </svg>
            ),
            // Default files
            default: (
                <svg width="18" height="18" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M14 1H2C1.44772 1 1 1.44772 1 2V14C1 14.5523 1.44772 15 2 15H14C14.5523 15 15 14.5523 15 14V2C15 1.44772 14.5523 1 14 1Z" fill="#FFFFFF" stroke="#000000"/>
                </svg>
            )
        };
    }

    getFileIcon = (item) => {
        if (item.isDirectory) {
            return this.fileIcons.directory;
        }

        const extension = item.name.split('.').pop().toLowerCase();
        
        // Determine the file type from its extension
        if (["sker"].includes(extension)) {
            return this.fileIcons.sker;
        } else if (['xlsx', 'xls', 'xlsm', 'xlsb'].includes(extension)) {
            return this.fileIcons.excel;
        } else if (['txt', 'md', 'log', 'conf'].includes(extension)) {
            return this.fileIcons.text;
        } else if (['html', 'htm'].includes(extension)) {
            return this.fileIcons.html;
        } else if (['jpg', 'jpeg', 'png', 'gif', 'svg'].includes(extension)) {
            return this.fileIcons.image;
        } else if (['sh', 'exe', 'bat'].includes(extension)) {
            return this.fileIcons.executable;
        } else if (['zip', 'tar', 'gz', 'rar', '7z'].includes(extension)) {
            return this.fileIcons.archive;
        }
        
        return this.fileIcons.default;
    }

    // Utility function to format file size
    formatFileSize = (bytes) => {
        if (bytes === 0) return '';
        
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    formatPermissions = (permissions) => {
        return this.client.FormatUnixPermissions(permissions)
    }

    getCurrentUserGroup = () => String(sessionStorage.getItem('group') || '').trim();

    isCurrentUserAdmin = () => {
        const group = this.getCurrentUserGroup().toLowerCase();
        return group === 'admin' || group === 'admins';
    };

    getPermissionPresets = (isDirectory = false) => {
        const defs = isDirectory ? VD_DIR_PERMISSION_PRESET_DEFS : VD_FILE_PERMISSION_PRESET_DEFS;
        const groupCode = this.getCurrentUserGroup();
        return defs.map((preset) => ({
            ...preset,
            description: buildPermissionPresetDescription(preset.id, isDirectory, groupCode),
        }));
    };

    getDefaultPermissionPresetId = (isDirectory = false) => {
        const presets = this.getPermissionPresets(isDirectory);
        return presets.find((preset) => preset.default)?.id || presets[0].id;
    };

    getPermissionValueFromPreset = (presetId, isDirectory = false) => {
        const presets = this.getPermissionPresets(isDirectory);
        const preset = presets.find((item) => item.id === presetId);
        return preset?.value ?? presets.find((item) => item.default)?.value ?? presets[0].value;
    };

    guessPermissionPresetId = (permissionsValue, isDirectory = false) => {
        const numeric = Number(permissionsValue);
        if (!Number.isFinite(numeric)) {
            return this.getDefaultPermissionPresetId(isDirectory);
        }
        const presets = this.getPermissionPresets(isDirectory);
        const exact = presets.find((preset) => preset.value === numeric);
        if (exact) return exact.id;
        // Legacy values from older defaults (non-exact modes)
        if (!isDirectory && (numeric === 664 || numeric === 775)) {
            return 'collaborative';
        }
        if (!isDirectory && numeric === 640) {
            return 'read-only-others';
        }
        if (isDirectory && numeric === 775) {
            return 'collaborative';
        }
        return this.getDefaultPermissionPresetId(isDirectory);
    };

    onSpreadsheetPermissionPresetChange = (presetId) => {
        this.setState({ modalSpreadsheetPermissionPreset: presetId });
    };

    onDocumentPermissionPresetChange = (presetId) => {
        this.setState({ modalDocumentPermissionPreset: presetId });
    };

    onFolderPermissionPresetChange = (presetId) => {
        this.setState({ modalFolderPermissionPreset: presetId });
    };

    onChmodPermissionPresetChange = (presetId) => {
        this.setState({ chmodPermissionPreset: presetId });
    };

    onChmodSharedAccessChange = (sharedAccess) => {
        this.setState({ chmodSharedAccess: sharedAccess });
    };

    renderAdminSharedAreaField = (fieldId, selectedAccess, onChange) => (
        <fieldset style={{ border: 'none', margin: '16px 0 0', padding: 0 }}>
            <legend style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                Shared area (all signed-in users)
            </legend>
            <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#555' }}>
                Only administrators can declare a folder as a shared area. Applies to this folder
                and everything inside it.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {[
                    { id: 'off', label: 'Off', desc: 'Normal private or group permissions only.' },
                    {
                        id: 'read',
                        label: 'Shared — read only',
                        desc: 'Everyone can browse and read; only the owner edits ACLs via owner rights.',
                    },
                    {
                        id: 'write',
                        label: 'Shared — read and edit',
                        desc: 'Everyone can read and modify files in this tree.',
                    },
                ].map((opt) => (
                    <label
                        key={opt.id}
                        htmlFor={`${fieldId}-${opt.id}`}
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                            padding: '8px 10px',
                            border: '1px solid var(--sk-border, #ddd)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            background:
                                selectedAccess === opt.id
                                    ? 'var(--sk-selection-bg, #e8f5e9)'
                                    : 'transparent',
                        }}
                    >
                        <input
                            id={`${fieldId}-${opt.id}`}
                            type="radio"
                            name={fieldId}
                            value={opt.id}
                            checked={selectedAccess === opt.id}
                            onChange={() => onChange(opt.id)}
                            style={{ marginTop: '3px' }}
                        />
                        <span>
                            <strong style={{ display: 'block' }}>{opt.label}</strong>
                            <span style={{ fontSize: '12px', color: '#666' }}>{opt.desc}</span>
                        </span>
                    </label>
                ))}
            </div>
        </fieldset>
    );

    renderPermissionPresetField = (fieldId, selectedPresetId, onChange, isDirectory = false) => {
        const presets = this.getPermissionPresets(isDirectory);
        const groupCode = this.getCurrentUserGroup();
        const isAdmin = this.isCurrentUserAdmin();
        return (
            <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
                <legend style={{ display: 'block', marginBottom: '8px', fontSize: '14px' }}>
                    Access
                </legend>
                {isAdmin ? (
                    <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#1565c0' }}>
                        You belong to the admin group and can access and manage all files,
                        regardless of the settings below.
                    </p>
                ) : groupCode ? (
                    <p style={{ margin: '0 0 10px', fontSize: '13px', color: '#555' }}>
                        New items are assigned to group <strong>{groupCode}</strong>.
                        Group permissions apply to dedicated groups only.
                    </p>
                ) : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {presets.map((preset) => (
                        <label
                            key={preset.id}
                            htmlFor={`${fieldId}-${preset.id}`}
                            style={{
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: '8px',
                                padding: '8px 10px',
                                border: '1px solid var(--sk-border, #ddd)',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                background:
                                    selectedPresetId === preset.id
                                        ? 'var(--sk-selection-bg, #e3f2fd)'
                                        : 'transparent',
                            }}
                        >
                            <input
                                id={`${fieldId}-${preset.id}`}
                                type="radio"
                                name={fieldId}
                                value={preset.id}
                                checked={selectedPresetId === preset.id}
                                onChange={() => onChange(preset.id)}
                                style={{ marginTop: '3px' }}
                            />
                            <span>
                                <strong style={{ display: 'block' }}>{preset.label}</strong>
                                <span style={{ fontSize: '13px', color: '#555' }}>
                                    {preset.description}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>
        );
    };

    formatDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleString('fr-FR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    // Utility function to clean and normalize file paths
    cleanPath = (path) => {
        if (!path || typeof path !== 'string') return path;
        
        let cleaned = path;
        
        // Remove leading %20 (encoded spaces) before decoding
        cleaned = cleaned.replace(/^%20+/, '');
        
        // Try to decode URL-encoded characters (e.g., %20 -> space)
        try {
            cleaned = decodeURIComponent(cleaned);
        } catch {
            // If decoding fails, keep cleaned as already normalized above
        }
        
        // Remove leading spaces (after decoding)
        cleaned = cleaned.replace(/^\s+/, '');
        
        // Remove trailing spaces
        cleaned = cleaned.replace(/\s+$/, '');
        
        return cleaned;
    }

    processTreeData = (data) => {
        return data.map(item => {
            // Clean the path to remove URL encoding issues
            const cleanedPath = this.cleanPath(item.path);
            
            return {
                ...item,
                path: cleanedPath,
                id: cleanedPath,
                sizeStr: this.formatFileSize(item.size),
                permissions: this.formatPermissions(item.permissions),
                permissionsValue: item.permissions,
                sharedAccess: item.sharedAccess || null,
                createdAt: this.formatDate(item.createdAt),
                updatedAt: this.formatDate(item.updatedAt),
                icon: this.getFileIcon(item),
                children: item.children ? this.processTreeData(item.children) : []
            };
        });
    }

    // Helper method to find file and determine which parent directories need to be expanded
    findFileAndExpandParents = (items, targetPath, level = 0, parentId = null) => {
        const expandedNodes = new Set();
        for (const item of items) {
            if (item.path === targetPath) {
                return { foundFile: item, expandedNodes };
            }
            if (item.children && item.children.length > 0) {
                const result = this.findFileAndExpandParents(item.children, targetPath, level + 1, item.id);
                if (result.foundFile) {
                    // Add current directory to expanded set so that all ancestors are opened
                    result.expandedNodes.add(item.id);
                    return result;
                }
            }
        }
        return { foundFile: null, expandedNodes };
    }

    // Expose a global helper used by the guided tour to demo opening a file.
    // Options:
    //   selectDelay   ms to wait before selecting the row (counted from call)
    //   openDelay     ms to wait before double-clicking. Pass null to skip.
    //   skipSelect    if true, the row is assumed already selected (no select / no scroll).
    // Scroll the row matching `path` into the viewport. Used both by the
    // guided tour and by the auto-restore of the last selection on mount.
    scrollRowIntoView = (path, options = {}) => {
        try {
            const { behavior = 'smooth', block = 'center', inline = 'nearest' } = options;
            const escaped = (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(path) : path;
            const el = document.querySelector(`[data-path="${escaped}"]`);
            if (el && typeof el.scrollIntoView === 'function') {
                el.scrollIntoView({ behavior, block, inline });
            }
        } catch (e) {
            // Best-effort scroll; never block the caller.
        }
    };

    installTourHelper = () => {
        window.__skerVirtualDiskOpenActionsMenu = () => {
            this.openActionsMenu();
        };
        window.__skerVirtualDiskCloseActionsMenu = () => {
            this.closeActionsMenu();
        };
        window.__skerVirtualDiskResolveTourPath = (hint) => {
            const row = this.findTourSkerRow(hint);
            return row ? this.cleanPath(row.path) : null;
        };
        window.__skerVirtualDiskOpen = (targetPath, options = {}) => {
            const { selectDelay = 0, openDelay = 800, skipSelect = false } = options;

            const tryOnce = () => {
                const row = this.findTourSkerRow(targetPath);
                if (!row) return false;
                setTimeout(() => {
                    const openRow = async () => {
                        if (!skipSelect) {
                            await this.selectTreeRow(row, { scroll: true });
                        }
                        if (openDelay !== null) {
                            const ext = (row.name || '').split('.').pop().toLowerCase();
                            const opener = (ext === 'html' || ext === 'htm')
                                ? this.openTextDocumentFile.bind(this)
                                : this.openSpreadsheetFile.bind(this);
                            try {
                                await opener(row);
                            } catch (err) {
                                console.error(err);
                                await showError(
                                    err?.message || 'You do not have permission to open this file.'
                                );
                            }
                        }
                    };
                    void openRow();
                }, selectDelay);
                return true;
            };

            // Tree may not be loaded yet; poll briefly (up to ~3s).
            if (tryOnce()) return;
            let attempts = 0;
            const id = setInterval(() => {
                attempts += 1;
                if (tryOnce() || attempts >= 30) clearInterval(id);
            }, 100);
        };
    };

    // Resolve a guided-tour file hint to a tree row. Accepts a full virtual path,
    // a basename (e.g. Budget.sker), or falls back to the first .sker workbook.
    findTourSkerRow = (hint) => {
        const data = this.m_data && this.m_data.data;
        if (!Array.isArray(data) || !hint) return null;

        const normalizedHint = this.cleanPath(hint);
        const basename = normalizedHint.split('/').filter(Boolean).pop() || '';
        const lowerBase = basename.toLowerCase();

        const walk = (items, visit) => {
            if (!Array.isArray(items)) return null;
            for (const item of items) {
                const hit = visit(item);
                if (hit) return hit;
                if (item && item.children) {
                    const childHit = walk(item.children, visit);
                    if (childHit) return childHit;
                }
            }
            return null;
        };

        let row = walk(data, (item) => (
            item && item.path === normalizedHint ? item : null
        ));
        if (row) return row;

        // Prefer a match on the full (multi-segment) hint so a directory-qualified
        // hint like "/share/Budget.sker" resolves to that exact file rather than the
        // first "Budget.sker" found anywhere. Compare ignoring a leading slash so the
        // hint format (with or without leading "/") does not matter.
        const relHint = normalizedHint.replace(/^\/+/, '');
        if (relHint.includes('/')) {
            row = walk(data, (item) => {
                if (!item || item.isDirectory || !item.path) return null;
                const relPath = this.cleanPath(item.path).replace(/^\/+/, '');
                if (relPath === relHint || relPath.endsWith(`/${relHint}`)) {
                    return item;
                }
                return null;
            });
            if (row) return row;
        }

        row = walk(data, (item) => {
            if (!item || item.isDirectory || !item.path) return null;
            const path = this.cleanPath(item.path);
            if (path === normalizedHint || (basename && path.endsWith(`/${basename}`))) {
                return item;
            }
            return null;
        });
        if (row) return row;

        row = walk(data, (item) => {
            if (!item || item.isDirectory || !item.name) return null;
            if (lowerBase && item.name.toLowerCase() === lowerBase) return item;
            return null;
        });
        if (row) return row;

        return walk(data, (item) => {
            if (!item || item.isDirectory || !item.name) return null;
            return item.name.toLowerCase().endsWith('.sker') ? item : null;
        });
    };

    /** Select a tree row: expand ancestors, sync grid, scroll into view, persist session. */
    selectTreeRow = async (row, options = {}) => {
        const {
            scroll = true,
            persist = true,
            expandIfDirectory = false,
            syncExpanded = true,
            treeData = null,
        } = options;
        if (!row || !row.path) return null;

        const cleanedPath = this.cleanPath(row.path);
        const normalizedRow = { ...row, path: cleanedPath };
        const processedData = treeData || this.m_data.data || [];
        if (treeData) {
            this.m_data.data = treeData;
        }
        const { foundFile, expandedNodes } = this.findFileAndExpandParents(processedData, cleanedPath);
        const found = foundFile || normalizedRow;

        const stateUpdate = { selectedRow: found };
        if (treeData) {
            stateUpdate.data = treeData;
        }
        let mergedExpanded = null;
        if (syncExpanded) {
            mergedExpanded = new Set([...(this.state.expandedNodes || []), ...expandedNodes]);
            if (expandIfDirectory && found.isDirectory && found.id) {
                mergedExpanded.add(found.id);
            }
            stateUpdate.expandedNodes = mergedExpanded;
        }

        await new Promise((resolve) => {
            this.setState(stateUpdate, async () => {
                if (syncExpanded && this.gridRef.current && mergedExpanded?.size > 0) {
                    await this.gridRef.current.updateExpandedNodesAsync(mergedExpanded);
                    this.gridRef.current.selectRowByPath(found.path);
                } else if (this.gridRef.current) {
                    this.gridRef.current.selectRowByPath(found.path);
                }
                if (scroll) {
                    setTimeout(() => this.scrollRowIntoView(found.path), 80);
                }
                resolve();
            });
        });

        if (persist) {
            try {
                sessionStorage.setItem(
                    'SkVirtualDiskSelection',
                    JSON.stringify({ path: cleanedPath, timestamp: Date.now() })
                );
            } catch (e) {
                console.warn('Unable to persist selection:', e);
            }
        }

        if (found.isDirectory) {
            await this.client.cd(found.path);
        } else {
            const parentPath = found.path.substring(0, found.path.lastIndexOf('/')) || '/';
            await this.client.cd(parentPath);
        }

        setActiveFilePath(cleanedPath, {
            name: found.name,
            isDirectory: Boolean(found.isDirectory),
            source: 'virtualdisk',
        });

        return found;
    };

    async componentDidMount() {
        this.installTourHelper();
        const savedSelection = sessionStorage.getItem('SkVirtualDiskSelection');
        // Without a saved selection, do not restore a stale scroll position from a prior visit.
        if (!savedSelection) {
            try {
                sessionStorage.removeItem('SkGridTreeViewTopPath');
            } catch {}
            if (this.gridRef.current?.clearPendingScrollRestore) {
                this.gridRef.current.clearPendingScrollRestore();
            }
        }
        try {
            const result = await this.client.tree();
            if (result.message === "success") {
                const processedData = this.processTreeData(result.tree);
                this.m_data.data = processedData;
                
                // Check if we have a saved selection in sessionStorage
                if (savedSelection) {
                    try {
                        const selectionData = JSON.parse(savedSelection);
                        const { path } = selectionData;
                        const sessionEmail = sessionStorage.getItem('email') || '';

                        if (
                            path &&
                            !this.isCurrentUserAdmin() &&
                            !isAllowedVirtualDiskPathForUser(path, sessionEmail, false)
                        ) {
                            sessionStorage.removeItem('SkVirtualDiskSelection');
                            const homePath = defaultVirtualDiskPathForSession();
                            await this.client.cd(homePath);
                            this.setState({ data: processedData, selectedRow: null });
                        } else {
                        // No expiration: as long as the selection is in
                        // sessionStorage we want to restore it whenever the
                        // user re-activates the Virtual Disk view.
                        const { foundFile, expandedNodes } = this.findFileAndExpandParents(processedData, path);

                        if (foundFile) {
                            // Merge with previously saved expanded nodes from session if any
                            let savedExpanded = null;
                            try {
                                const raw = sessionStorage.getItem('SkVirtualDiskExpanded');
                                if (raw) {
                                    const arr = JSON.parse(raw);
                                    if (Array.isArray(arr)) savedExpanded = new Set(arr);
                                }
                            } catch {}
                            const merged = new Set([...(savedExpanded || []), ...expandedNodes]);
                            this.setState({
                                data: processedData,
                                selectedRow: foundFile,
                                expandedNodes: merged
                            }, () => {
                                // Wait for the grid to render the row, then bring
                                // it into view so the user lands exactly where
                                // they were last time.
                                setTimeout(() => this.scrollRowIntoView(foundFile.path), 80);
                            });

                            // Update client's current path to the selected file's directory
                            //console.log('Restoring selection with path:', foundFile.path);
                            if (foundFile.isDirectory) {
                                await this.client.cd(foundFile.path);
                            } else {
                                const parentPath = foundFile.path.substring(0, foundFile.path.lastIndexOf('/')) || '/';
                                //console.log('File restored, parent path:', parentPath);
                                await this.client.cd(parentPath);
                            }

                            //console.log('Restored selection:', foundFile.path);
                            //console.log('Client current path updated to:', this.client.m_CurrentPath);
                            setActiveFilePath(foundFile.path, {
                                name: foundFile.name,
                                isDirectory: Boolean(foundFile.isDirectory),
                                source: 'virtualdisk',
                            });
                        } else {
                            // The previously selected file no longer exists in
                            // the tree; just render the data without selection.
                            this.setState({ data: processedData });
                        }

                        // Do not clear the saved selection; keep it for future visits in this session
                        }
                    } catch (error) {
                        console.error('Error parsing saved selection:', error);
                        sessionStorage.removeItem('SkVirtualDiskSelection');
                    }
                } else {
                    // If we have a selected file, try to locate it in the fresh data
                    if (this.state.selectedRow) {
                        const { foundFile, expandedNodes } = this.findFileAndExpandParents(
                            processedData,
                            this.cleanPath(this.state.selectedRow.path)
                        );
                        if (foundFile) {
                            const mergedExpanded = new Set([
                                ...(this.state.expandedNodes || []),
                                ...expandedNodes,
                            ]);
                            this.setState({
                                data: processedData,
                                selectedRow: foundFile,
                                expandedNodes: mergedExpanded,
                            }, () => {
                                if (this.gridRef.current && mergedExpanded.size > 0) {
                                    this.gridRef.current.updateExpandedNodes(mergedExpanded);
                                }
                                setTimeout(() => this.scrollRowIntoView(foundFile.path), 80);
                            });
                        } else {
                            this.setState({ data: processedData, selectedRow: null });
                            clearActiveFile();
                        }
                    } else {
                        const homePath = defaultVirtualDiskPathForSession();
                        if (homePath && homePath !== '/') {
                            await this.client.cd(homePath);
                            if (!this.isCurrentUserAdmin()) {
                                const sharedRoots = getGlobalSharedDirectoryPaths();
                                const expandedNodes = new Set(
                                    processedData
                                        .filter((item) =>
                                            sharedRoots.includes(item.path) ||
                                            item.path === this.cleanPath(homePath)
                                        )
                                        .map((item) => item.path)
                                );
                                this.setState({
                                    data: processedData,
                                    selectedRow: null,
                                    expandedNodes,
                                });
                            } else {
                                const { foundFile, expandedNodes } = this.findFileAndExpandParents(
                                    processedData,
                                    this.cleanPath(homePath)
                                );
                                if (foundFile) {
                                    const merged = new Set(expandedNodes);
                                    this.setState({
                                        data: processedData,
                                        selectedRow: foundFile,
                                        expandedNodes: merged,
                                    }, async () => {
                                        setTimeout(() => this.scrollRowIntoView(foundFile.path), 80);
                                        await this.selectTreeRow(foundFile, {
                                            expandIfDirectory: true,
                                            persist: true,
                                        });
                                    });
                                } else {
                                    this.setState({ data: processedData });
                                }
                            }
                        } else {
                            // No prior selection: restore expanded nodes from session if any
                            let savedExpanded = null;
                            try {
                                const raw = sessionStorage.getItem('SkVirtualDiskExpanded');
                                if (raw) {
                                    const arr = JSON.parse(raw);
                                    if (Array.isArray(arr)) savedExpanded = new Set(arr);
                                }
                            } catch {}
                            if (savedExpanded) {
                                this.setState({ data: processedData, expandedNodes: savedExpanded });
                            } else {
                                this.setState({ data: processedData });
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error loading file tree:', error);
        }
    }

    componentDidUpdate(prevProps, prevState) {
        // If we have expandedNodes in state and the grid is mounted, update it
        if (this.gridRef &&
            this.gridRef.current &&
            prevState.expandedNodes !== this.state.expandedNodes) {
            this.gridRef.current.updateExpandedNodes(this.state.expandedNodes);
            // Persist expanded nodes set in session
            try {
                sessionStorage.setItem('SkVirtualDiskExpanded', JSON.stringify(Array.from(this.state.expandedNodes)));
            } catch {}
        }
    }

    // Helper method to find file and determine which parent directories need to be expanded
    handleRowSelect = async (row, options = {}) => {
        await this.selectTreeRow(row, options);
    }

    handleDelete = async () => {
        if (!this.state.selectedRow) {
            await showAlert({ message: 'Please select a file to delete' });
            return;
        }

        const confirmed = await showConfirm({
            title: 'Delete',
            message: `Are you sure you want to delete ${this.state.selectedRow.path}?`,
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!confirmed) {
            return;
        }

        try {
            const success = await this.client.rm(this.state.selectedRow.path);
            if (success) {
                    // Get parent directory path
                    const parentPath = this.state.selectedRow.path.substring(0, this.state.selectedRow.path.lastIndexOf('/'));
                    
                    // Refresh file list
                    const result = await this.client.tree();
                    if (result.message === "success") {
                        const processedData = this.processTreeData(result.tree);
                        this.m_data.data = processedData;
                        
                        // Find parent directory in the new data
                        const findParentInTree = (items) => {
                            for (const item of items) {
                                if (item.path === parentPath) {
                                    return item;
                                }
                                if (item.children) {
                                    const found = findParentInTree(item.children);
                                    if (found) return found;
                                }
                            }
                            return null;
                        };
                        
                        const parentDir = findParentInTree(processedData);
                        this.setState({ 
                            data: processedData,
                            selectedRow: parentDir || null
                        });
                    }
            } else {
                await showError('Error while deleting the file');
            }
        } catch (error) {
            console.error(error);
            await showError('Error while deleting the file');
        }
    }

    openRenameModal = () => {
        if (!this.state.selectedRow) {
            showAlert({ message: 'Please select a file or folder to rename' });
            return;
        }
        this.setState({
            renameModalOpen: true,
            modalRenameName: this.state.selectedRow.name || '',
            vdModalBusy: false,
        });
    };

    closeRenameModal = () => {
        if (this.state.vdModalBusy) return;
        this.setState({ renameModalOpen: false });
    };

    onModalRenameNameChange = (e) => {
        this.setState({ modalRenameName: e.target.value });
    };

    confirmRename = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const row = this.state.selectedRow;
        if (!row || !row.path) {
            this.setState({ renameModalOpen: false });
            return;
        }
        const newName = String(this.state.modalRenameName || '').trim();
        if (!newName) {
            await showAlert({ message: 'Please enter a name.' });
            return;
        }
        if (newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
            await showAlert({ message: 'Please enter a name without path separators.' });
            return;
        }
        if (newName === row.name) {
            this.setState({ renameModalOpen: false });
            return;
        }
        this.setState({ vdModalBusy: true });
        try {
            const oldPath = this.cleanPath(row.path);
            const parentPath = oldPath.substring(0, oldPath.lastIndexOf('/'));
            const newPath = parentPath === '' ? `/${newName}` : `${parentPath}/${newName}`;
            await this.client.rename(oldPath, newName);
            await this.applyTreeResult(newPath);
            this.setState({ renameModalOpen: false, vdModalBusy: false });
        } catch (err) {
            console.error(err);
            await showError(err?.message || 'Could not rename the item.');
            this.setState({ vdModalBusy: false });
        }
    };

    /** Parent directory for creates: selected folder, or parent of selected file, or root. */
    getVirtualDiskParentPath = () => {
        const row = this.state.selectedRow;
        if (!row || !row.path) return '/';
        const path = this.cleanPath(row.path);
        if (row.isDirectory) return path;
        const slash = path.lastIndexOf('/');
        return slash <= 0 ? '/' : path.substring(0, slash);
    };

    findItemByPath = (items, targetPath) => {
        if (!Array.isArray(items) || !targetPath) return null;
        for (const item of items) {
            if (item.path === targetPath) return item;
            if (item.children) {
                const nested = this.findItemByPath(item.children, targetPath);
                if (nested) return nested;
            }
        }
        return null;
    };

    /** Reload tree from server and optionally select `preferredPath`. */
    applyTreeResult = async (preferredPath) => {
        const result = await this.client.tree();
        if (result.message !== 'success') return null;
        const processedData = this.processTreeData(result.tree);
        this.m_data.data = processedData;

        if (!preferredPath) {
            this.setState({ data: processedData });
            return null;
        }

        const cleanedPath = this.cleanPath(preferredPath);
        const { foundFile } = this.findFileAndExpandParents(processedData, cleanedPath);
        const found = foundFile || this.findItemByPath(processedData, cleanedPath);
        if (!found) {
            this.setState({ data: processedData });
            return null;
        }

        await this.selectTreeRow(found, { treeData: processedData });
        return found;
    };

    formatHistoryDate = (dateString) => {
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    historyVersionId = (version) => {
        if (!version) return '';
        const id = version.id ?? version._id;
        if (id && typeof id === 'object' && id.$oid) return String(id.$oid);
        return String(id || '');
    };

    isSkerSelectedRow = (row) => {
        if (!row || row.isDirectory) return false;
        return (row.name?.split('.').pop() || '').toLowerCase() === 'sker';
    };

    isXlsxSelectedRow = (row) => {
        if (!row || row.isDirectory) return false;
        return (row.name?.split('.').pop() || '').toLowerCase() === 'xlsx';
    };

    isExcelWorkbookRow = (row) => {
        if (!row || row.isDirectory) return false;
        const extension = (row.name?.split('.').pop() || '').toLowerCase();
        return SK_EXCEL_WORKBOOK_EXTENSIONS.has(extension);
    };

    openActionsMenu = () => {
        this.setState({ actionsMenuOpen: true });
    };

    handleVirtualDiskContextMenu = () => {
        this.openActionsMenu();
    };

    handleRowContextMenu = async (row) => {
        await this.selectTreeRow(row, { scroll: false });
        this.openActionsMenu();
    };

    toggleActionsMenu = () => {
        this.setState((prev) => ({ actionsMenuOpen: !prev.actionsMenuOpen }));
    };

    closeActionsMenu = () => {
        if (this.state.actionsMenuOpen) {
            this.setState({ actionsMenuOpen: false });
        }
    };

    runVirtualDiskAction = (action) => {
        if (typeof action !== 'function') return;
        this.closeActionsMenu();
        action.call(this);
    };

    handleDownloadSelected = async () => {
        try {
            if (!this.state.selectedRow || this.state.selectedRow.isDirectory) {
                await showAlert({ message: 'Please select a file to download' });
                return;
            }
            const ok = await this.client.downloadFile(this.state.selectedRow.path);
            if (!ok) await showError('Download failed');
        } catch (e) {
            console.error(e);
            await showError('Download failed');
        }
    };

    handleOpenInExcel = async () => {
        const row = this.state.selectedRow;
        try {
            if (!this.isExcelWorkbookRow(row)) {
                await showAlert({ message: 'Please select an Excel workbook (.xlsx, .xls, .xlsm, .xlsb).' });
                return;
            }
            await this.openExcelWorkbookFile(row);
        } catch (e) {
            console.error(e);
            await showError(e?.message || 'Could not open the Excel file.');
        }
    };

    handleConvertExcel = async () => {
        const row = this.state.selectedRow;
        try {
            if (!this.isXlsxSelectedRow(row)) {
                await showAlert({ message: 'Please select an Excel file (.xlsx)' });
                return;
            }
            const prevSelectedPath = row.path;
            this.setState({ convertingExcel: { name: row.name } });
            const result = await this.client.convertXlsx(prevSelectedPath);
            if (result.success) {
                const skerPath = this.cleanPath(result.skerPath || '');
                if (skerPath) {
                    await this.applyTreeResult(skerPath);
                } else {
                    await this.applyTreeResult(prevSelectedPath);
                }

                let msg = `Conversion successful!\nFile: ${result.fileName}\nPath: ${skerPath || result.path}`;
                if (result.skExcelOutput) {
                    msg += `\n\nSkExcel output:\n${result.skExcelOutput}`;
                }
                if (result.skExcelError) {
                    msg += `\n\nWarnings:\n${result.skExcelError}`;
                }
                console.log(msg);
            }
        } catch (e) {
            console.error(e);
            await showError('Error during conversion: ' + (e?.message || String(e)));
        } finally {
            this.setState({ convertingExcel: null });
        }
    };

    handleExportToExcel = async () => {
        const row = this.state.selectedRow;
        try {
            if (!this.isSkerSelectedRow(row)) {
                await showAlert({ message: 'Please select a .sker file.' });
                return;
            }
            const prevSelectedPath = row.path;
            this.setState({ exportingSker: { name: row.name } });
            const result = await this.client.exportSkerToXlsx(prevSelectedPath);
            if (result.success) {
                const xlsxPath = this.cleanPath(result.xlsxPath || '');
                if (xlsxPath) {
                    await this.applyTreeResult(xlsxPath);
                } else {
                    await this.applyTreeResult(prevSelectedPath);
                }

                let msg = `Export successful!\nFile: ${result.fileName}\nPath: ${xlsxPath || result.path}`;
                if (result.skExcelOutput) {
                    msg += `\n\nSkExcel output:\n${result.skExcelOutput}`;
                }
                if (result.skExcelError) {
                    msg += `\n\nWarnings:\n${result.skExcelError}`;
                }
                console.log(msg);
            }
        } catch (e) {
            console.error(e);
            await showError('Error during export: ' + (e?.message || String(e)));
        } finally {
            this.setState({ exportingSker: null });
        }
    };

    renderActionsMenuItem = ({
        label,
        onClick,
        disabled = false,
        tone = 'neutral',
        dataTour,
    }) => (
        <button
            type="button"
            role="menuitem"
            data-tour={dataTour}
            className={`SkVirtualDisk-actionsItem SkVirtualDisk-actionsItem--${tone}${disabled ? ' SkVirtualDisk-actionsItem--disabled' : ''}`}
            disabled={disabled}
            onClick={() => {
                if (disabled) return;
                this.runVirtualDiskAction(onClick);
            }}
        >
            {label}
        </button>
    );

    renderActionsMenuSection = (title, items) => (
        <div className="SkVirtualDisk-actionsSection" key={title}>
            <div className="SkVirtualDisk-actionsSectionTitle" role="presentation">
                {title}
            </div>
            {items.map((item) => this.renderActionsMenuItem(item))}
        </div>
    );

    openVersionsModal = async () => {
        const row = this.state.selectedRow;
        if (!this.isSkerSelectedRow(row)) {
            await showAlert({ message: 'Please select a .sker file.' });
            return;
        }

        const filePath = this.cleanPath(row.path);
        this.setState({
            historyModalOpen: true,
            historyVersions: [],
            historyLoading: true,
            historyBusy: false,
            historyError: null,
            selectedHistoryVersionId: null,
            historyTargetPath: filePath,
        });

        try {
            const result = await this.client.listSkerHistory(filePath, 50);
            this.setState({
                historyVersions: Array.isArray(result.versions) ? result.versions : [],
                historyMaxVersions: result.maxVersions || 50,
                historyLoading: false,
            });
        } catch (err) {
            console.error(err);
            this.setState({
                historyLoading: false,
                historyError: err?.message || 'Could not load version history.',
            });
        }
    };

    closeVersionsModal = () => {
        if (this.state.historyBusy) return;
        this.setState({
            historyModalOpen: false,
            historyVersions: [],
            historyLoading: false,
            historyError: null,
            selectedHistoryVersionId: null,
            historyTargetPath: null,
        });
    };

    openSnapshotModal = async () => {
        const row = this.state.selectedRow;
        if (!this.isSkerSelectedRow(row)) {
            await showAlert({ message: 'Please select a .sker file.' });
            return;
        }
        const filePath = this.cleanPath(row.path);
        const baseName = (row.name || 'Workbook').replace(/\.sker$/i, '');
        this.setState({
            snapshotModalOpen: true,
            snapshotLabel: `Snapshot — ${baseName}`,
            snapshotComment: '',
            snapshotBusy: false,
            snapshotError: null,
            snapshotTargetPath: filePath,
        });
    };

    closeSnapshotModal = () => {
        if (this.state.snapshotBusy) return;
        this.setState({
            snapshotModalOpen: false,
            snapshotLabel: '',
            snapshotComment: '',
            snapshotError: null,
            snapshotTargetPath: null,
        });
    };

    onSnapshotLabelChange = (e) => {
        this.setState({ snapshotLabel: e.target.value });
    };

    onSnapshotCommentChange = (e) => {
        this.setState({ snapshotComment: e.target.value });
    };

    confirmCreateSnapshot = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const label = String(this.state.snapshotLabel || '').trim();
        const comment = String(this.state.snapshotComment || '').trim();
        const filePath = this.state.snapshotTargetPath;

        if (!filePath) {
            await showAlert({ message: 'No file selected.' });
            return;
        }
        if (!label) {
            await showAlert({ message: 'Please enter a label.' });
            return;
        }

        this.setState({ snapshotBusy: true, snapshotError: null });
        try {
            await this.client.createSkerHistorySnapshot(filePath, label, comment);
            this.setState({
                snapshotModalOpen: false,
                snapshotBusy: false,
                snapshotLabel: '',
                snapshotComment: '',
                snapshotTargetPath: null,
            });
        } catch (err) {
            console.error(err);
            this.setState({
                snapshotBusy: false,
                snapshotError: err?.message || 'Could not save snapshot.',
            });
        }
    };

    onHistoryVersionSelect = (version) => {
        this.setState({ selectedHistoryVersionId: this.historyVersionId(version) });
    };

    confirmRestoreHistory = async () => {
        const { historyTargetPath, selectedHistoryVersionId } = this.state;
        if (!historyTargetPath || !selectedHistoryVersionId) {
            await showAlert({ message: 'Please select a version to restore.' });
            return;
        }

        const selected = this.state.historyVersions.find(
            (v) => this.historyVersionId(v) === selectedHistoryVersionId
        );
        const revisionLabel = selected?.revision != null ? `#${selected.revision}` : '';
        const labelPart = selected?.label ? ` "${selected.label}"` : '';
        const confirmed = await showConfirm({
            title: 'Restore version',
            message: `Restore version ${revisionLabel}${labelPart}?`,
            detail: `${historyTargetPath}\n\nThe current file will remain unchanged until you save again.`,
            confirmLabel: 'Restore',
        });
        if (!confirmed) {
            return;
        }

        this.setState({ historyBusy: true, historyError: null });
        try {
            await this.client.restoreSkerHistory(historyTargetPath, selectedHistoryVersionId);
            await this.applyTreeResult(historyTargetPath);
            this.setState({
                historyModalOpen: false,
                historyBusy: false,
                historyVersions: [],
                selectedHistoryVersionId: null,
                historyTargetPath: null,
            });
        } catch (err) {
            console.error(err);
            this.setState({
                historyBusy: false,
                historyError: err?.message || 'Restore failed.',
            });
        }
    };

    openCreateFolderModal = () => {
        this.setState({
            createFolderModalOpen: true,
            modalFolderName: 'New folder',
            modalFolderPermissionPreset: this.getDefaultPermissionPresetId(true),
            vdModalBusy: false,
        });
    };

    closeCreateFolderModal = () => {
        if (this.state.vdModalBusy) return;
        this.setState({ createFolderModalOpen: false });
    };

    onModalFolderNameChange = (e) => {
        this.setState({ modalFolderName: e.target.value });
    };

    confirmCreateFolder = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const name = String(this.state.modalFolderName || '')
            .trim()
            .replace(/^\/+|\/+$/g, '');
        if (!name || name.includes('/') || name === '.' || name === '..') {
            await showAlert({ message: 'Please enter a valid folder name.' });
            return;
        }
        this.setState({ vdModalBusy: true });
        try {
            const parentPath = this.getVirtualDiskParentPath();
            await this.client.cd(parentPath);
            const permissions = this.getPermissionValueFromPreset(
                this.state.modalFolderPermissionPreset,
                true
            );
            await this.client.mkdir(name, { permissions });
            const newPath = parentPath === '/' ? `/${name}` : `${parentPath}/${name}`;
            await this.applyTreeResult(newPath);
            this.setState({ createFolderModalOpen: false, vdModalBusy: false });
        } catch (err) {
            console.error(err);
            await showError(err?.message || 'Could not create folder.');
            this.setState({ vdModalBusy: false });
        }
    };

    openCreateSpreadsheetModal = () => {
        this.setState({
            createSpreadsheetModalOpen: true,
            modalSpreadsheetName: 'Untitled.sker',
            modalSpreadsheetPermissionPreset: this.getDefaultPermissionPresetId(false),
            vdModalBusy: false,
        });
    };

    closeCreateSpreadsheetModal = () => {
        if (this.state.vdModalBusy) return;
        this.setState({ createSpreadsheetModalOpen: false });
    };

    onModalSpreadsheetNameChange = (e) => {
        this.setState({ modalSpreadsheetName: e.target.value });
    };

    confirmCreateSpreadsheet = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        let base = String(this.state.modalSpreadsheetName || '').trim();
        if (!base) {
            await showAlert({ message: 'Please enter a file name.' });
            return;
        }
        if (!base.toLowerCase().endsWith('.sker')) {
            base += '.sker';
        }
        if (base.includes('/') || base.includes('\\')) {
            await showAlert({ message: 'Please enter a file name without path separators.' });
            return;
        }
        this.setState({ vdModalBusy: true });
        try {
            const parentPath = this.getVirtualDiskParentPath();
            await this.client.cd(parentPath);
            const filePath = parentPath === '/' ? `/${base}` : `${parentPath}/${base}`;
            const permissions = this.getPermissionValueFromPreset(
                this.state.modalSpreadsheetPermissionPreset,
                false
            );
            const result = await this.client.createSpreadsheet(base, { permissions });
            const preferredPath = this.cleanPath(result?.path || filePath);
            await this.applyTreeResult(preferredPath);
            this.setState({ createSpreadsheetModalOpen: false, vdModalBusy: false });
        } catch (err) {
            console.error(err);
            await showError(err?.message || 'Could not create spreadsheet.');
            this.setState({ vdModalBusy: false });
        }
    };

    openCreateDocumentModal = () => {
        this.setState({
            createDocumentModalOpen: true,
            modalDocumentName: 'Untitled.html',
            modalDocumentPermissionPreset: this.getDefaultPermissionPresetId(false),
            vdModalBusy: false,
        });
    };

    closeCreateDocumentModal = () => {
        if (this.state.vdModalBusy) return;
        this.setState({ createDocumentModalOpen: false });
    };

    onModalDocumentNameChange = (e) => {
        this.setState({ modalDocumentName: e.target.value });
    };

    confirmCreateDocument = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        let base = String(this.state.modalDocumentName || '').trim();
        if (!base) {
            await showAlert({ message: 'Please enter a file name.' });
            return;
        }
        if (!base.toLowerCase().endsWith('.html')) {
            base += '.html';
        }
        if (base.includes('/') || base.includes('\\')) {
            await showAlert({ message: 'Please enter a file name without path separators.' });
            return;
        }
        this.setState({ vdModalBusy: true });
        try {
            const parentPath = this.getVirtualDiskParentPath();
            await this.client.cd(parentPath);
            const filePath = parentPath === '/' ? `/${base}` : `${parentPath}/${base}`;
            const permissions = this.getPermissionValueFromPreset(
                this.state.modalDocumentPermissionPreset,
                false
            );
            const result = await this.client.createDocument(base, { permissions });
            const preferredPath = this.cleanPath(result?.path || filePath);
            await this.applyTreeResult(preferredPath);
            this.setState({ createDocumentModalOpen: false, vdModalBusy: false });
        } catch (err) {
            console.error(err);
            await showError(err?.message || 'Could not create HTML file.');
            this.setState({ vdModalBusy: false });
        }
    };

    openChmodModal = async () => {
        const row = this.state.selectedRow;
        if (!row) {
            await showAlert({ message: 'Please select a file or folder.' });
            return;
        }
        const filePath = this.cleanPath(row.path);
        const isDirectory = Boolean(row.isDirectory);
        this.setState({
            chmodModalOpen: true,
            chmodTargetPath: filePath,
            chmodTargetIsDirectory: isDirectory,
            chmodPermissionPreset: this.guessPermissionPresetId(row.permissionsValue, isDirectory),
            chmodSharedAccess: row.sharedAccess || 'off',
            vdModalBusy: false,
        });
    };

    closeChmodModal = () => {
        if (this.state.vdModalBusy) return;
        this.setState({
            chmodModalOpen: false,
            chmodTargetPath: null,
            chmodTargetIsDirectory: false,
        });
    };

    confirmChmodPermissions = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const filePath = this.state.chmodTargetPath;
        if (!filePath) {
            await showAlert({ message: 'No item selected.' });
            return;
        }
        let permissions = this.getPermissionValueFromPreset(
            this.state.chmodPermissionPreset,
            this.state.chmodTargetIsDirectory
        );
        let sharedAccessOption;
        if (this.isCurrentUserAdmin() && this.state.chmodTargetIsDirectory) {
            const sa = this.state.chmodSharedAccess;
            if (sa === 'read') {
                sharedAccessOption = 'read';
                permissions = this.getPermissionValueFromPreset('public-read', true);
            } else if (sa === 'write') {
                sharedAccessOption = 'write';
                permissions = this.getPermissionValueFromPreset('public-write', true);
            } else {
                sharedAccessOption = 'off';
            }
        }

        this.setState({ vdModalBusy: true });
        try {
            await this.client.chmod(filePath, permissions, {
                sharedAccess: sharedAccessOption,
            });
            await this.applyTreeResult(filePath);
            this.setState({
                chmodModalOpen: false,
                vdModalBusy: false,
                chmodTargetPath: null,
                chmodTargetIsDirectory: false,
            });
        } catch (err) {
            console.error(err);
            await showError(err?.message || 'Could not update permissions.');
            this.setState({ vdModalBusy: false });
        }
    };

    // Core "open a .sker file" logic, factored out of handleRowDoubleClick so
    // the guided tour can trigger it directly (no DOM event, no implicit
    // selection state change) and so the behavior stays consistent between
    // a real double-click and a programmatic open.
    openSpreadsheetFile = async (row) => {
        if (!row || row.isDirectory) return false;
        const extension = (row.name || '').split('.').pop().toLowerCase();
        if (extension !== 'sker') return false;

        const filePath = this.cleanPath(row.path);
        this.setState({ openingFile: { name: row.name } });

        try {
            const hasSession =
                Boolean(sessionStorage.getItem('jwt')) &&
                Boolean(sessionStorage.getItem('user'));

            if (!hasSession) {
                const fileData = {
                    name: row.name,
                    path: filePath,
                    timestamp: Date.now(),
                };
                syncSpreadsheetSession(fileData);
                if (typeof window.__skerNavigateLogin === 'function') {
                    window.__skerNavigateLogin();
                } else if (this.props.navigate) {
                    this.props.navigate('/login', { replace: true });
                }
                return true;
            }

            const access = await this.client.checkFileAccess(filePath);
            if (!access.canRead) {
                throw new Error('You do not have permission to open this file.');
            }

            const fileData = {
                name: row.name,
                path: filePath,
                canWrite: Boolean(access.canWrite),
                timestamp: Date.now(),
            };
            syncSpreadsheetSession(fileData);
            //console.log('File access granted for spreadsheet:', fileData);

            if (!fileData.canWrite) {
                await showAlert({
                    title: 'Lecture seule',
                    message:
                        `Le fichier « ${row.name} » est ouvert en lecture seule. ` +
                        'Vous pouvez le consulter, mais pas enregistrer de modifications.',
                });
            }

            const goSpreadsheet = () => {
                if (typeof window.__skerNavigate === 'function') {
                    window.__skerNavigate('/spreadsheet', { replace: false });
                } else if (this.props.navigate) {
                    this.props.navigate('/spreadsheet');
                }
            };
            requestAnimationFrame(goSpreadsheet);
            return true;
        } catch (error) {
            this.setState({ openingFile: null });
            console.error('Error opening spreadsheet:', error);
            throw error;
        }
    };

    // Download an Excel workbook from the virtual disk for opening in Microsoft Excel.
    openExcelWorkbookFile = async (row) => {
        if (!row || row.isDirectory || !this.isExcelWorkbookRow(row)) return false;

        const filePath = this.cleanPath(row.path);
        this.setState({ openingFile: { name: row.name } });

        try {
            const hasSession =
                Boolean(sessionStorage.getItem('jwt')) &&
                Boolean(sessionStorage.getItem('user'));

            if (!hasSession) {
                await showAlert({
                    title: 'Connexion requise',
                    message: 'Connectez-vous pour télécharger et ouvrir ce classeur Excel.',
                });
                return false;
            }

            const access = await this.client.checkFileAccess(filePath);
            if (!access.canRead) {
                throw new Error('You do not have permission to open this file.');
            }

            const result = await this.client.downloadForExternalOpen(filePath, {
                // Prefer immediate browser download (Safari can auto-open safe files).
                trySavePicker: false,
            });

            if (result.method === 'cancelled') {
                return false;
            }

            return true;
        } finally {
            this.setState({ openingFile: null });
        }
    };

    openTextEditorForDocument = (fileData) => {
        syncTextDocumentSession(fileData);
        const goTextEditor = () => {
            if (typeof window.__skerNavigate === 'function') {
                window.__skerNavigate('/texteditor', { replace: false });
            } else if (this.props.navigate) {
                this.props.navigate('/texteditor');
            }
        };
        requestAnimationFrame(goTextEditor);
    };

    closeDocumentLockNoticeModal = () => {
        this.setState({
            documentLockNoticeOpen: false,
            documentLockNoticeLockedBy: '',
            documentLockNoticeFileName: '',
            documentLockNoticePending: null,
        });
    };

    confirmDocumentLockNotice = () => {
        const pending = this.state.documentLockNoticePending;
        this.closeDocumentLockNoticeModal();
        if (pending) {
            this.openTextEditorForDocument(pending);
        }
    };

    openTextDocumentFile = async (row) => {
        if (!row || row.isDirectory) return false;
        const extension = (row.name || '').split('.').pop().toLowerCase();
        if (!['html', 'htm'].includes(extension)) return false;

        const filePath = this.cleanPath(row.path);
        this.setState({ openingFile: { name: row.name } });

        try {
            const hasSession =
                Boolean(sessionStorage.getItem('jwt')) &&
                Boolean(sessionStorage.getItem('user'));

            if (!hasSession) {
                const fileData = {
                    name: row.name,
                    path: filePath,
                    timestamp: Date.now(),
                };
                syncTextDocumentSession(fileData);
                if (typeof window.__skerNavigateLogin === 'function') {
                    window.__skerNavigateLogin();
                } else if (this.props.navigate) {
                    this.props.navigate('/login', { replace: true });
                }
                return true;
            }

            const access = await this.client.checkFileAccess(filePath);
            if (!access.canRead) {
                throw new Error('You do not have permission to open this file.');
            }

            let canWrite = Boolean(access.canWrite);
            if (canWrite) {
                try {
                    await this.client.acquireDocumentLock(filePath);
                } catch (lockError) {
                    if (lockError?.status === 409) {
                        canWrite = false;
                        const lockedBy = lockError.lock?.lockedBy || 'un autre utilisateur';
                        this.setState({
                            openingFile: null,
                            documentLockNoticeOpen: true,
                            documentLockNoticeLockedBy: lockedBy,
                            documentLockNoticeFileName: row.name,
                            documentLockNoticePending: {
                                name: row.name,
                                path: filePath,
                                canWrite: false,
                                timestamp: Date.now(),
                            },
                        });
                        return true;
                    }
                    throw lockError;
                }
            }

            const fileData = {
                name: row.name,
                path: filePath,
                canWrite,
                timestamp: Date.now(),
            };
            //console.log('File access granted for document:', fileData);
            if (!canWrite) {
                await showAlert({
                    title: 'Lecture seule',
                    message:
                        `Le document « ${row.name} » est ouvert en lecture seule. ` +
                        'Vous pouvez le consulter, mais pas enregistrer de modifications.',
                });
            }
            this.openTextEditorForDocument(fileData);
            return true;
        } catch (error) {
            this.setState({ openingFile: null });
            console.error('Error opening document:', error);
            throw error;
        }
    };

    handleRowDoubleClick = async (row) => {
        if (!row) return;
        if (row.isDirectory) {
            await this.selectTreeRow(row, { expandIfDirectory: true });
            return;
        }

        const cleanedPath = this.cleanPath(row.path);
        if (!this.state.selectedRow || this.cleanPath(this.state.selectedRow.path) !== cleanedPath) {
            await this.selectTreeRow(row);
        }
        //console.log('Row double clicked:', row);
        const extension = row.name.split('.').pop().toLowerCase();
        if (extension === 'sker') {
            try {
                await this.openSpreadsheetFile(row);
            } catch (error) {
                this.setState({ openingFile: null });
                await showError(error?.message || 'You do not have permission to open this file.');
            }
        } else if (this.isExcelWorkbookRow(row)) {
            try {
                await this.openExcelWorkbookFile(row);
            } catch (error) {
                this.setState({ openingFile: null });
                await showError(error?.message || 'Could not open the Excel file.');
            }
        } else if (extension === 'html' || extension === 'htm') {
            try {
                await this.openTextDocumentFile(row);
            } catch (error) {
                this.setState({ openingFile: null });
                await showError(error?.message || 'You do not have permission to open this file.');
            }
        } else {
            // Load the file for other file types
            try {
                let wFile = await this.client.loadFile(row.path);
                //console.log('File loaded:', wFile);
            } catch (error) {
                console.error('Error loading file:', error);
                await showError('Error loading file');
            }
        }
    }

    componentWillUnmount() {
        // Persist the last known selection when leaving the view
        try {
            const row = this.state.selectedRow;
            if (row && row.path) {
                const selectionData = { path: row.path, timestamp: Date.now() };
                sessionStorage.setItem('SkVirtualDiskSelection', JSON.stringify(selectionData));
            }
        } catch (e) {
            console.warn('Unable to persist selection on unmount:', e);
        }
        for (const key of [
            '__skerVirtualDiskOpen',
            '__skerVirtualDiskResolveTourPath',
            '__skerVirtualDiskOpenActionsMenu',
            '__skerVirtualDiskCloseActionsMenu',
        ]) {
            if (window[key]) {
                try { delete window[key]; } catch (e) { window[key] = undefined; }
            }
        }
    }

    handleUpload = async () => {
        try {
            const fileInput = document.createElement('input');
            fileInput.type = 'file';
            fileInput.style.display = 'none';
            document.body.appendChild(fileInput);

            fileInput.onchange = async (event) => {
                const file = event.target.files?.[0];
                try {
                    if (!file) return;

                    const parentPath = this.getVirtualDiskParentPath();
                    await this.client.cd(parentPath);

                    const ext = (file.name.split('.').pop() || '').toLowerCase();
                    const binaryExtensions = ['xlsx', 'xls', 'xlsm', 'xlsb', 'zip', 'png', 'jpg', 'jpeg', 'gif', 'pdf'];
                    if (binaryExtensions.includes(ext)) {
                        await this.client.loadBinaryFiles(file, this.client);
                    } else {
                        const content = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (readEvent) => resolve(readEvent.target.result);
                            reader.onerror = () => reject(new Error('Error while reading file'));
                            reader.readAsText(file);
                        });
                        await this.client.touch(file.name, content);
                    }

                    const newFilePath = this.cleanPath(
                        parentPath === '/' ? `/${file.name}` : `${parentPath}/${file.name}`
                    );
                    await this.client.chmod(newFilePath, 770);
                    await this.applyTreeResult(newFilePath);
                } catch (error) {
                    console.error('Error uploading file:', error);
                    await showError('Error while uploading file');
                } finally {
                    document.body.removeChild(fileInput);
                }
            };

            fileInput.click();
        } catch (error) {
            console.error('Error in upload process:', error);
            await showError('Error in upload process');
        }
    }

    render() {
        const modalFieldStyle = { marginBottom: '12px' };
        const busy = this.state.vdModalBusy;
        const historyBusy = this.state.historyBusy;
        const historyLoading = this.state.historyLoading;
        const snapshotBusy = this.state.snapshotBusy;
        const skerSelected = this.isSkerSelectedRow(this.state.selectedRow);
        const xlsxSelected = this.isXlsxSelectedRow(this.state.selectedRow);
        const excelSelected = this.isExcelWorkbookRow(this.state.selectedRow);
        const selectedRow = this.state.selectedRow;
        const fileSelected = Boolean(selectedRow && !selectedRow.isDirectory);
        const hasSelection = Boolean(selectedRow);
        const actionsMenuOpen = this.state.actionsMenuOpen;

        return (
            <div className="SkTestGridTreeView">
                <SkModal
                    show={this.state.createFolderModalOpen}
                    title="New folder"
                    width={480}
                    height={520}
                    closeButton={false}
                    footer={
                        <>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                                onClick={this.closeCreateFolderModal}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="vd-new-folder-form"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                                disabled={busy}
                            >
                                Create
                            </button>
                        </>
                    }
                >
                    <form id="vd-new-folder-form" onSubmit={this.confirmCreateFolder}>
                        <div style={modalFieldStyle}>
                            <label htmlFor="vd-new-folder-name" style={{ display: 'block', marginBottom: '6px' }}>
                                Folder name
                            </label>
                            <SkInput
                                id="vd-new-folder-name"
                                name="folderName"
                                type="text"
                                value={this.state.modalFolderName}
                                onChange={this.onModalFolderNameChange}
                                placeholder="New folder"
                                disabled={busy}
                            />
                        </div>
                        {this.renderPermissionPresetField(
                            'vd-new-folder-access',
                            this.state.modalFolderPermissionPreset,
                            this.onFolderPermissionPresetChange,
                            true
                        )}
                    </form>
                </SkModal>
                <SkModal
                    show={this.state.createSpreadsheetModalOpen}
                    title="New spreadsheet"
                    width={480}
                    height={520}
                    closeButton={false}
                    footer={
                        <>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                                onClick={this.closeCreateSpreadsheetModal}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="vd-new-spreadsheet-form"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                                disabled={busy}
                            >
                                Create
                            </button>
                        </>
                    }
                >
                    <form id="vd-new-spreadsheet-form" onSubmit={this.confirmCreateSpreadsheet}>
                        <div style={modalFieldStyle}>
                            <label htmlFor="vd-new-spreadsheet-name" style={{ display: 'block', marginBottom: '6px' }}>
                                File name
                            </label>
                            <SkInput
                                id="vd-new-spreadsheet-name"
                                name="spreadsheetName"
                                type="text"
                                value={this.state.modalSpreadsheetName}
                                onChange={this.onModalSpreadsheetNameChange}
                                placeholder="Untitled.sker"
                                disabled={busy}
                            />
                        </div>
                        <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#555' }}>
                            Use a .sker extension (added automatically if omitted).
                        </p>
                        <div style={{ marginTop: '12px' }}>
                            {this.renderPermissionPresetField(
                                'vd-new-spreadsheet-access',
                                this.state.modalSpreadsheetPermissionPreset,
                                this.onSpreadsheetPermissionPresetChange,
                                false
                            )}
                        </div>
                    </form>
                </SkModal>
                <SkModal
                    show={this.state.createDocumentModalOpen}
                    title="New HTML file"
                    width={480}
                    height={520}
                    closeButton={false}
                    footer={
                        <>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                                onClick={this.closeCreateDocumentModal}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="vd-new-document-form"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                                disabled={busy}
                            >
                                Create
                            </button>
                        </>
                    }
                >
                    <form id="vd-new-document-form" onSubmit={this.confirmCreateDocument}>
                        <div style={modalFieldStyle}>
                            <label htmlFor="vd-new-document-name" style={{ display: 'block', marginBottom: '6px' }}>
                                File name
                            </label>
                            <SkInput
                                id="vd-new-document-name"
                                name="documentName"
                                type="text"
                                value={this.state.modalDocumentName}
                                onChange={this.onModalDocumentNameChange}
                                placeholder="Untitled.html"
                                disabled={busy}
                            />
                        </div>
                        <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#555' }}>
                            Use a .html extension (added automatically if omitted).
                        </p>
                        <div style={{ marginTop: '12px' }}>
                            {this.renderPermissionPresetField(
                                'vd-new-document-access',
                                this.state.modalDocumentPermissionPreset,
                                this.onDocumentPermissionPresetChange,
                                false
                            )}
                        </div>
                    </form>
                </SkModal>
                <SkModal
                    show={this.state.documentLockNoticeOpen}
                    title="Document verrouillé"
                    width={460}
                    height={280}
                    closeButton={false}
                    footer={
                        <button
                            type="button"
                            className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                            onClick={this.confirmDocumentLockNotice}
                        >
                            Ouvrir en lecture seule
                        </button>
                    }
                >
                    <div className="SkVirtualDisk-lockNotice">
                        <p className="SkVirtualDisk-lockNotice-lead">
                            Ce document est en cours d&apos;édition par un autre utilisateur.
                        </p>
                        <p className="SkVirtualDisk-lockNotice-detail">
                            <span className="SkVirtualDisk-lockNotice-label">Fichier</span>
                            <strong>{this.state.documentLockNoticeFileName}</strong>
                        </p>
                        <p className="SkVirtualDisk-lockNotice-detail">
                            <span className="SkVirtualDisk-lockNotice-label">Verrouillé par</span>
                            <strong>{this.state.documentLockNoticeLockedBy}</strong>
                        </p>
                        <p className="SkVirtualDisk-lockNotice-hint">
                            Vous pouvez consulter le contenu, mais pas le modifier tant que le verrou est actif.
                        </p>
                    </div>
                </SkModal>
                <SkModal
                    show={this.state.chmodModalOpen}
                    title="Change access"
                    width={480}
                    height={680}
                    closeButton={false}
                    footer={
                        <>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                                onClick={this.closeChmodModal}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="vd-chmod-form"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                                disabled={busy}
                            >
                                Apply
                            </button>
                        </>
                    }
                >
                    <form id="vd-chmod-form" onSubmit={this.confirmChmodPermissions}>
                        <div style={{ marginBottom: '12px', fontSize: '13px', color: 'var(--sk-text-muted, #666)' }}>
                            {this.state.chmodTargetPath || ''}
                        </div>
                        {this.renderPermissionPresetField(
                            'vd-chmod-access',
                            this.state.chmodPermissionPreset,
                            this.onChmodPermissionPresetChange,
                            this.state.chmodTargetIsDirectory
                        )}
                        {this.isCurrentUserAdmin() && this.state.chmodTargetIsDirectory
                            ? this.renderAdminSharedAreaField(
                                  'vd-chmod-shared',
                                  this.state.chmodSharedAccess,
                                  this.onChmodSharedAccessChange
                              )
                            : null}
                    </form>
                </SkModal>
                <SkModal
                    show={this.state.snapshotModalOpen}
                    title="Save version snapshot"
                    width={480}
                    height={320}
                    closeButton={false}
                    footer={
                        <>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                                onClick={this.closeSnapshotModal}
                                disabled={snapshotBusy}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="vd-snapshot-form"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                                disabled={snapshotBusy}
                            >
                                Save snapshot
                            </button>
                        </>
                    }
                >
                    <form id="vd-snapshot-form" onSubmit={this.confirmCreateSnapshot}>
                        <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--sk-text-muted, #666)' }}>
                            {this.state.snapshotTargetPath || ''}
                        </div>
                        <div style={modalFieldStyle}>
                            <label htmlFor="vd-snapshot-label" style={{ display: 'block', marginBottom: '6px' }}>
                                Label
                            </label>
                            <SkInput
                                id="vd-snapshot-label"
                                name="snapshotLabel"
                                type="text"
                                value={this.state.snapshotLabel}
                                onChange={this.onSnapshotLabelChange}
                                placeholder="e.g. Before budget review"
                                disabled={snapshotBusy}
                            />
                        </div>
                        <div style={modalFieldStyle}>
                            <label htmlFor="vd-snapshot-comment" style={{ display: 'block', marginBottom: '6px' }}>
                                Comment
                            </label>
                            <SkInput
                                id="vd-snapshot-comment"
                                name="snapshotComment"
                                type="text"
                                value={this.state.snapshotComment}
                                onChange={this.onSnapshotCommentChange}
                                placeholder="Optional notes"
                                disabled={snapshotBusy}
                            />
                        </div>
                        {this.state.snapshotError ? (
                            <p style={{ margin: '8px 0 0', color: '#c62828' }}>{this.state.snapshotError}</p>
                        ) : null}
                        <p style={{ margin: '8px 0 0', fontSize: '13px', color: '#555' }}>
                            Saves the current file content as a restorable version.
                        </p>
                    </form>
                </SkModal>
                <SkModal
                    show={this.state.historyModalOpen}
                    title="Version history"
                    width={820}
                    height={500}
                    closeButton={false}
                    footer={
                        <>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                                onClick={this.closeVersionsModal}
                                disabled={historyBusy}
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                                onClick={this.confirmRestoreHistory}
                                disabled={
                                    historyBusy ||
                                    historyLoading ||
                                    !this.state.selectedHistoryVersionId
                                }
                            >
                                Restore
                            </button>
                        </>
                    }
                >
                    <div style={{ marginBottom: '8px', fontSize: '13px', color: 'var(--sk-text-muted, #666)' }}>
                        {this.state.historyTargetPath || ''}
                        {this.state.historyMaxVersions
                            ? ` — up to ${this.state.historyMaxVersions} versions kept.`
                            : ''}
                    </div>
                    {historyLoading ? (
                        <p style={{ margin: 0 }}>Loading…</p>
                    ) : null}
                    {this.state.historyError ? (
                        <p style={{ margin: '8px 0', color: '#c62828' }}>{this.state.historyError}</p>
                    ) : null}
                    {!historyLoading && !this.state.historyError && this.state.historyVersions.length === 0 ? (
                        <p style={{ margin: 0 }}>No saved versions yet. Use &quot;Save snapshot&quot; to create one.</p>
                    ) : null}
                    {!historyLoading && this.state.historyVersions.length > 0 ? (
                        <div style={{ overflow: 'auto', maxHeight: '340px', border: '1px solid var(--sk-border-color, #484848)', borderRadius: '4px' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ background: 'var(--sk-darker-background, #2d2d2d)', color: 'var(--sk-text-color, #f3f2f1)', textAlign: 'left' }}>
                                        <th style={{ padding: '8px', width: '36px' }} />
                                        <th style={{ padding: '8px' }}>Rev.</th>
                                        <th style={{ padding: '8px' }}>Label</th>
                                        <th style={{ padding: '8px' }}>Comment</th>
                                        <th style={{ padding: '8px' }}>Date</th>
                                        <th style={{ padding: '8px' }}>Author</th>
                                        <th style={{ padding: '8px' }}>Size</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {this.state.historyVersions.map((version) => {
                                        const versionId = this.historyVersionId(version);
                                        const selected = this.state.selectedHistoryVersionId === versionId;
                                        return (
                                            <tr
                                                key={versionId || version.revision}
                                                onClick={() => this.onHistoryVersionSelect(version)}
                                                style={{
                                                    cursor: 'pointer',
                                                    background: selected
                                                        ? 'var(--sk-grid-row-selected-bg, #005a9e)'
                                                        : 'transparent',
                                                    color: selected
                                                        ? 'var(--sk-grid-row-selected-text, #ffffff)'
                                                        : undefined,
                                                }}
                                            >
                                                <td style={{ padding: '8px', textAlign: 'center' }}>
                                                    <input
                                                        type="radio"
                                                        name="vd-history-version"
                                                        checked={selected}
                                                        onChange={() => this.onHistoryVersionSelect(version)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                </td>
                                                <td style={{ padding: '8px' }}>{version.revision}</td>
                                                <td style={{ padding: '8px' }}>{version.label || '—'}</td>
                                                <td style={{ padding: '8px' }}>{version.comment || '—'}</td>
                                                <td style={{ padding: '8px' }}>
                                                    {version.createdAt
                                                        ? this.formatHistoryDate(version.createdAt)
                                                        : '—'}
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    {version.author || version.email || '—'}
                                                </td>
                                                <td style={{ padding: '8px' }}>
                                                    {this.formatFileSize(version.size || 0)}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </SkModal>
                <SkModal
                    show={this.state.renameModalOpen}
                    title="Rename"
                    width={420}
                    height={210}
                    closeButton={false}
                    footer={
                        <>
                            <button
                                type="button"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--secondary"
                                onClick={this.closeRenameModal}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                form="vd-rename-form"
                                className="SkModal-toolbarBtn SkModal-toolbarBtn--primary"
                                disabled={busy}
                            >
                                Rename
                            </button>
                        </>
                    }
                >
                    <form id="vd-rename-form" onSubmit={this.confirmRename}>
                        <div style={modalFieldStyle}>
                            <label htmlFor="vd-rename-name" style={{ display: 'block', marginBottom: '6px' }}>
                                New name
                            </label>
                            <SkInput
                                id="vd-rename-name"
                                name="renameName"
                                type="text"
                                value={this.state.modalRenameName}
                                onChange={this.onModalRenameNameChange}
                                placeholder="New name"
                                disabled={busy}
                            />
                        </div>
                    </form>
                </SkModal>
                <SkGridTreeView 
                    ref={this.gridRef}
                    defaultSortColumn="name"
                    defaultSortDirection="asc"
                    columns={this.m_data.columns}
                    data={this.m_data.data}
                    onRowSelect={this.handleRowSelect}
                    selectedRow={this.state.selectedRow}
                    onRowDoubleClick={this.handleRowDoubleClick}
                    onRowContextMenu={this.handleRowContextMenu}
                    onContextMenu={this.handleVirtualDiskContextMenu}
                    onExpandedChange={(set) => {
                        try {
                            const newSet = new Set(set);
                            this.setState({ expandedNodes: newSet });
                            sessionStorage.setItem('SkVirtualDiskExpanded', JSON.stringify(Array.from(newSet)));
                        } catch {}
                    }}
                />
                <div className="SkVirtualDisk-actionsFab">
                    {actionsMenuOpen ? (
                        <button
                            type="button"
                            className="SkVirtualDisk-actionsBackdrop"
                            aria-label="Close actions menu"
                            onClick={this.closeActionsMenu}
                        />
                    ) : null}
                    {actionsMenuOpen ? (
                        <div
                            className="SkVirtualDisk-actionsPanel"
                            role="menu"
                            aria-label="Virtual disk actions"
                            data-tour="vd-actions-panel"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {this.renderActionsMenuSection('Create', [
                                {
                                    label: 'Upload',
                                    tone: 'upload',
                                    dataTour: 'vd-upload',
                                    onClick: this.handleUpload,
                                },
                                {
                                    label: 'New folder',
                                    tone: 'folder',
                                    dataTour: 'vd-new-folder',
                                    onClick: this.openCreateFolderModal,
                                },
                                {
                                    label: 'New spreadsheet',
                                    tone: 'spreadsheet',
                                    dataTour: 'vd-new-spreadsheet',
                                    onClick: this.openCreateSpreadsheetModal,
                                },
                                {
                                    label: 'New HTML file',
                                    tone: 'document',
                                    dataTour: 'vd-new-document',
                                    onClick: this.openCreateDocumentModal,
                                },
                            ])}
                            {this.renderActionsMenuSection('Sharing', [
                                {
                                    label: 'Access',
                                    tone: 'access',
                                    dataTour: 'vd-permissions',
                                    disabled: !hasSelection,
                                    onClick: this.openChmodModal,
                                },
                            ])}
                            {this.renderActionsMenuSection('File', [
                                {
                                    label: 'Download',
                                    tone: 'download',
                                    dataTour: 'vd-download',
                                    disabled: !fileSelected,
                                    onClick: this.handleDownloadSelected,
                                },
                                {
                                    label: 'Open in Excel',
                                    tone: 'excel',
                                    dataTour: 'vd-open-excel',
                                    disabled: !excelSelected,
                                    onClick: this.handleOpenInExcel,
                                },
                            ])}
                            {this.renderActionsMenuSection('Workbook history', [
                                {
                                    label: 'Save snapshot',
                                    tone: 'snapshot',
                                    dataTour: 'vd-snapshot',
                                    disabled: !skerSelected,
                                    onClick: this.openSnapshotModal,
                                },
                                {
                                    label: 'Versions',
                                    tone: 'versions',
                                    dataTour: 'vd-history',
                                    disabled: !skerSelected,
                                    onClick: this.openVersionsModal,
                                },
                            ])}
                            {this.renderActionsMenuSection('Excel interchange', [
                                {
                                    label: 'Convert Excel',
                                    tone: 'convert',
                                    dataTour: 'vd-convert',
                                    disabled: !xlsxSelected,
                                    onClick: this.handleConvertExcel,
                                },
                                {
                                    label: 'Export to Excel',
                                    tone: 'excel',
                                    dataTour: 'vd-export-excel',
                                    disabled: !skerSelected,
                                    onClick: this.handleExportToExcel,
                                },
                            ])}
                            {this.renderActionsMenuSection('Organize', [
                                {
                                    label: 'Rename',
                                    tone: 'rename',
                                    dataTour: 'vd-rename',
                                    disabled: !hasSelection,
                                    onClick: this.openRenameModal,
                                },
                            ])}
                            {this.renderActionsMenuSection('Remove', [
                                {
                                    label: 'Delete',
                                    tone: 'delete',
                                    dataTour: 'vd-delete',
                                    onClick: this.handleDelete,
                                },
                            ])}
                        </div>
                    ) : null}
                    <button
                        type="button"
                        className={`SkVirtualDisk-actionsFabBtn${actionsMenuOpen ? ' SkVirtualDisk-actionsFabBtn--open' : ''}`}
                        aria-expanded={actionsMenuOpen}
                        aria-haspopup="menu"
                        aria-label="Virtual disk actions"
                        data-tour="vd-actions"
                        onClick={this.toggleActionsMenu}
                    >
                        Actions
                    </button>
                </div>
                {this.state.openingFile ? (
                    <div className="SkVirtualDisk-openingOverlay" aria-busy="true" aria-live="polite">
                        <SkLoadingSpinner
                            size="large"
                            text={`Loading ${this.state.openingFile.name}…`}
                            showText={true}
                        />
                    </div>
                ) : null}
                {this.state.convertingExcel ? (
                    <div className="SkVirtualDisk-openingOverlay" aria-busy="true" aria-live="polite">
                        <SkLoadingSpinner
                            size="large"
                            text={`Converting ${this.state.convertingExcel.name}…`}
                            showText={true}
                        />
                    </div>
                ) : null}
                {this.state.exportingSker ? (
                    <div className="SkVirtualDisk-openingOverlay" aria-busy="true" aria-live="polite">
                        <SkLoadingSpinner
                            size="large"
                            text={`Exporting ${this.state.exportingSker.name}…`}
                            showText={true}
                        />
                    </div>
                ) : null}
            </div>
        );
    }
}

// Wrapper component to use useNavigate hook
const SkVirtualDiskWrapper = (props) => {
    const navigate = useNavigate();
    return <SkVirtualDisk {...props} navigate={navigate} />;
};

export default SkVirtualDiskWrapper;