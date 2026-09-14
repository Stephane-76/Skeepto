import numbro from 'numbro';

// French language configuration for Numbro
const frConfig = {
    languageTag: 'fr-FR',
    delimiters: {
        thousands: ' ',
        decimal: ','
    },
    abbreviations: {
        thousand: 'k',
        million: 'm',
        billion: 'b',
        trillion: 't'
    },
    ordinal: function (number) {
        return number === 1 ? 'er' : 'ème';
    },
    currency: {
        symbol: '€',
        position: 'postfix',
        code: 'EUR'
    },
    currencyFormat: {
        thousandSeparated: true,
        totalLength: 4,
        spaceSeparated: true,
        average: true
    },
    formats: {
        fourDigits: {
            totalLength: 4,
            spaceSeparated: true,
            average: true
        },
        fullWithTwoDecimals: {
            thousandSeparated: true,
            mantissa: 2
        },
        fullWithTwoDecimalsNoCurrency: {
            mantissa: 2,
            thousandSeparated: true
        },
        fullWithNoDecimals: {
            output: 'currency',
            thousandSeparated: true,
            mantissa: 0
        }
    }
};

// Register French configuration
numbro.registerLanguage(frConfig);
numbro.setLanguage('fr-FR');

// Cache for formatting options
const formatCache = new Map();

/**
 * Format a number according to locale and decimal places
 * @param {number|string} value - The value to format
 * @param {Object} options - Formatting options
 * @param {number} [options.decimals=2] - Number of decimal places
 * @param {string} [options.locale='fr-FR'] - Locale for formatting
 * @param {boolean} [options.thousandSeparated=true] - Thousand separator
 * @returns {string} The formatted number
 */
export const formatFloat = (value, options = {}) => {
    try {
        // Check if the value is a valid number
        const numValue = Number(value);
        if (isNaN(numValue)) {
            return String(value);
        }

        const {
            decimals = 2,
            locale = 'fr-FR',
            thousandSeparated = true
        } = options;

        // Create a cache key for the options
        const cacheKey = `${locale}-${decimals}-${thousandSeparated}`;
        
        // Get or create formatting options
        let formatOptions = formatCache.get(cacheKey);
        if (!formatOptions) {
            formatOptions = {
                thousandSeparated,
                mantissa: decimals
            };
            formatCache.set(cacheKey, formatOptions);
        }

        // Format with options
        let wFormatFloat = numbro(numValue).format(formatOptions);
        return wFormatFloat;
    } catch (error) {
        console.error( 'numbro error:', error);
        return String(value);
    }
};

/**
 * Parse a string into a float number respecting locale
 * @param {string} value - The value to parse
 * @param {Object} options - Parsing options
 * @param {string} [options.locale='fr-FR'] - Locale for parsing
 * @returns {Object} Parsing result
 * @returns {boolean} result.isValid - Indicates if the value is valid
 * @returns {number|string} result.value - The parsed value (number) or original value if invalid
 * @returns {string} [result.error] - Error message if the value is invalid
 * @returns {string} [result.formattedValue] - Value formatted according to locale
 * 
 * @example
 * // Parse a French value
 * parseFloat('1 234,56', { locale: 'fr-FR' })
 * // => { isValid: true, value: 1234.56, formattedValue: '1 234,56' }
 * 
 * @example
 * // Parse an American value
 * parseFloat('1,234.56', { locale: 'en-US' })
 * // => { isValid: true, value: 1234.56, formattedValue: '1,234.56' }
 * 
 * @example
 * // Parse an invalid value
 * parseFloat('abc', { locale: 'fr-FR' })
 * // => { isValid: false, value: 'abc', error: 'Invalid numeric value' }
 */
export const parseFloat = (value, options = {}) => {
    const { locale = 'fr-FR' } = options;

    try {
        // Clean input value
        let cleanValue = String(value).trim();
        
        // Set locale
        numbro.setLanguage(locale);
        
        // Get separators according to locale
        const decimalSeparator = numbro.languageData().delimiters.decimal;
        const thousandSeparator = numbro.languageData().delimiters.thousands;
        
        // Replace thousand separator
        cleanValue = cleanValue.replace(new RegExp(`\\${thousandSeparator}`, 'g'), '');
        
        // Replace decimal separator with dot for parsing
        cleanValue = cleanValue.replace(decimalSeparator, '.');
        
        // Check if the value is a valid number
        const numValue = Number(cleanValue);
        
        if (isNaN(numValue)) {
            // If not a valid number, check if it's a partial input
            // (e.g., "12," or "12.")
            const decimalPattern = new RegExp(`^-?\\d*[${decimalSeparator}.]?\\d*$`);
            if (decimalPattern.test(cleanValue)) {
                return {
                    isValid: true,
                    value: cleanValue,
                    formattedValue: cleanValue
                };
            }
            return {
                isValid: false,
                value: value,
                error: 'Invalid numeric value'
            };
        }

        // Format value according to locale
        const formattedValue = formatFloat(numValue, { locale });

        return {
            isValid: true,
            value: numValue,
            formattedValue: formattedValue
        };
    } catch (error) {
        return {
            isValid: false,
            value: value,
            error: 'numbro  error'
        };
    }
};
