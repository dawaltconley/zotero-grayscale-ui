export interface Annotation extends _ZoteroTypes.Reader.Annotation {
  /** added property to store the old color hex */
  __originalColor?: string;
}

/**
 * Mutate colors on the existing objects in-place to avoid cross-compartment
 * object creation. Firefox rejects new objects created in the plugin's
 * compartment when they're passed to the reader's compartment.lace
 */
export function applyGrayscale(annotation: Annotation): void {
  annotation.__originalColor = annotation.color;
  annotation.color = annotation.color && toGrayscale(annotation.color);
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

export function patchAnnotation(
  annotation: Annotation,
  callback: (patched: Annotation) => any,
): void {
  try {
    applyGrayscale(annotation);
    callback(annotation);
  } finally {
    restoreColor(annotation);
  }
}

export function patchAnnotations(
  annotations: Annotation[],
  callback: (patched: Annotation[]) => any,
): void {
  try {
    annotations.forEach((a) => applyGrayscale(a));
    callback(annotations);
  } finally {
    annotations.forEach((a) => restoreColor(a));
  }
}

// even steps, all in the DU4 light gray range
const COLOR_MAP: Record<string, string> = {
  /** yellow */
  '#ffd400': '#BFBFBF',

  /** red */
  '#ff6666': '#878787',

  /** green */
  '#5fb236': '#7B7B7B',

  /** blue */
  '#2ea8e5': '#707070',

  /** purple */
  '#a28ae5': '#929292',

  /** magenta */
  '#e56eee': '#9D9D9D',

  /** orange */
  '#f19837': '#A8A8A8',

  /** gray */
  '#aaaaaa': '#B4B4B4',
};

// // even steps, all in the DU4 light-to-dark gray range
// const COLOR_MAP: Record<string, string> = {
//   /** yellow */
//   '#ffd400': '#BFBFBF',
//
//   /** red */
//   '#ff6666': '#646464',
//
//   /** green */
//   '#5fb236': '#525252',
//
//   /** blue */
//   '#2ea8e5': '#404040',
//
//   /** purple */
//   '#a28ae5': '#767676',
//
//   /** magenta */
//   '#e56eee': '#898989',
//
//   /** orange */
//   '#f19837': '#9B9B9B',
//
//   /** gray */
//   '#aaaaaa': '#ADADAD',
// };

export function toGrayscale(hex: string): string {
  return COLOR_MAP[hex] || hex;
}
