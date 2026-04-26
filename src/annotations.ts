export type AnnotationType =
  | 'image'
  | 'ink'
  | 'note'
  | 'text'
  | 'highlight'
  | 'highlight'
  | 'underline';

export interface Annotation {
  libraryID: number;
  type: AnnotationType;

  /** color hex, e.g. "#ffd400" */
  color: string;

  /** added property to store the old color hex */
  __originalColor?: string;
  text: string;
  comment: string;
  pageLabel: string;
  sortIndex: string;
  position: unknown;
  dateModified: string;
  id: string;
  tags: Element[];
}

/**
 * Mutate colors on the existing objects in-place to avoid cross-compartment
 * object creation. Firefox rejects new objects created in the plugin's
 * compartment when they're passed to the reader's compartment.lace
 */
export function applyGrayscale(annotation: Annotation): void {
  annotation.__originalColor = annotation.color;
  annotation.color = toGrayscale(annotation.color);
}

/**
 * Mutate colors on the existing objects in-place to avoid cross-compartment
 * object creation. Firefox rejects new objects created in the plugin's
 * compartment when they're passed to the reader's compartment.lace
 */
export function restoreColor(annotation: Annotation): void {
  if (annotation.__originalColor) {
    annotation.color = annotation.__originalColor;
    // delete annotation.__originalColor
  }
}

const COLOR_MAP: Record<string, string> = {
  /** yellow */
  '#ffd400': '#666666',

  /** red */
  '#ff6666': '#444444',

  /** green */
  '#5fb236': '#555555',

  /** blue */
  '#2ea8e5': '#555555',

  /** purple */
  '#a28ae5': '#444444',

  /** magenta */
  '#e56eee': '#777777',

  /** orange */
  '#f19837': '#888888',

  /** gray */
  '#aaaaaa': '#aaaaaa',
};

export function toGrayscale(hex: string): string {
  return COLOR_MAP[hex] || hex;
}
