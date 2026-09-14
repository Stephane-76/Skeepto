import React from 'react';
import { buildSpreadsheetMenuItems } from './spreadsheet/SkeeptoMenu.js';
import { isSpreadsheetLoaded } from './SkActiveFile.js';

// Icons in black and white
export const Icons = {
    spreadsheet: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2H14V14H2V2Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 5H14" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 8H14" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 11H14" stroke="currentColor" strokeWidth="2"/>
            <path d="M5 2V14" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 2V14" stroke="currentColor" strokeWidth="2"/>
            <path d="M11 2V14" stroke="currentColor" strokeWidth="2"/>
        </svg>
    ),
    user: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="4" r="3" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 14C2 10.6863 4.68629 8 8 8C11.3137 8 14 10.6863 14 14" stroke="currentColor" strokeWidth="2"/>
        </svg>
    ),
    group: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="6" cy="4" r="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 14C2 11.7909 3.79086 10 6 10" stroke="currentColor" strokeWidth="2"/>
            <circle cx="11" cy="4" r="2" stroke="currentColor" strokeWidth="2"/>
            <path d="M14 14C14 11.7909 12.2091 10 10 10" stroke="currentColor" strokeWidth="2"/>
        </svg>
    ),
    grid: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2H14V14H2V2Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 5H14" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 8H14" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 11H14" stroke="currentColor" strokeWidth="2"/>
            <path d="M5 2V14" stroke="currentColor" strokeWidth="2"/>
            <path d="M8 2V14" stroke="currentColor" strokeWidth="2"/>
            <path d="M11 2V14" stroke="currentColor" strokeWidth="2"/>
        </svg>
    ),
    disk: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2 2H14V14H2V2Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M5 2V14" stroke="currentColor" strokeWidth="2"/>
            <path d="M11 2V14" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 5H14" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 11H14" stroke="currentColor" strokeWidth="2"/>
        </svg>
    ),
    login: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M6 4H14V12H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M10 8H2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M4 5L2 8L4 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    new: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 3V13M3 8H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
    ),
    open: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M14 2H2V14H14V2Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M6 6L10 8L6 10V6Z" fill="currentColor"/>
        </svg>
    ),
    exit: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
    ),
    undo: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 8C3 5.23858 5.23858 3 8 3C10.7614 3 13 5.23858 13 8C13 10.7614 10.7614 13 8 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M5 5L3 8L5 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    redo: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 8C13 5.23858 10.7614 3 8 3C5.23858 3 3 5.23858 3 8C3 10.7614 5.23858 13 8 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M11 5L13 8L11 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    cut: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4L12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M12 4L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
    ),
    copy: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 4H12V12H4V4Z" stroke="currentColor" strokeWidth="2"/>
            <path d="M2 2H10V10" stroke="currentColor" strokeWidth="2"/>
        </svg>
    ),
    paste: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 2H12V6" stroke="currentColor" strokeWidth="2"/>
            <path d="M4 6H12V14H4V6Z" stroke="currentColor" strokeWidth="2"/>
        </svg>
    ),
    clear: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 4H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M6 4V3H10V4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M5 4L6 13H10L11 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
    ),
    find: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="2"/>
            <path d="M12 12L15 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
    ),
    poolstats: (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Background circle */}
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" fill="none"/>
            {/* Pool instances represented as dots */}
            <circle cx="5" cy="6" r="1.5" fill="currentColor"/>
            <circle cx="8" cy="5" r="1.5" fill="currentColor"/>
            <circle cx="11" cy="6" r="1.5" fill="currentColor"/>
            <circle cx="6" cy="9" r="1.5" fill="currentColor"/>
            <circle cx="9" cy="9" r="1.5" fill="currentColor"/>
            <circle cx="7" cy="11" r="1.5" fill="currentColor"/>
            {/* Center connection point */}
            <circle cx="8" cy="8" r="1" fill="currentColor"/>
        </svg>
    )
};

export const getMenuItems = (
    currentPath,
    onMenuClick,
    formatMenuTick = 0,
    viewMenuTick = 0,
    workspaceSessionTick = 0
) => {
    void formatMenuTick;
    void viewMenuTick;
    void workspaceSessionTick;
    const isSpreadsheet = currentPath === '/spreadsheet';
    const gridVisible =
        typeof window !== 'undefined' &&
        window.SkSpreadSheet?.m_SpInterface?.m_GridVisible === true;
    const zoomPercent = Math.round(
        (typeof window !== 'undefined' ? window.SkSpreadSheet?.m_SpInterface?.m_Zoom : 1) * 100
    ) || 100;
    const isLoggedIn = Boolean(sessionStorage.getItem('jwt')) && Boolean(sessionStorage.getItem('user'));
    const userGroup = (sessionStorage.getItem('group') || '').toLowerCase();
    const isAdmin = userGroup === 'admin' || userGroup === 'admins';

    const navigationItems = [
        { id: 'virtualdisk', label: 'Virtual disk', icon: Icons.disk, to: '/' },
        { id: 'spreadsheet', label: 'Spreadsheet', icon: Icons.spreadsheet, to: '/spreadsheet', disabled: !isSpreadsheetLoaded() },
        { type: 'separator' },
        {
            id: 'debug-format-server',
            label: 'Debug FormatApi (server)',
            onClick: () => onMenuClick('debug-format-server'),
        },
        { type: 'separator' },
        { id: 'login', label: isLoggedIn ? 'Switch account' : 'Login', icon: Icons.login, to: '/login' }
    ];

    if (isAdmin) {
        navigationItems.splice(2, 0,
            { id: 'usergrid', label: 'Users', icon: Icons.user, to: '/usergrid' },
            { id: 'groupgrid', label: 'Groups', icon: Icons.group, to: '/groupgrid' },
            { id: 'relationship', label: 'Relationships', icon: Icons.group, to: '/relationship' },
            { id: 'relationshiptype', label: 'Relationship types', icon: Icons.group, to: '/relationshiptype' },
            { id: 'poolstats', label: 'Pool Stats', icon: Icons.poolstats, to: '/poolstats' }
        );
    }

    const navigationMenu = {
        id: 'navigation',
        label: 'Navigation',
        items: navigationItems,
    };

    if (!isSpreadsheet) {
        return [navigationMenu];
    }

    // Spreadsheet context: keep Navigation (server debug) + Google-Sheets-style menus.
    return [navigationMenu, ...buildSpreadsheetMenuItems(onMenuClick, { gridVisible, zoomPercent }, Icons)];
};