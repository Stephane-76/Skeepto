// Guided tour step definitions.
// Each step targets an element via a data-tour attribute, so DOM changes do
// not break selectors. Add/remove items here to update the tour without
// touching the UI components.

import React from 'react';
import { SkTourActionsMenuContent } from './SkTourActionsMenuContent.js';

export const tourSteps = [
  {
    target: 'body',
    placement: 'center',
    title: 'Welcome to Sker',
    content:
      "Let us walk you through the app in about a minute. You can skip or replay this tour at any time.",
    disableBeacon: true,
  },
  {
    target: '[data-tour="toggle-menu"]',
    title: 'Side menu',
    content:
      "Use this button to open or close the navigation panel on the left, where you can access every section of the app.",
    placement: 'bottom-start',
  },
  {
    target: '[data-tour="virtualdisk"]',
    title: 'Virtual disk',
    content:
      "Store and organize your .sker, .html and other files. This is your starting point to open a document.",
    placement: 'right',
    route: '/virtualdisk',
    autoClick: true,
    autoClickDelay: 900,
    demoFile: '/share/Budget.sker',
    demoFileSelectDelay: 500,
    demoFileOpenDelay: null,
  },
  {
    target: '[data-tour="vd-actions"]',
    title: 'Actions button',
    content:
      "Every file operation is grouped here. Click Actions or right-click the tree — we open the full menu on the next step.",
    placement: 'left',
  },
  {
    target: '[data-tour="vd-actions-panel"]',
    title: 'Actions menu',
    content: <SkTourActionsMenuContent />,
    placement: 'left',
    openActionsMenu: true,
  },
  {
    target: '[data-path="/share/Budget.sker"]',
    title: 'Open the file',
    content:
      "Double-click any .sker or .html file to open it in the editor. Click Next when you're ready and we will open a spreadsheet for you.",
    placement: 'right',
    closeActionsMenu: true,
    openFileOnNext: '/share/Budget.sker',
  },
  {
    target: '[data-tour="spreadsheet"]',
    title: 'Spreadsheet',
    content:
      "The Sker spreadsheet module: formulas, conditional formatting, validation rules and much more. Enabled once a .sker file is open.",
    placement: 'right',
    route: '/spreadsheet',
    autoClick: true,
    autoClickDelay: 900,
  },
  {
    target: '[data-tour="top-menu"]',
    title: 'Menu bar',
    content:
      "All contextual actions (file, edit, insert, format, tools...) are available right here.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="active-file-path"]',
    title: 'Active file',
    content:
      "The path of the document you are editing is always shown here so you know which file is open.",
    placement: 'bottom',
  },
  {
    target: '[data-tour="texteditor"]',
    title: 'HTML editor',
    content:
      "Edit .html files from the virtual disk. This entry is enabled after you open an HTML document.",
    placement: 'right',
  },
  {
    target: '[data-tour="user"]',
    title: 'Users',
    content: 'Manage user accounts and their permissions.',
    placement: 'right',
    route: '/user',
    autoClick: true,
    autoClickDelay: 900,
  },
  {
    target: '[data-tour="group"]',
    title: 'Groups',
    content: 'Organize users into groups for sharing and collaboration.',
    placement: 'right',
    route: '/group',
    autoClick: true,
    autoClickDelay: 900,
  },
  {
    target: '[data-tour="poolstats"]',
    title: 'Pool stats',
    content:
      "Live metrics of the database connection pool: active and idle connections, queue depth and recent SQL latency.",
    placement: 'right',
    route: '/poolstats',
    autoClick: true,
    autoClickDelay: 900,
  },
  {
    target: '[data-tour="user-info"]',
    title: 'Your account',
    content:
      "Your session name, logout button and theme toggle are always available here.",
    placement: 'left',
  },
  {
    target: '[data-tour="guided-tour"]',
    title: 'Replay the tour',
    content:
      "Come back here anytime to replay this guided tour.",
    placement: 'right',
  },
  {
    target: 'body',
    placement: 'center',
    title: "You're all set!",
    content:
      "You can replay this tour anytime from the Guided tour entry in the side menu. Enjoy exploring Sker!",
  },
];

export default tourSteps;
