/** Parse a CSS / .sker color into { r, g, b } (0–255). Returns null on failure. */
export function parseCssColor(sColor) {
  if (typeof sColor !== "string") {
    return null;
  }
  const wStr = sColor.trim().toLowerCase();
  if (wStr.length === 0) {
    return null;
  }
  const wNamed = {
    black: { r: 0, g: 0, b: 0 },
    white: { r: 255, g: 255, b: 255 },
    red: { r: 255, g: 0, b: 0 },
    green: { r: 0, g: 128, b: 0 },
    blue: { r: 0, g: 0, b: 255 },
    yellow: { r: 255, g: 255, b: 0 },
    gray: { r: 128, g: 128, b: 128 },
    grey: { r: 128, g: 128, b: 128 },
    lime: { r: 0, g: 255, b: 0 },
    navy: { r: 0, g: 0, b: 128 },
    maroon: { r: 128, g: 0, b: 0 },
    olive: { r: 128, g: 128, b: 0 },
    teal: { r: 0, g: 128, b: 128 },
    aqua: { r: 0, g: 255, b: 255 },
    fuchsia: { r: 255, g: 0, b: 255 },
    purple: { r: 128, g: 0, b: 128 },
    orange: { r: 255, g: 165, b: 0 },
    silver: { r: 192, g: 192, b: 192 },
    chartreuse: { r: 127, g: 255, b: 0 },
    transparent: null,
  };
  if (Object.prototype.hasOwnProperty.call(wNamed, wStr)) {
    return wNamed[wStr];
  }
  if (wStr.startsWith("#")) {
    const wHex = wStr.slice(1);
    if (wHex.length === 3) {
      return {
        r: parseInt(wHex[0] + wHex[0], 16),
        g: parseInt(wHex[1] + wHex[1], 16),
        b: parseInt(wHex[2] + wHex[2], 16),
      };
    }
    if (wHex.length === 6 || wHex.length === 8) {
      return {
        r: parseInt(wHex.slice(0, 2), 16),
        g: parseInt(wHex.slice(2, 4), 16),
        b: parseInt(wHex.slice(4, 6), 16),
      };
    }
    return null;
  }
  const wMatch = wStr.match(
    /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/
  );
  if (wMatch) {
    return {
      r: Math.round(parseFloat(wMatch[1])),
      g: Math.round(parseFloat(wMatch[2])),
      b: Math.round(parseFloat(wMatch[3])),
    };
  }
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(wStr)) {
    return {
      r: parseInt(wStr.slice(0, 2), 16),
      g: parseInt(wStr.slice(2, 4), 16),
      b: parseInt(wStr.slice(4, 6), 16),
    };
  }
  return null;
}

export function luminanceFromCssColor(sColor) {
  const wRgb = parseCssColor(sColor);
  if (!wRgb) {
    return null;
  }
  return 0.299 * wRgb.r + 0.587 * wRgb.g + 0.114 * wRgb.b;
}

/** Text + caret colors that stay legible on the cell background (JsonView f_bc / f_c). */
export function contrastInplaceEditColors(textColor, bgColor) {
  const wBgLum = luminanceFromCssColor(bgColor);
  const wTextLum = luminanceFromCssColor(textColor);
  const wOnDarkBg = wBgLum != null && wBgLum < 128;
  if (!wOnDarkBg) {
    return {
      textColor: textColor,
      caretColor: textColor,
    };
  }
  const wText =
    wTextLum == null || wTextLum < 160 ? "#FFFFFF" : textColor;
  return {
    textColor: wText,
    caretColor: "#FFFFFF",
  };
}
