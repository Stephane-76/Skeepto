/**
 * Mirrors SkRoot/include/SkUnit.hpp `CstRecUnit*` entries: `apiUnit` must match each row's `m_Name`
 * string passed to ApplyUnit(ref, family, unit).
 */

export const UNIT_MENU_FAMILIES = [
  {
    apiFamily: "Monetary",
    menuLabel: "Monetary",
    units: [
      { apiUnit: "eur", label: "Euro", symbol: "€" },
      { apiUnit: "usd", label: "Dollar (USD)", symbol: "$" },
      { apiUnit: "gpb", label: "Pound sterling", symbol: "£" },
      { apiUnit: "yen", label: "Yen", symbol: "¥" },
      { apiUnit: "chf", label: "Swiss Franc", symbol: "CHF" },
      { apiUnit: "cad", label: "Canadian Dollar", symbol: "CA$" },
      { apiUnit: "aud", label: "Australian Dollar", symbol: "A$" },
    ],
  },
  {
    apiFamily: "Length",
    menuLabel: "Length",
    units: [
      { apiUnit: "micron", label: "Micrometer", symbol: "µm" },
      { apiUnit: "millimeter", label: "Millimeter", symbol: "mm" },
      { apiUnit: "centimeter", label: "Centimeter", symbol: "cm" },
      { apiUnit: "meter", label: "Meter", symbol: "m" },
      { apiUnit: "kilometer", label: "Kilometer", symbol: "km" },
    ],
  },
  {
    apiFamily: "Time",
    menuLabel: "Time",
    units: [
      { apiUnit: "millisecond", label: "Millisecond", symbol: "ms" },
      { apiUnit: "second", label: "Second", symbol: "s" },
      { apiUnit: "minute", label: "Minute", symbol: "min" },
      { apiUnit: "hour", label: "Hour", symbol: "h" },
      { apiUnit: "day", label: "Day", symbol: "d" },
      { apiUnit: "month", label: "Month", symbol: "mo" },
      { apiUnit: "year", label: "Year", symbol: "y" },
    ],
  },
  {
    apiFamily: "Mass",
    menuLabel: "Mass",
    units: [
      { apiUnit: "milligram", label: "Milligram", symbol: "mg" },
      { apiUnit: "g", label: "Gram", symbol: "g" },
      { apiUnit: "kilogram", label: "Kilogram", symbol: "kg" },
      { apiUnit: "tonne", label: "Tonne", symbol: "t" },
    ],
  },
];
