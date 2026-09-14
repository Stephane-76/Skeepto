/** Toggle bold / italic / underline / strikethrough on the current selection. */

export function buildTextDecorationCommand(cell, wantUnderline, wantStrike) {
  let command = 'text-decoration-line:none;';
  if (wantUnderline) {
    command += 'text-decoration-line:underline;';
  }
  if (wantStrike) {
    command += 'text-decoration-line:line-through;';
  }
  if (cell) {
    if (cell.f_bc) {
      command += `background-color:${cell.f_bc};`;
    }
    if (cell.f_c) {
      command += `color:${cell.f_c};`;
    }
  }
  return command;
}

async function applyFormatCommand(spInterface, command) {
  spInterface.setExtraUndo && spInterface.setExtraUndo();
  const selection = spInterface.selectstr();
  window.SkUISpreadSheet.format(selection, command);
  await spInterface.reloadView();
}

export async function toggleBold(spInterface) {
  const cell = spInterface.GetCellcursor();
  const turningOff = cell && cell.hasOwnProperty('f_we') && Number(cell.f_we) === 3;
  const command = turningOff ? 'font-weight:none;' : 'font-weight:bold;';
  await applyFormatCommand(spInterface, command);
}

export async function toggleItalic(spInterface) {
  const cell = spInterface.GetCellcursor();
  const turningOff = cell && cell.hasOwnProperty('f_st') && Number(cell.f_st) === 3;
  let command = turningOff ? 'font-style:normal;' : 'font-style:italic;';
  if (turningOff && cell) {
    if (cell.f_bc) {
      command += `background-color:${cell.f_bc};`;
    }
    if (cell.f_c) {
      command += `color:${cell.f_c};`;
    }
  }
  await applyFormatCommand(spInterface, command);
}

export async function toggleUnderline(spInterface) {
  const cell = spInterface.GetCellcursor();
  const hasUnderline = cell && cell.hasOwnProperty('f_d_u');
  const hasStrike = cell && cell.hasOwnProperty('f_d_l');
  const command = buildTextDecorationCommand(cell, !hasUnderline, hasStrike);
  await applyFormatCommand(spInterface, command);
}

export async function toggleStrikethrough(spInterface) {
  const cell = spInterface.GetCellcursor();
  const hasUnderline = cell && cell.hasOwnProperty('f_d_u');
  const hasStrike = cell && cell.hasOwnProperty('f_d_l');
  const command = buildTextDecorationCommand(cell, hasUnderline, !hasStrike);
  await applyFormatCommand(spInterface, command);
}
