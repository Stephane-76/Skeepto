//=============================================================================
// SkAiCapabilitiesHelp.js — empty-state help for the spreadsheet AI panel (French UI)
// Keep tool ids in sync with Node/Server/SkAI/SkMcpToolRegistrar.mjs
//=============================================================================

import React from 'react';

const CAPABILITY_SECTIONS = [
  {
    title: 'Lecture',
    tools: ['read_workbook', 'read_cell', 'read_range', 'list_sheets', 'get_column_width', 'get_row_height'],
  },
  {
    title: 'Tableaux & valeurs',
    tools: ['paste_grid', 'write_cells', 'write_cell', 'paste_range'],
    note: 'Préférez paste_grid pour un nouveau tableau (données + couleurs en un seul appel).',
  },
  {
    title: 'Mise en forme & tailles',
    tools: ['format_range', 'format_ranges', 'apply_format', 'merge_cells', 'resize_columns', 'resize_rows'],
  },
  {
    title: 'Copie & fichiers',
    tools: ['copy_range', 'duplicate_range', 'list_files', 'open_workbook', 'save_workbook'],
  },
  {
    title: 'Tables (tri & filtres)',
    tools: ['list_tables', 'create_table', 'apply_table_filter_sort'],
    note: 'Après paste_grid : create_table sur exactement la même plage (même coin haut-gauche et bas-droite), puis list_tables et apply_table_filter_sort.',
  },
];

const EXAMPLE_PROMPTS = [
  'Liste des départements français en tableau',
  'Transforme A1:D50 en table et trie la colonne B par ordre croissant',
  'Filtre la table sur la colonne Ville = Paris',
  'Élargis les colonnes B à D à 140 pixels',
  'Lis le contenu de la feuille active',
  'Fusionne les cellules H11:J13',
  'Quelles feuilles contient ce classeur ?',
];

export default function SkAiCapabilitiesHelp() {
  return (
    <div className="SkSpAiChat-help">
      <p className="SkSpAiChat-helpLead">
        L&apos;assistant modifie le classeur ouvert via le MCP sker (Cursor Cloud + tunnel HTTPS).
      </p>

      {CAPABILITY_SECTIONS.map((section) => (
        <div key={section.title} className="SkSpAiChat-helpSection">
          <div className="SkSpAiChat-helpTitle">{section.title}</div>
          <ul className="SkSpAiChat-helpTools">
            {section.tools.map((tool) => (
              <li key={tool}>
                <code>{tool}</code>
              </li>
            ))}
          </ul>
          {section.note ? (
            <p className="SkSpAiChat-helpNote">{section.note}</p>
          ) : null}
        </div>
      ))}

      <div className="SkSpAiChat-helpSection">
        <div className="SkSpAiChat-helpTitle">Exemples de prompts</div>
        <ul className="SkSpAiChat-helpExamples">
          {EXAMPLE_PROMPTS.map((text) => (
            <li key={text}>« {text} »</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
