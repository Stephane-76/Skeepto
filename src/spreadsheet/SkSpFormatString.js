import React from "react";
import SkComponent from "../component/SkComponent";
import './SkSpreadSheet.css'
import SkMenuElement from "../component/SkMenuElement";


class SkSpFormatString extends SkComponent {
 
    constructor(props) {
        super(props);
        this.m_SpInterface=props.SpInterface;
        console.log( "SkSpFormatString::constructor");
        this.state = ({ 
            formattedValues: []
        });
        this.m_FormatString = [];
        this.m_FormatSections = [];
        this.onSelect=this.onSelect.bind(this);
        this.LoadFormat().then(() => {
            this.loadFormattedValues();
        });
    }

    resolveFamilies(props) {
        if (Array.isArray(props.Families) && props.Families.length > 0) {
            return props.Families;
        }
        if (typeof props.Family === "string" && props.Family.length > 0) {
            return [props.Family];
        }
        return [];
    }

    async applyFormatString(sformatString) {
        window.SkUISpreadSheet.applyFormatString(this.m_SpInterface.selectstr(), sformatString);
    }

    async getFormatString() {
        let wJson = window.SkUISpreadSheet.jsonFormatString();
        return wJson;
    }

    async getValueFormated(sformatString) {
        let wValueFormated = window.SkUISpreadSheet.defaultFormatString(sformatString.f);
        return wValueFormated;
    }

    async LoadFormat() {
        this.m_FormatString = [];
        this.m_FormatSections = [];
        const wFamilies = this.resolveFamilies(this.props);
        const wJson = window.SkUISpreadSheet.jsonFormatString();
        const wObjFormat = JSON.parse(wJson);
        const wByCode = new Map(
            (wObjFormat.formatstring || []).map((family) => [family.code, family.fs || []])
        );

        for (const wFamilyCode of wFamilies) {
            const wFormats = wByCode.get(wFamilyCode) || [];
            if (wFormats.length === 0) {
                continue;
            }
            const wStartIndex = this.m_FormatString.length;
            this.m_FormatString.push(...wFormats);
            this.m_FormatSections.push({
                code: wFamilyCode,
                startIndex: wStartIndex,
                count: wFormats.length,
            });
        }
    }

    async loadFormattedValues() {
        const formattedValues = await Promise.all(
            this.m_FormatString.map(async (formatString, index) => {
                try {
                    const value = window.SkUISpreadSheet.defaultFormatString(formatString.f);
                    return {
                        value,
                        index,
                        error: null
                    };
                } catch (error) {
                    console.error(error);
                    return {
                        value: null,
                        index,
                        error: true
                    };
                }
            })
        );
        this.setState({ formattedValues });
    }

    onSelect(event,id) {
        console.log( id);
        console.log( this.m_FormatString[id].f);
        let wFormatString="\""+this.m_FormatString[id].f+"\"";
        this.applyFormatString(wFormatString);
        this.m_SpInterface.reloadView();
    }

    renderFormat(formatString, index) {
        const formattedItem = this.state.formattedValues[index];
        if (!formattedItem) {
            return (
                <div key={index} className="SkTextRight">
                    Loading...
                </div>
            );
        }

        if (formattedItem.error) {
            return (
                <div key={index} className="SkTextRight error-message">
                    Format error
                </div>
            );
        }

        return (
            <div key={index} className="SkTextRight">
                <SkMenuElement id={index} onSelect={this.onSelect}>
                    {formattedItem.value}
                </SkMenuElement>
            </div>
        );
    }

    render() {
        return (
            <div>
                {this.m_FormatSections.map((section, sectionIndex) => (
                    <React.Fragment key={section.code}>
                        {sectionIndex > 0 ? (
                            <>
                                <div className="SkMenuWindow-separator" />
                                <div className="SkMenuHeader">{section.code}</div>
                            </>
                        ) : null}
                        {Array.from({ length: section.count }, (_, offset) => {
                            const wIndex = section.startIndex + offset;
                            return this.renderFormat(this.m_FormatString[wIndex], wIndex);
                        })}
                    </React.Fragment>
                ))}
            </div>
        );
    }
}

export default SkSpFormatString;