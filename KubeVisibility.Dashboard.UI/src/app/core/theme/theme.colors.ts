/**
 * Centralized theme colors for the application
 * Following DRY principle - all colors defined in one place for easy maintenance
 * 
 * Use these constants in TypeScript code
 * For CSS, use the CSS variables defined in theme.css
 */

export const ThemeColors = {
  // Primary Brand Blue Colors
  primary: {
    teal: '#007bff',
    tealDark: '#0069d9',
    tealLight: '#3395ff',
    tealDarker: '#0056b3',
  },

  // Header Gradient - Brand Blue
  header: {
    gradient: 'linear-gradient(135deg, #0056b3 0%, #0069d9 52%, #007bff 100%)',
    gradientStart: '#0056b3',
    gradientMid: '#0069d9',
    gradientEnd: '#007bff',
  },

  // Button Colors
  button: {
    primary: '#007bff',
    primaryHover: '#0069d9',
    primaryShadow: 'rgba(0, 123, 255, 0.32)',
    // Keep semantic colors for specific actions
    success: '#10b981',
    successHover: '#059669',
    warning: '#f59e0b',
    warningHover: '#d97706',
    danger: '#ef4444',
    dangerHover: '#dc2626',
  },

  // Background Colors
  background: {
    tealLight: '#f0ebf0',
    tealLighter: '#faf2fb',
    white: '#ffffff',
    gray: '#f5f5f5',
    grayLight: '#f9fafb',
  },

  // Border Colors
  border: {
    teal: '#007bff',
    tealDark: '#0069d9',
    gray: '#e5e7eb',
    grayLight: '#e2e8f0',
  },

  // Text Colors
  text: {
    teal: '#007bff',
    tealDark: '#0069d9',
    gray: '#6b7280',
    grayDark: '#374151',
    dark: '#1e293b',
  },

  // Badge Colors
  badge: {
    teal: '#e6f2ff',
    tealText: '#0069d9',
  },

  // Status Colors (keep semantic meanings)
  status: {
    healthy: '#10b981',
    warning: '#f59e0b',
    critical: '#de680c',
    processing: '#007bff',
  },
} as const;

/**
 * Helper function to get CSS gradient string
 */
export function getHeaderGradient(): string {
  return ThemeColors.header.gradient;
}

/**
 * Helper function to get button primary color
 */
export function getPrimaryColor(): string {
  return ThemeColors.button.primary;
}

/**
 * Helper function to get button hover color
 */
export function getPrimaryHoverColor(): string {
  return ThemeColors.button.primaryHover;
}

/**
 * Helper function to get primary shadow color
 */
export function getPrimaryShadow(): string {
  return ThemeColors.button.primaryShadow;
}

/**
 * Helper function to get styles string with theme colors inlined
 * Use this in component styles arrays to ensure AOT compilation works
 * 
 * NOTE: This function must be called at module level (outside component decorator)
 * to ensure AOT compilation works. The returned string can be used directly in styles array.
 */
export function getThemeStyles(baseStyles: string): string {
  return baseStyles
    .replace(/\$\{ThemeColors\.header\.gradient\}/g, ThemeColors.header.gradient)
    .replace(/\$\{ThemeColors\.button\.primary\}/g, ThemeColors.button.primary)
    .replace(/\$\{ThemeColors\.button\.primaryHover\}/g, ThemeColors.button.primaryHover)
    .replace(/\$\{ThemeColors\.button\.primaryShadow\}/g, ThemeColors.button.primaryShadow)
    .replace(/\$\{ThemeColors\.primary\.teal\}/g, ThemeColors.primary.teal)
    .replace(/\$\{ThemeColors\.primary\.tealDark\}/g, ThemeColors.primary.tealDark)
    .replace(/\$\{ThemeColors\.primary\.tealLight\}/g, ThemeColors.primary.tealLight)
    .replace(/\$\{ThemeColors\.border\.teal\}/g, ThemeColors.border.teal)
    .replace(/\$\{ThemeColors\.text\.teal\}/g, ThemeColors.text.teal);
}

