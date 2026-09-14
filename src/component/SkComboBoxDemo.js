import React, { useState } from 'react';
import SkComboBox from './SkComboBox';
import './SkComponent.css';

const cities = [
    { label: 'Paris', value: 'PAR' },
    { label: 'Lyon', value: 'LYS' },
    { label: 'Marseille', value: 'MRS' },
    { label: 'Bordeaux', value: 'BOD' },
    { label: 'Nantes', value: 'NTE' },
    { label: 'Toulouse', value: 'TLS' }
];

const altData = [
    { name: 'Apple', code: 'APL' },
    { name: 'Banana', code: 'BAN' },
    { name: 'Cherry', code: 'CHR' },
    { name: 'Date', code: 'DAT' }
];

export default function SkComboBoxDemo() {
    const [singleValue, setSingleValue] = useState('');
    const [multiValues, setMultiValues] = useState(['PAR']);
    const [controlledQuery, setControlledQuery] = useState('');
    const [customMulti, setCustomMulti] = useState(['BAN']);
    const bigOptions = Array.from({ length: 1000 }, (_, i) => ({ label: `Option ${i + 1}`, value: `OPT_${i + 1}` }));
    const [bigSingle, setBigSingle] = useState('');
    const [bigMulti, setBigMulti] = useState(['OPT_1', 'OPT_2']);

    const handleSingleChange = (e) => {
        setSingleValue(e.target.value);
        // console.log for demo
        console.log('single value =', e.target.value);
    };

    const handleMultiChange = (e) => {
        setMultiValues(e.target.value);
        console.log('multi values =', e.target.value);
    };

    const handleControlledChange = (e) => {
        setControlledQuery(e.target.label ?? e.target.value ?? '');
        console.log('controlled =', e.target);
    };

    const handleCustomMulti = (e) => {
        setCustomMulti(e.target.value);
        console.log('custom multi =', e.target.value);
    };

    return (
        <div className="SkFlex SkFlexColumn SkMargin">
            <h3>SkComboBox Demo</h3>

            <div className="SkMargin">
                <h4>1) Single selection</h4>
                <SkComboBox
                    id="city-single"
                    name="city-single"
                    placeholder="Pick a city..."
                    observeResize
                    options={cities}
                    onChange={handleSingleChange}
                />
                <div>Value: {String(singleValue)}</div>
            </div>

            <div className="SkMargin">
                <h4>2) Multi-selection (Google Sheets style)</h4>
                <SkComboBox
                    id="city-multi"
                    name="city-multi"
                    placeholder="Filter and select..."
                    multiple
                    observeResize
                    options={cities}
                    selectedValues={multiValues}
                    onChange={handleMultiChange}
                />
                <div>Values: {multiValues.join(', ')}</div>
            </div>

            <div className="SkMargin">
                <h4>3) Controlled by typed value (query)</h4>
                <div className="SkFlex SkFlexRow" style={{ gap: 8 }}>
                    <SkComboBox
                        id="city-controlled"
                        name="city-controlled"
                        placeholder="Type to filter..."
                        observeResize
                        options={cities}
                        value={controlledQuery}
                        onInputChange={setControlledQuery}
                        onChange={handleControlledChange}
                    />
                    <button className="SkButton" onClick={() => setControlledQuery('Pa')}>Set "Pa"</button>
                    <button className="SkButton" onClick={() => setControlledQuery('')}>Reset</button>
                </div>
                <div>Query: {controlledQuery}</div>
            </div>

            <div className="SkMargin">
                <h4>4) Custom fields (labelField/valueField/filterField)</h4>
                <SkComboBox
                    id="custom-multi"
                    name="custom-multi"
                    placeholder="Select fruits..."
                    multiple
                    observeResize
                    options={altData}
                    labelField="name"
                    valueField="code"
                    filterField="name"
                    selectedValues={customMulti}
                    onChange={handleCustomMulti}
                />
                <div>Selected codes: {customMulti.join(', ')}</div>
            </div>

            <div className="SkMargin">
                <h4>5) Keyboard navigation</h4>
                <div>
                    - Arrow keys: navigate the list<br/>
                    - Enter/Space: select/deselect (multi)<br/>
                    - Escape: close the list<br/>
                    - Backspace: remove the last chip if the input is empty
                </div>
            </div>

            <div className="SkMargin">
                <h4>6) Large option set (1000)</h4>
                <div className="SkFlex SkFlexColumn">
                    <div className="SkMargin">
                        <div>Single</div>
                        <SkComboBox
                            id="big-single"
                            name="big-single"
                            placeholder="Search in 1000 options..."
                            observeResize
                            options={bigOptions}
                            onChange={(e) => setBigSingle(e.target.value)}
                        />
                        <div>Value: {String(bigSingle)}</div>
                    </div>
                    <div className="SkMargin">
                        <div>Multi</div>
                        <SkComboBox
                            id="big-multi"
                            name="big-multi"
                            placeholder="Filter and select..."
                            multiple
                            observeResize
                            options={bigOptions}
                            selectedValues={bigMulti}
                            onChange={(e) => setBigMulti(e.target.value)}
                        />
                        <div>Values: {bigMulti.slice(0, 10).join(', ')}{bigMulti.length > 10 ? ` (+${bigMulti.length - 10})` : ''}</div>
                    </div>
                </div>
            </div>
        </div>
    );
}


