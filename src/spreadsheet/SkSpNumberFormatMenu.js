import React from "react";
import SkComponent from "../component/SkComponent";
import SkMenuElement from "../component/SkMenuElement";
import {
  applyNumberFormatByIndex,
  getFormatCatalogRevision,
  getNumberFormatCatalogEntries,
  isFormatCatalogLoaded,
  loadFormatCatalog,
} from "./SkNumberFormatMenu.js";
import "./SkSpreadSheet.css";

class SkSpNumberFormatMenu extends SkComponent {
  constructor(props) {
    super(props);
    this.state = { ready: isFormatCatalogLoaded(), revision: getFormatCatalogRevision() };
    this.onSelect = this.onSelect.bind(this);
    this.handleCatalogReady = this.handleCatalogReady.bind(this);
  }

  componentDidMount() {
    window.addEventListener("skFormatMenuReady", this.handleCatalogReady);
    if (!isFormatCatalogLoaded()) {
      loadFormatCatalog().then((ok) => {
        if (ok) {
          this.setState({ ready: true });
        }
      });
    }
  }

  componentWillUnmount() {
    window.removeEventListener("skFormatMenuReady", this.handleCatalogReady);
  }

  handleCatalogReady() {
    this.setState({
      ready: isFormatCatalogLoaded(),
      revision: getFormatCatalogRevision(),
    });
  }

  async onSelect(event, catalogIndex) {
    await applyNumberFormatByIndex(this.props.SpInterface, catalogIndex);
  }

  render() {
    if (!this.state.ready) {
      return <div className="SkMenuElement SkWidth100">Loading formats…</div>;
    }

    const wEntries = getNumberFormatCatalogEntries();
    if (wEntries.length === 0) {
      return <div className="SkMenuElement SkWidth100">Loading formats…</div>;
    }

    let wLastFamily = null;
    const wNodes = [];

    wEntries.forEach((entry) => {
      if (wLastFamily !== null && entry.family !== wLastFamily) {
        wNodes.push(
          <div
            key={`sep-${entry.catalogIndex}`}
            className="SkMenuWindow-separator"
          />
        );
      }
      wLastFamily = entry.family;
      wNodes.push(
        <SkMenuElement
          key={entry.catalogIndex}
          id={entry.catalogIndex}
          onSelect={this.onSelect}
          title={entry.label}
        >
          {entry.label}
        </SkMenuElement>
      );
    });

    return <div key={this.state.revision}>{wNodes}</div>;
  }
}

export default SkSpNumberFormatMenu;
