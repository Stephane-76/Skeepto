import React from 'react';
import { Link } from 'react-router-dom';
import { SkComponent } from './SkComponent';
import './SkComponent.css';


export class SkMenu extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            activeMenu: null,
            menuPosition: { x: 0, y: 0 },
            activeSubmenu: null,
            submenuPosition: { x: 0, y: 0 },
            menuFocusIndex: -1,
            submenuFocusIndex: -1,
            barFocusIndex: -1,
        };
        this.menuRef = React.createRef();
        this.submenuTimeout = null;
    }

    handleMenuClick = (menuId, event) => {
        event.preventDefault();
        event.stopPropagation();
        
        const rect = event.currentTarget.getBoundingClientRect();
        const newState = {
            menuPosition: {
                x: rect.left,
                y: rect.bottom
            }
        };

        // Clicking the same menu closes it
        if (this.state.activeMenu === menuId) {
            newState.activeMenu = null;
            newState.activeSubmenu = null;
            newState.menuFocusIndex = -1;
            newState.submenuFocusIndex = -1;
            newState.barFocusIndex = -1;
        } else {
            newState.activeMenu = menuId;
            newState.menuFocusIndex = 0;
            newState.submenuFocusIndex = -1;
            newState.barFocusIndex = this.props.items.findIndex((i) => i.id === menuId);
        }

        this.setState(newState);
    }

    handleClickOutside = (event) => {
        if (!this.menuRef.current || this.menuRef.current.contains(event.target)) {
            return;
        }
        this.closeAllMenus();
    }

    closeAllMenus = () => {
        this.setState({
            activeMenu: null,
            activeSubmenu: null,
            menuPosition: { x: 0, y: 0 },
            submenuPosition: { x: 0, y: 0 },
            menuFocusIndex: -1,
            submenuFocusIndex: -1,
            barFocusIndex: -1,
        });
    }

    getFocusableMenuItems(items) {
        return (items || []).filter(
            (item) =>
                item.type !== 'separator' &&
                item.type !== 'label' &&
                !item.disabled
        );
    }

    focusSpreadsheetGridAfterMenuAction() {
        if (typeof window === 'undefined') return;
        if (window.location.pathname !== '/spreadsheet') return;
        try {
            window.SkSpreadSheet?.m_SpInterface?.focusGridCanvas?.();
        } catch (e) {
            console.warn('focusSpreadsheetGridAfterMenuAction:', e);
        }
    }

    openMenuById(menuId, barRect) {
        const newState = {
            activeMenu: menuId,
            activeSubmenu: null,
            menuFocusIndex: 0,
            submenuFocusIndex: -1,
            barFocusIndex: this.props.items.findIndex((i) => i.id === menuId),
        };
        if (barRect) {
            newState.menuPosition = { x: barRect.left, y: barRect.bottom };
        }
        this.setState(newState);
    }

    openSubmenuForItem(itemId, anchorRect) {
        this.setState({
            activeSubmenu: itemId,
            submenuFocusIndex: 0,
            submenuPosition: anchorRect
                ? { x: anchorRect.right - 4, y: anchorRect.top }
                : this.state.submenuPosition,
        });
    }

    moveMainMenuFocus(delta, focusableMain) {
        if (!focusableMain.length) return;
        const current = this.state.menuFocusIndex;
        let next = current < 0 ? 0 : current + delta;
        if (next < 0) next = focusableMain.length - 1;
        if (next >= focusableMain.length) next = 0;
        this.setState({
            menuFocusIndex: next,
            activeSubmenu: null,
            submenuFocusIndex: -1,
        });
    }

    moveListFocus(delta, list, indexKey, setExtra) {
        if (!list.length) return;
        const current = this.state[indexKey];
        let next = current < 0 ? 0 : current + delta;
        if (next < 0) next = list.length - 1;
        if (next >= list.length) next = 0;
        this.setState({ [indexKey]: next, ...setExtra });
    }

    /** Move highlight along the top menu bar (File, Edit, …). */
    moveTopLevelBar(delta, openDropdown) {
        const { items = [] } = this.props;
        if (!items.length) return;

        const { activeMenu, barFocusIndex } = this.state;
        let current = activeMenu
            ? items.findIndex((i) => i.id === activeMenu)
            : barFocusIndex;
        if (current < 0) current = 0;

        let next = current + delta;
        if (next < 0) next = items.length - 1;
        if (next >= items.length) next = 0;

        const barItems = this.menuRef.current?.querySelectorAll('.SkMenuBarItem');
        const barEl = barItems?.[next];

        if (openDropdown) {
            const rect = barEl?.getBoundingClientRect?.();
            this.openMenuById(items[next].id, rect);
        } else {
            this.setState({
                barFocusIndex: next,
                activeMenu: null,
                activeSubmenu: null,
                menuFocusIndex: -1,
                submenuFocusIndex: -1,
            });
        }

        if (barEl && typeof barEl.focus === 'function') {
            requestAnimationFrame(() => barEl.focus({ preventScroll: true }));
        }
    }

    isMenuBarKeyboardContext() {
        const { activeMenu, barFocusIndex } = this.state;
        if (activeMenu) return true;
        if (barFocusIndex >= 0) return true;
        const active = document.activeElement;
        return (
            active &&
            this.menuRef.current?.contains(active) &&
            active.closest?.('.SkMenuBar')
        );
    }

    activateMenuItem(item) {
        if (!item || item.disabled) return;
        if (this.hasMenuChildren(item)) {
            const el = this.menuRef.current?.querySelector(
                `[data-menu-item-id="${item.id}"]`
            );
            const rect = el?.getBoundingClientRect?.();
            this.openSubmenuForItem(item.id, rect);
            return;
        }
        if (item.to) {
            this.closeAllMenus();
            if (typeof window.__skerNavigate === 'function') {
                window.__skerNavigate(item.to);
            }
            this.focusSpreadsheetGridAfterMenuAction();
            return;
        }
        this.fireItemAction(item);
    }

    handleMenuKeyDown = (event) => {
        const { items = [] } = this.props;
        const {
            activeMenu,
            activeSubmenu,
            menuFocusIndex,
            submenuFocusIndex,
            barFocusIndex,
        } = this.state;

        if (event.key === 'F10') {
            event.preventDefault();
            if (items.length === 0) return;
            if (activeMenu) {
                this.closeAllMenus();
                return;
            }
            if (barFocusIndex < 0) {
                this.moveTopLevelBar(0, false);
                return;
            }
            const barItem = this.menuRef.current?.querySelectorAll('.SkMenuBarItem')[barFocusIndex];
            const rect = barItem?.getBoundingClientRect?.();
            this.openMenuById(items[barFocusIndex].id, rect);
            return;
        }

        const activeMenuItems = activeMenu
            ? (items.find((item) => item.id === activeMenu)?.items || [])
            : [];
        const focusableMain = this.getFocusableMenuItems(activeMenuItems);

        if (!activeMenu) {
            if (barFocusIndex >= 0 && items.length > 0) {
                if (event.key === 'ArrowDown' || event.key === 'Enter') {
                    event.preventDefault();
                    const barItem = this.menuRef.current?.querySelectorAll('.SkMenuBarItem')[barFocusIndex];
                    const rect = barItem?.getBoundingClientRect?.();
                    this.openMenuById(items[barFocusIndex].id, rect);
                    return;
                }
            }
            return;
        }

        if (activeSubmenu) {
            const subItems = this.findSubmenuItems(activeMenuItems, activeSubmenu) || [];
            const focusableSub = this.getFocusableMenuItems(subItems);
            switch (event.key) {
                case 'Escape':
                    event.preventDefault();
                    event.stopPropagation();
                    this.setState({ activeSubmenu: null, submenuFocusIndex: -1 });
                    break;
                case 'ArrowUp':
                    event.preventDefault();
                    event.stopPropagation();
                    this.moveListFocus(-1, focusableSub, 'submenuFocusIndex');
                    break;
                case 'ArrowDown':
                    event.preventDefault();
                    event.stopPropagation();
                    this.moveListFocus(1, focusableSub, 'submenuFocusIndex');
                    break;
                case 'Enter':
                    event.preventDefault();
                    event.stopPropagation();
                    if (submenuFocusIndex >= 0 && focusableSub[submenuFocusIndex]) {
                        this.activateMenuItem(focusableSub[submenuFocusIndex]);
                    }
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    event.stopPropagation();
                    this.setState({ activeSubmenu: null, submenuFocusIndex: -1 });
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    event.stopPropagation();
                    if (submenuFocusIndex < 0 && focusableSub.length > 0) {
                        this.setState({ submenuFocusIndex: 0 });
                    }
                    break;
                default:
                    break;
            }
            return;
        }

        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            if (this.isMenuBarKeyboardContext()) {
                if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    event.stopPropagation();
                    this.moveTopLevelBar(-1, !!activeMenu);
                    return;
                }
                if (event.key === 'ArrowRight') {
                    const item =
                        activeMenu && menuFocusIndex >= 0
                            ? focusableMain[menuFocusIndex]
                            : null;
                    if (item?.items) {
                        event.preventDefault();
                        event.stopPropagation();
                        const el = this.menuRef.current?.querySelector(
                            `[data-menu-item-id="${item.id}"]`
                        );
                        const rect = el?.getBoundingClientRect?.();
                        this.openSubmenuForItem(item.id, rect);
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    this.moveTopLevelBar(1, !!activeMenu);
                    return;
                }
            }
        }

        switch (event.key) {
            case 'Escape':
                event.preventDefault();
                this.closeAllMenus();
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.moveMainMenuFocus(-1, focusableMain);
                break;
            case 'ArrowDown':
                event.preventDefault();
                this.moveMainMenuFocus(1, focusableMain);
                break;
            case 'Enter':
                event.preventDefault();
                if (menuFocusIndex >= 0 && focusableMain[menuFocusIndex]) {
                    this.activateMenuItem(focusableMain[menuFocusIndex]);
                }
                break;
            default:
                break;
        }
    }

    /** Resolve children: static items[] or live getItems() (format catalog). */
    resolveMenuChildren(item) {
        if (!item) {
            return null;
        }
        if (typeof item.getItems === 'function') {
            try {
                const wLive = item.getItems();
                return Array.isArray(wLive) ? wLive : null;
            } catch (error) {
                console.error('SkMenu getItems failed', item.id, error);
                return null;
            }
        }
        return item.items || null;
    }

    hasMenuChildren(item) {
        if (!item) {
            return false;
        }
        if (typeof item.getItems === 'function') {
            return true;
        }
        return Array.isArray(item.items) && item.items.length > 0;
    }

    /** Walk nested menu trees to resolve flyout contents at any depth. */
    findSubmenuItems(items, targetId) {
        if (!items) return null;
        for (const item of items) {
            if (item.id === targetId) {
                const wChildren = this.resolveMenuChildren(item);
                if (wChildren) {
                    return wChildren;
                }
            }
            const wNestedParent = this.resolveMenuChildren(item);
            if (wNestedParent) {
                const nested = this.findSubmenuItems(wNestedParent, targetId);
                if (nested) return nested;
            }
        }
        return null;
    }

    handleFormatMenuReady = () => {
        // Live format submenus (getItems) must re-render when WASM catalog arrives.
        if (this.state.activeMenu || this.state.activeSubmenu) {
            this.forceUpdate();
        }
    }

    componentDidMount() {
        //console.log( "SkMenu::componentDidMount()");
        document.addEventListener('click', this.handleClickOutside, true);
        document.addEventListener('keydown', this.handleMenuKeyDown, true);
        window.addEventListener('skFormatMenuReady', this.handleFormatMenuReady);
    }

    componentWillUnmount() {
        document.removeEventListener('click', this.handleClickOutside, true);
        document.removeEventListener('keydown', this.handleMenuKeyDown, true);
        window.removeEventListener('skFormatMenuReady', this.handleFormatMenuReady);
        if (this.submenuTimeout) {
            clearTimeout(this.submenuTimeout);
        }
    }

    handleBarItemMouseEnter = (index, menuId, event) => {
        const { activeMenu } = this.state;
        if (activeMenu) {
            if (activeMenu === menuId) return;
            const rect = event.currentTarget.getBoundingClientRect();
            this.openMenuById(menuId, rect);
            return;
        }
        if (this.state.barFocusIndex !== index) {
            this.setState({ barFocusIndex: index });
        }
    }

    handleBarMouseLeave = () => {
        if (!this.state.activeMenu && this.state.barFocusIndex >= 0) {
            this.setState({ barFocusIndex: -1 });
        }
    }

    handleSubmenuEnter = (itemId, event, focusIndex) => {
        event.stopPropagation();
        if (this.submenuTimeout) {
            clearTimeout(this.submenuTimeout);
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const nextState = {
            activeSubmenu: itemId,
            submenuPosition: {
                x: rect.right - 4,
                y: rect.top,
            },
        };
        if (typeof focusIndex === 'number' && focusIndex >= 0) {
            nextState.menuFocusIndex = focusIndex;
            nextState.submenuFocusIndex = -1;
        }
        this.setState(nextState);
    }

    handleItemMouseEnter = (item, focusIndex, listKey, event) => {
        if (!item || item.disabled || item.type === 'separator' || item.type === 'label') {
            return;
        }
        if (this.submenuTimeout) {
            clearTimeout(this.submenuTimeout);
        }

        if (listKey === 'menuFocusIndex') {
            if (this.hasMenuChildren(item)) {
                this.handleSubmenuEnter(item.id, event, focusIndex);
                return;
            }
            this.setState({
                menuFocusIndex: focusIndex,
                activeSubmenu: null,
                submenuFocusIndex: -1,
            });
            return;
        }

        if (listKey === 'submenuFocusIndex') {
            this.setState({ submenuFocusIndex: focusIndex });
        }
    }

    handleSubmenuClick = (itemId, event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.state.activeSubmenu === itemId) {
            this.setState({ activeSubmenu: null });
            return;
        }
        this.handleSubmenuEnter(itemId, event);
    }

    handleSubmenuLeave = (event) => {
        event.stopPropagation();
        // Delay before closing the submenu
        this.submenuTimeout = setTimeout(() => {
            this.setState({ activeSubmenu: null });
        }, 100);
    }

    handleSubmenuMouseEnter = () => {
        if (this.submenuTimeout) {
            clearTimeout(this.submenuTimeout);
        }
    }

    handleSubmenuMouseLeave = () => {
        this.submenuTimeout = setTimeout(() => {
            this.setState({ activeSubmenu: null });
        }, 200);
    }

    stopMenuPointer = (event) => {
        event.stopPropagation();
    }

    fireItemAction = (item) => {
        if (item.onClick) {
            item.onClick();
        } else if (this.props.onAction && item.id) {
            this.props.onAction(item.id);
        }
        this.closeAllMenus();
        this.focusSpreadsheetGridAfterMenuAction();
    }

    runMenuAction = (action) => {
        if (typeof action === 'function') {
            action();
        }
        this.closeAllMenus();
    }

    isItemFocused(item, focusIndex, listKey) {
        if (
            focusIndex < 0 ||
            this.state[listKey] !== focusIndex ||
            item.disabled ||
            item.type === 'separator' ||
            item.type === 'label'
        ) {
            return false;
        }
        // When a flyout item is focused, keep the parent row un-outlined to avoid double borders.
        if (
            listKey === 'menuFocusIndex' &&
            this.hasMenuChildren(item) &&
            this.state.activeSubmenu === item.id &&
            this.state.submenuFocusIndex >= 0
        ) {
            return false;
        }
        return true;
    }

    renderMenuItem = (item, options = {}) => {
        const { focusIndex = -1, listKey = 'menuFocusIndex' } = options;
        const focused = this.isItemFocused(item, focusIndex, listKey);

        if (item.type === 'separator') {
            return <div key={`separator-${Math.random()}`} className="SkMenuWindow-separator" />;
        }

        if (item.type === 'label') {
            return (
                <div key={`label-${item.label}`} className="SkMenuWindow-label">
                    {item.label}
                </div>
            );
        }

        if (this.hasMenuChildren(item)) {
            return (
                <div 
                    key={item.id}
                    data-menu-item-id={item.id}
                    className={`SkMenuWindow-item-with-submenu ${focused ? 'SkMenuWindow-item-focused' : ''} ${item.disabled ? 'disabled' : ''}`}
                    onMouseEnter={(e) => !item.disabled && this.handleItemMouseEnter(item, focusIndex, listKey, e)}
                    onMouseLeave={(e) => !item.disabled && this.handleSubmenuLeave(e)}
                    onMouseDown={this.stopMenuPointer}
                    onClick={(e) => !item.disabled && this.handleSubmenuClick(item.id, e)}
                >
                    <div className="SkMenuWindow-item">
                        {item.icon && <span className="SkMenuWindow-item-icon">{item.icon}</span>}
                        {item.label}
                        <span style={{ marginLeft: 'auto' }}>▶</span>
                    </div>
                </div>
            );
        }

        const menuContent = (
            <>
                {item.icon && <span className="SkMenuWindow-item-icon">{item.icon}</span>}
                {item.label}
                {item.checked === true || item.checked === false ? (
                    <span className="SkMenuWindow-item-check" aria-hidden="true">
                        {item.checked ? '✓' : ''}
                    </span>
                ) : null}
            </>
        );

        if (item.to) {
            return (
                <Link 
                    key={item.id}
                    data-menu-item-id={item.id}
                    to={item.to}
                    className={`SkMenuWindow-item ${focused ? 'SkMenuWindow-item-focused' : ''} ${item.disabled ? 'disabled' : ''}`}
                    style={{ textDecoration: 'none', color: 'inherit' }}
                    onMouseEnter={(e) => !item.disabled && this.handleItemMouseEnter(item, focusIndex, listKey, e)}
                    onMouseDown={this.stopMenuPointer}
                    onClick={(e) => {
                        if (item.disabled) {
                            e.preventDefault();
                            return;
                        }
                        this.closeAllMenus();
                    }}
                >
                    {menuContent}
                </Link>
            );
        }

        return (
            <div 
                key={item.id}
                data-menu-item-id={item.id}
                className={`SkMenuWindow-item ${focused ? 'SkMenuWindow-item-focused' : ''} ${item.disabled ? 'disabled' : ''}`}
                onMouseEnter={(e) => !item.disabled && this.handleItemMouseEnter(item, focusIndex, listKey, e)}
                onMouseDown={this.stopMenuPointer}
                onClick={(e) => {
                    if (item.disabled) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (item.onClick || (this.props.onAction && item.id)) {
                        this.fireItemAction(item);
                    }
                }}
            >
                {menuContent}
            </div>
        );
    }

    renderMenuList(items, listKey) {
        const focusable = this.getFocusableMenuItems(items);
        return items.map((item) => {
            const mappedIndex = focusable.findIndex((f) => f.id === item.id);
            return this.renderMenuItem(item, {
                focusIndex: mappedIndex,
                listKey,
            });
        });
    }

    render() {
        const { items = [] } = this.props;
        const { activeMenu, menuPosition, activeSubmenu, submenuPosition, barFocusIndex } = this.state;

        const activeMenuItems = items.find(item => item.id === activeMenu)?.items || [];
        const activeSubmenuItems = this.findSubmenuItems(activeMenuItems, activeSubmenu) || [];

        return (
            <div className="SkMenu" ref={this.menuRef}>
                <div className="SkMenuBar" role="menubar" onMouseLeave={this.handleBarMouseLeave}>
                    {items.map((item, index) => (
                        <div
                            key={item.id}
                            role="menuitem"
                            tabIndex={activeMenu === item.id || barFocusIndex === index ? 0 : -1}
                            className={`SkMenuBarItem ${activeMenu === item.id ? 'SkMenuBarItem-active' : ''} ${barFocusIndex === index && !activeMenu ? 'SkMenuBarItem-focused' : ''}`}
                            onMouseEnter={(e) => this.handleBarItemMouseEnter(index, item.id, e)}
                            onClick={(e) => this.handleMenuClick(item.id, e)}
                            onFocus={() => {
                                this.setState({ barFocusIndex: index });
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const delta = e.key === 'ArrowRight' ? 1 : -1;
                                    this.moveTopLevelBar(delta, !!this.state.activeMenu);
                                }
                            }}
                        >
                            {item.label}
                        </div>
                    ))}
                </div>
                {activeMenu && (
                    <div 
                        className="SkMenuWindow"
                        role="menu"
                        style={{
                            left: menuPosition.x,
                            top: menuPosition.y
                        }}
                    >
                        {this.renderMenuList(activeMenuItems, 'menuFocusIndex')}
                    </div>
                )}
                {activeSubmenu && (
                    <div 
                        className="SkMenuWindow-submenu"
                        role="menu"
                        style={{
                            left: submenuPosition.x,
                            top: submenuPosition.y
                        }}
                        onMouseEnter={this.handleSubmenuMouseEnter}
                        onMouseLeave={this.handleSubmenuMouseLeave}
                        onMouseDown={this.stopMenuPointer}
                        onClick={(e) => e.stopPropagation()}
                    >
                        {this.renderMenuList(activeSubmenuItems, 'submenuFocusIndex')}
                    </div>
                )}
            </div>
        );
    }
}

export default SkMenu; 