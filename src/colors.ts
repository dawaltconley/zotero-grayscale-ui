import Color from 'color';

/*
 * DU4:3 levels
 *
 * Black:   #00 - #3F, L <= 24.9%
 * Dark:    #40 - #6F, L <= 43.7%
 * Light:   #70 - #BF, L <= 75%
 * White:   #C0 - #FF, L <= 100%
 */

export function toDU4(colorString: string): string {
  let gray = Color(colorString).grayscale();
  const lightness = gray.lightness();
  if (lightness < 90) {
    if (lightness > 70) {
      gray = gray.lightness(70);
    }
  }
  return gray.hex();
}
