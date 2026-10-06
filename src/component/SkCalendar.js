import React from 'react';
import { SkComponent } from './SkComponent';
import './SkComponent.css';

// Mongo stores dates as epoch milliseconds (Date.now()). The input shows a locale date.
function localeDateOrder() {
    const parts = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(2000, 11, 31));
    return parts.filter((part) => part.type === 'day' || part.type === 'month' || part.type === 'year')
        .map((part) => part.type);
}

function parseLocaleDate(text) {
    const bits = String(text).split(/[^0-9]+/).filter(Boolean);
    if (bits.length !== 3) {
        return null;
    }
    const order = localeDateOrder();
    const map = {};
    order.forEach((kind, index) => {
        map[kind] = Number(bits[index]);
    });
    if (!map.year || !map.month || !map.day) {
        return null;
    }
    const year = map.year < 100 ? 2000 + map.year : map.year;
    const date = new Date(year, map.month - 1, map.day);
    if (date.getFullYear() !== year || date.getMonth() !== map.month - 1 || date.getDate() !== map.day) {
        return null;
    }
    return date;
}

function parseDateValue(value) {
    if (value === null || value === undefined || value === '') {
        return null;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'number') {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const text = String(value).trim();
    if (/^-?\d+$/.test(text)) {
        const date = new Date(Number(text));
        return Number.isNaN(date.getTime()) ? null : date;
    }
    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
        const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
        return Number.isNaN(date.getTime()) ? null : date;
    }
    return parseLocaleDate(text);
}

function formatDateDisplay(date) {
    return date.toLocaleDateString();
}

export class SkCalendar extends SkComponent {
    // Constants for calendar
    static MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    
    static WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    /*
    static MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    // Week-day header
    static WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    */
    constructor(props) {
        super(props);
        const initialDate = parseDateValue(this.props.value);
        this.state = {
            value: initialDate ? formatDateDisplay(initialDate) : '',
            epoch: initialDate ? initialDate.getTime() : null,
            showPopup: false,
            currentDate: initialDate || new Date(),
            enabled: true
        };
        this.popupRef = React.createRef();
    }

    componentDidMount() {
        document.addEventListener('mousedown', this.handleClickOutside);
    }

    componentWillUnmount() {
        document.removeEventListener('mousedown', this.handleClickOutside);
    }

    handleClickOutside = (event) => {
        if (this.popupRef.current && !this.popupRef.current.contains(event.target)) {
            this.setState({ showPopup: false });
        }
    };

    togglePopup = () => {
        if (this.state.enabled) {
            this.setState(prevState => ({ showPopup: !prevState.showPopup }));
        }
    };

    notifyChange = () => {
        if (this.props.onChange) {
            this.props.onChange({
                target: {
                    id: this.props.id,
                    value: this.value()
                }
            });
        }
    };

    handleInputChange = (event) => {
        const text = event.target.value;
        const date = parseDateValue(text);
        this.setState({
            value: text,
            epoch: date ? date.getTime() : null,
            currentDate: date || this.state.currentDate,
        }, this.notifyChange);
    };

    handleBlur = () => {
        const date = parseDateValue(this.state.value);
        if (!date) {
            return;
        }
        this.setState({
            value: formatDateDisplay(date),
            epoch: date.getTime(),
            currentDate: date,
        });
    };

    handleDateSelect = (date) => {
        this.setState({
            value: formatDateDisplay(date),
            epoch: date.getTime(),
            currentDate: date,
            showPopup: false,
        }, this.notifyChange);
    };

    // Calendar navigation
    previousMonth = () => {
        this.setState(prevState => ({
            currentDate: new Date(prevState.currentDate.getFullYear(), prevState.currentDate.getMonth() - 1)
        }));
    };

    nextMonth = () => {
        this.setState(prevState => ({
            currentDate: new Date(prevState.currentDate.getFullYear(), prevState.currentDate.getMonth() + 1)
        }));
    };

    // SkForm methods
    // Epoch milliseconds, the same shape Mongo already stores. Empty when the field is blank.
    value() {
        return this.state.epoch === null || this.state.epoch === undefined ? '' : this.state.epoch;
    }
    
    setValue(value) {
        const date = parseDateValue(value);
        this.setState({
            value: date ? formatDateDisplay(date) : '',
            epoch: date ? date.getTime() : null,
            currentDate: date || new Date(),
        });
    }
    
    setEnabled = (enabled) => {
        this.setState({ enabled });
    };

    renderCalendar() {
        const { currentDate } = this.state;
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        
        return (
            <div ref={this.popupRef} className="SkCalendar-popup">
                <div className="SkCalendar-header">
                    <button onClick={this.previousMonth}>&lt;</button>
                    <span>{SkCalendar.MONTH_NAMES[month]} {year}</span>
                    <button onClick={this.nextMonth}>&gt;</button>
                </div>
                <div className="SkCalendar-grid">
                    {SkCalendar.WEEK_DAYS.map(day => (
                        <div key={day} className="SkCalendar-weekday">{day}</div>
                    ))}
                    {Array.from({ length: firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1 }, (_, i) => (
                        <div key={`empty-${i}`} className="SkCalendar-day empty"></div>
                    ))}
                    {Array.from({ length: lastDay.getDate() }, (_, i) => {
                        const date = new Date(year, month, i + 1);
                        return (
                            <div
                                key={i}
                                className="SkCalendar-day"
                                onClick={() => this.handleDateSelect(date)}
                            >
                                {i + 1}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    render() {
        const { showPopup, value, enabled } = this.state;
        const { placeholder = "Select a date" } = this.props; // Default English placeholder

        return (
            <div className="SkCalendar-container">
                <input
                    ref={this.m_Ref}
                    type="text"
                    value={value}
                    onChange={this.handleInputChange}
                    onBlur={this.handleBlur}
                    onClick={this.togglePopup}
                    placeholder={placeholder}
                    className="SkInput SkCalendar-input"
                    disabled={!enabled}
                />
                {showPopup && this.renderCalendar()}
            </div>
        );
    }
}

export default SkCalendar; 