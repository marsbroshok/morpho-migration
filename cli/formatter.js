/**
 * Class containing helper methods for CLI theme coloring, asset formatting, and layouts.
 */
export class CliFormatter {
  static COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    gray: '\x1b[90m',
    magenta: '\x1b[35m',
    white: '\x1b[37m'
  };

  /**
   * Apply ANSI color to text.
   * @param {string} text
   * @param {string} colorName
   * @returns {string}
   */
  static color(text, colorName) {
    const code = this.COLORS[colorName];
    if (!code) return text;
    return `${code}${text}${this.COLORS.reset}`;
  }

  /**
   * Format BigInt values into human-readable numbers with fixed decimal places.
   * @param {bigint|number} amount
   * @param {number} decimals
   * @param {number} precision
   * @returns {string}
   */
  static formatAmount(amount, decimals = 18, precision = 4) {
    const num = Number(amount) / 10 ** decimals;
    return num.toLocaleString(undefined, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision
    });
  }

  /**
   * Format currency values to USD format.
   * @param {number} amount
   * @returns {string}
   */
  static formatUsd(amount) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount);
  }

  /**
   * Print a styled section banner.
   * @param {string} title
   */
  static printHeader(title) {
    console.log('\n' + this.color('█'.repeat(70), 'gray'));
    console.log(`  ${this.color(title.toUpperCase(), 'bold')}`);
    console.log(this.color('█'.repeat(70), 'gray'));
  }

  /**
   * Print a styled sub-header.
   * @param {string} title
   */
  static printSubHeader(title) {
    console.log('\n' + this.color('━'.repeat(70), 'gray'));
    console.log(`  ${this.color(title.toUpperCase(), 'bold')}`);
    console.log(this.color('━'.repeat(70), 'gray'));
  }

  /**
   * Print a structured key-value item with option to color the value.
   * @param {string} label
   * @param {string} value
   * @param {string} valueColor
   */
  static printItem(label, value, valueColor = 'reset') {
    const paddedLabel = label.padEnd(20, ' ');
    console.log(`  ${this.color(paddedLabel, 'gray')} : ${this.color(value, valueColor)}`);
  }
}
