//=============================================================================
// SkTabs
// Sker Tabs
//=============================================================================
import React  from "react";
import PropTypes from "prop-types";
import SkTab from "./SkTab";
import  SkComponent from "./SkComponent";
import './SkComponent.css'
import { ReactComponent as SvgAngleLeft } from "../svg/angle-left.svg";
import { ReactComponent as SvgAngleRight } from "../svg/angle-right.svg";

class SkTabs extends SkComponent {
  static propTypes = {
    children: PropTypes.instanceOf(Array).isRequired,
    /** When true, only the tab row is rendered (e.g. workbook sheet strip — no panel below). */
    hideTabPanel: PropTypes.bool,
    /** When true, tab headers become horizontally scrollable with right-side chevrons. */
    scrollableStrip: PropTypes.bool,
    /** Sheet tab bar: chevron opens per-tab context menu. */
    onTabMenuClick: PropTypes.func,
    onTabPointerDown: PropTypes.func,
    tabDragging: PropTypes.string,
    inlineRenameSheet: PropTypes.string,
    inlineRenameValue: PropTypes.string,
    onInlineRenameChange: PropTypes.func,
    onInlineRenameCommit: PropTypes.func,
    onInlineRenameCancel: PropTypes.func,
  };

  static defaultProps = {
    hideTabPanel: false,
    scrollableStrip: false,
  };

  constructor(props) {
    super(props);
    this.m_OnChange=props.onChange;
    this.m_Position=props.position;
    this.state = {
      activeTab: this.props.children[0].props.label,
      canScrollTabLeft: false,
      canScrollTabRight: false,
    };
    this.m_Position=props.position;
    this.m_Parent=props.Parent;
    this.m_ScrollStripRef = React.createRef();
    if (this.m_Parent!==undefined) this.m_Parent.SetComponentTab(this);
  }

  componentDidMount() {
    if (this.props.scrollableStrip) {
      window.addEventListener("resize", this.updateTabStripScrollState);
      requestAnimationFrame(() => {
        this.updateTabStripScrollState();
        this.ensureActiveTabVisible();
      });
    }
  }

  componentDidUpdate(prevProps, prevState) {
    if (!this.props.scrollableStrip) return;
    const tabsChanged = prevProps.children.length !== this.props.children.length;
    const activeChanged = prevState.activeTab !== this.state.activeTab;
    if (tabsChanged || activeChanged) {
      requestAnimationFrame(() => {
        this.updateTabStripScrollState();
        this.ensureActiveTabVisible();
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("resize", this.updateTabStripScrollState);
  }

  onClickTabItem = (tab) => {
    if (this.m_Parent?.consumeTabClickSuppress?.()) {
      return;
    }
    if (this.m_OnChange!==undefined) this.m_OnChange(tab);
    this.setState({ activeTab: tab });
  };

  onDoubleClickTabItem = (tab) => {
    if (typeof this.props.onDoubleClick === "function") {
      this.props.onDoubleClick(tab);
    }
  };

  ensureActiveTabVisible = () => {
    if (!this.props.scrollableStrip) return;
    const el = this.m_ScrollStripRef.current;
    if (!el) return;
    const active = el.querySelector(".SkTab-list-active");
    if (!active) return;
    active.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  };

  updateTabStripScrollState = () => {
    const el = this.m_ScrollStripRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const tol = 2;
    const canLeft = el.scrollLeft > tol;
    const canRight = el.scrollLeft < maxScroll - tol;
    if (
      canLeft !== this.state.canScrollTabLeft ||
      canRight !== this.state.canScrollTabRight
    ) {
      this.setState({
        canScrollTabLeft: canLeft,
        canScrollTabRight: canRight,
      });
    }
  };

  scrollTabsLeft = () => {
    const el = this.m_ScrollStripRef.current;
    if (!el) return;
    const step = Math.max(80, Math.floor(el.clientWidth * 0.45));
    el.scrollLeft -= step;
    requestAnimationFrame(() => this.updateTabStripScrollState());
  };

  scrollTabsRight = () => {
    const el = this.m_ScrollStripRef.current;
    if (!el) return;
    const step = Math.max(80, Math.floor(el.clientWidth * 0.45));
    el.scrollLeft += step;
    requestAnimationFrame(() => this.updateTabStripScrollState());
  };

  renderTabList = (
    children,
    activeTab,
    onClickTabItem,
    onDoubleClickTabItem,
    onTabMenuClick,
    onTabPointerDown,
    tabDragging,
    inlineRenameSheet,
    inlineRenameValue,
    onInlineRenameChange,
    onInlineRenameCommit,
    onInlineRenameCancel,
  ) => {
    return (
      <div className="SkTab-list">
        {children.map((child) => {
          const { label } = child.props;
          let wStyle = {
            borderTopRightRadius : "25%"
          };

          if (this.m_Position==="bottom") {
            wStyle = {
              borderBottomRightRadius : "25%"
            };
          }

          return (
            <SkTab 
              style={wStyle}
              activeTab={activeTab}
              key={label}
              label={label}
              onClick={onClickTabItem}
              onDoubleClick={onDoubleClickTabItem}
              onTabMenuClick={onTabMenuClick}
              onTabPointerDown={onTabPointerDown}
              tabDragging={tabDragging}
              inlineRenameSheet={inlineRenameSheet}
              inlineRenameValue={inlineRenameValue}
              onInlineRenameChange={onInlineRenameChange}
              onInlineRenameCommit={onInlineRenameCommit}
              onInlineRenameCancel={onInlineRenameCancel}
              title="Drag to reorder · right-click or ▼ for menu · double-click to rename"
            />
          );
        })}
      </div>
    );
  };

  SetTab(tab) {
   this.setState({ activeTab : tab})
  }

  render() {
    const {
      onClickTabItem,
      onDoubleClickTabItem,
      props: {
        children,
        hideTabPanel,
        scrollableStrip,
        onTabMenuClick,
        onTabPointerDown,
        tabDragging,
        inlineRenameSheet,
        inlineRenameValue,
        onInlineRenameChange,
        onInlineRenameCommit,
        onInlineRenameCancel,
      },
      state: { activeTab, canScrollTabLeft, canScrollTabRight },
    } = this;

    return (
      <div className={`SkTabs${hideTabPanel ? ' SkTabs--stripOnly' : ''}`}>
        {scrollableStrip ? (
          <div className="SkTabs-strip">
            <div
              ref={this.m_ScrollStripRef}
              className="SkTabs-scroll"
              onScroll={this.updateTabStripScrollState}
            >
              {this.renderTabList(
                children,
                activeTab,
                onClickTabItem,
                onDoubleClickTabItem,
                onTabMenuClick,
                onTabPointerDown,
                tabDragging,
                inlineRenameSheet,
                inlineRenameValue,
                onInlineRenameChange,
                onInlineRenameCommit,
                onInlineRenameCancel,
              )}
            </div>
            <div className="SkTabs-scrollNavGroup">
              <div
                className={
                  "SkTabs-scrollNav" +
                  (canScrollTabLeft ? "" : " SkTabs-scrollNav--disabled")
                }
                title="Previous tabs"
                role="button"
                tabIndex={0}
                onClick={canScrollTabLeft ? this.scrollTabsLeft : undefined}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && canScrollTabLeft) {
                    e.preventDefault();
                    this.scrollTabsLeft();
                  }
                }}
              >
                <SvgAngleLeft className={"SkSvg" + (canScrollTabLeft ? "" : " disabled")} />
              </div>
              <div
                className={
                  "SkTabs-scrollNav" +
                  (canScrollTabRight ? "" : " SkTabs-scrollNav--disabled")
                }
                title="Next tabs"
                role="button"
                tabIndex={0}
                onClick={canScrollTabRight ? this.scrollTabsRight : undefined}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === " ") && canScrollTabRight) {
                    e.preventDefault();
                    this.scrollTabsRight();
                  }
                }}
              >
                <SvgAngleRight className={"SkSvg" + (canScrollTabRight ? "" : " disabled")} />
              </div>
            </div>
          </div>
        ) : (
          this.renderTabList(
            children,
            activeTab,
            onClickTabItem,
            onDoubleClickTabItem,
            onTabMenuClick,
            onTabPointerDown,
            tabDragging,
            inlineRenameSheet,
            inlineRenameValue,
            onInlineRenameChange,
            onInlineRenameCommit,
            onInlineRenameCancel,
          )
        )}
        {!hideTabPanel && (
          <div className="SkTab-content">
            {children.map((child) => {
              if (child.props.label !== activeTab) return undefined;
              return child.props.children;
            })}
          </div>
        )}
      </div>
    );
  }
}

export default SkTabs;