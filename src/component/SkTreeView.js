import React from 'react';
import PropTypes from 'prop-types';
import SkComponent from './SkComponent';
import './SkComponent.css';


class SkTreeNode extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            isExpanded: false
        };
        this.nodeRef = React.createRef();
    }

    componentDidUpdate(prevProps) {
        if (!prevProps.isSelected && this.props.isSelected) {
            if (this.nodeRef.current) {
                this.nodeRef.current.focus();
            }
        }
    }

    handleClick = () => {
        if (this.props.onSelect) {
            this.props.onSelect(this.props.node);
        }
    }

    handleContextMenu = (e) => {
        if (!this.props.onContextMenu) return;
        e.preventDefault();
        e.stopPropagation();
        this.props.onContextMenu(this.props.node, e);
    }

    toggleExpand = (e) => {
        e.stopPropagation();
        this.setState(prev => ({ isExpanded: !prev.isExpanded }));
    }

    getVisibleNodes = () => {
        const { flatNodes } = this.props;
        let visibleNodes = [];
        
        for (let node of flatNodes) {
            let isVisible = true;
            let parentChain = [];
            let currentNode = node;
            
            // Build parent chain
            while (currentNode.parent) {
                parentChain.push(currentNode.parent);
                currentNode = currentNode.parent;
            }
            
            // Check if all parents are expanded
            for (const parentNode of parentChain) {
                const parentElement = document.querySelector(`[data-node-id="${parentNode.id}"]`);
                if (parentElement && !parentElement.getAttribute('data-expanded')) {
                    isVisible = false;
                    break;
                }
            }
            
            if (isVisible) {
                visibleNodes.push(node);
            }
        }
        
        return visibleNodes;
    }

    handleKeyDown = (e) => {
        const hasChildren = this.props.node.children && this.props.node.children.length > 0;

        switch (e.key) {
            case 'ArrowUp':
            case 'ArrowDown':
                e.preventDefault();
                e.stopPropagation();
                const { flatNodes, selectedNode } = this.props;
                if (!selectedNode) return;

                const currentIndex = flatNodes.findIndex(node => node === selectedNode);
                if (currentIndex === -1) return;

                let nextIndex = currentIndex;
                if (e.key === 'ArrowUp') {
                    nextIndex = Math.max(0, currentIndex - 1);
                } else {
                    // If the current node has children and is collapsed, expand it
                    if (hasChildren && !this.state.isExpanded && this.props.isSelected) {
                        this.setState({ isExpanded: true });
                        return; // Stop here so the user sees the children before moving down
                    }
                    nextIndex = Math.min(flatNodes.length - 1, currentIndex + 1);
                }

                if (nextIndex !== currentIndex) {
                    const nextNode = flatNodes[nextIndex];
                    this.props.onSelect(nextNode);
                }
                break;

            case '+':
                if (hasChildren) {
                    this.setState({ isExpanded: true });
                }
                break;
            case '-':
                if (hasChildren) {
                    this.setState({ isExpanded: false });
                }
                break;
            case 'ArrowRight':
                if (hasChildren) {
                    this.setState({ isExpanded: true });
                }
                break;
            case 'ArrowLeft':
                this.setState({ isExpanded: false });
                break;
            case 'Enter':
            case 'NumpadEnter':
                e.preventDefault();
                e.stopPropagation();
                if (!this.props.isSelected) return;
                if (this.props.onOpen) {
                    this.props.onOpen(this.props.node);
                } else if (hasChildren) {
                    this.setState({ isExpanded: true });
                }
                break;
            default:
                break;
        }
    }

    render() {
        const { node, level = 0 } = this.props;
        const hasChildren = node.children && node.children.length > 0;
        
        return (
            <div className="SkTreeNode">
                <div 
                    ref={this.nodeRef}
                    className={`SkTreeNode-content ${this.props.isSelected ? 'SkTreeNode-selected' : ''}`}
                    style={{ paddingLeft: `${level * 20}px` }}
                    tabIndex={this.props.isSelected ? 0 : -1}
                    onClick={this.handleClick}
                    onContextMenu={this.handleContextMenu}
                    onKeyDown={this.handleKeyDown}
                    data-node-id={node.id}
                    data-expanded={this.state.isExpanded}
                >
                    {hasChildren && (
                        <span 
                            className="SkTreeNode-toggle"
                            onClick={this.toggleExpand}
                        >
                            {this.state.isExpanded ? '▼' : '▶'}
                        </span>
                    )}
                    <span className="SkTreeNode-label">
                        {node.label}
                    </span>
                </div>
                {hasChildren && this.state.isExpanded && (
                    <div className="SkTreeNode-children">
                        {node.children.map((child, index) => (
                            <SkTreeNode
                                key={index}
                                node={child}
                                level={level + 1}
                                onSelect={this.props.onSelect}
                                onOpen={this.props.onOpen}
                                onContextMenu={this.props.onContextMenu}
                                isSelected={this.props.selectedNode === child}
                                selectedNode={this.props.selectedNode}
                                flatNodes={this.props.flatNodes}
                            />
                        ))}
                    </div>
                )}
            </div>
        );
    }
}

class SkTreeView extends SkComponent {
    constructor(props) {
        super(props);
        this.state = {
            selectedNode: null,
            flatNodes: []
        };
    }

    componentDidMount() {
        const flatNodes = this.getFlatNodes(this.props.data);
        this.setState({ 
            flatNodes,
            selectedNode: flatNodes.length > 0 ? flatNodes[0] : null 
        }, () => {
            if (this.props.onSelect && this.state.selectedNode) {
                this.props.onSelect(this.state.selectedNode);
            }
        });
    }

    getFlatNodes(nodes) {
        let result = [];
        nodes.forEach(node => {
            result.push(node);
            if (node.children && node.children.length > 0) {
                result = result.concat(this.getFlatNodes(node.children));
            }
        });
        return result;
    }

    handleSelect = (node) => {
        this.setState({ selectedNode: node }, () => {
            if (this.props.onSelect) {
                this.props.onSelect(node);
            }
        });
    }

    render() {
        return (
            <div 
                className="SkTreeView" 
                ref={this.m_Ref}
                tabIndex={0}
            >
                {this.props.data.map((node, index) => (
                    <SkTreeNode
                        key={index}
                        node={node}
                        onSelect={this.handleSelect}
                        onOpen={this.props.onOpen}
                        onContextMenu={this.props.onContextMenu}
                        isSelected={this.state.selectedNode === node}
                        selectedNode={this.state.selectedNode}
                        flatNodes={this.state.flatNodes}
                    />
                ))}
            </div>
        );
    }
}

SkTreeView.propTypes = {
    data: PropTypes.arrayOf(PropTypes.shape({
        label: PropTypes.string.isRequired,
        children: PropTypes.array
    })).isRequired,
    onSelect: PropTypes.func,
    /** Fired on Enter — same role as double-click (open file, expand folder, etc.). */
    onOpen: PropTypes.func,
    /** Fired on right-click when the host wants a custom context menu. */
    onContextMenu: PropTypes.func,
};

export default SkTreeView; 