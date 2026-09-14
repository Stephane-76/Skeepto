import React from 'react';
import { SkComponent } from './SkComponent';
import './SkComponent.css';

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
        this.state = {
            value: this.props.value || '',
            showPopup: false,
            currentDate: new Date(),
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

    handleInputChange = (event) => {
        const value = event.target.value;
        this.setState({ value });
        if (this.props.onChange) {
            const customEvent = {
                target: {
                    id: this.props.id,
                    value: value
                }
            };
            this.props.onChange(customEvent);
        }
    };

    handleDateSelect = (date) => {
        // Format date in English format (MM/DD/YYYY)
        const formattedDate = date.toLocaleDateString('en-US');
        this.setState({ 
            value: formattedDate,
            showPopup: false 
        });
        if (this.props.onChange) {
            const customEvent = {
                target: {
                    id: this.props.id,
                    value: formattedDate
                }
            };
            this.props.onChange(customEvent);
        }
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
    value() {
        return this.state.value;
    }
    
    setValue(value) {
        this.setState({ value });
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