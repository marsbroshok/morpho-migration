/**
 * @fileoverview Error banner component and visual HTML error boundary.
 */

/**
 * Component managing visual notifications, error banners, and global error boundaries.
 */
export class ErrorBanner {
  /**
   * @param {Document} doc - DOM document reference.
   */
  constructor(doc = typeof document !== 'undefined' ? document : null) {
    this.doc = doc;
  }

  /**
   * Displays an error message in the requested container or global banner.
   *
   * @param {string|Error} message - Error description.
   * @param {string} [context='global'] - Target banner context ('global' or DOM element ID).
   */
  showError(message, context = 'global') {
    if (!this.doc) return;
    const text = message instanceof Error ? message.message : String(message);

    if (context === 'global') {
      const banner = this.doc.getElementById('globalErrorBanner');
      if (banner) {
        banner.style.display = 'block';
        banner.style.backgroundColor = '#ff4d4d';
        banner.style.color = '#ffffff';
        banner.style.padding = '12px 16px';
        banner.style.fontWeight = 'bold';
        banner.style.textAlign = 'center';
        banner.textContent = `⚠️ Application Error: ${text}`;
        banner.innerText = banner.textContent;
      }
    } else {
      const targetEl = this.doc.getElementById(context);
      if (targetEl) {
        targetEl.style.display = 'block';
        targetEl.className = 'error';
        targetEl.textContent = text;
        targetEl.innerText = text;
      }
    }
  }

  /**
   * Clears an active error notification.
   *
   * @param {string} [context='global'] - Banner context.
   */
  clearError(context = 'global') {
    if (!this.doc) return;
    if (context === 'global') {
      const banner = this.doc.getElementById('globalErrorBanner');
      if (banner) {
        banner.style.display = 'none';
        banner.textContent = '';
        banner.innerText = '';
      }
    } else {
      const targetEl = this.doc.getElementById(context);
      if (targetEl) {
        targetEl.style.display = 'none';
        targetEl.textContent = '';
        targetEl.innerText = '';
      }
    }
  }

  /**
   * Displays an informational notification.
   *
   * @param {string} message
   * @param {string} [elementId='status']
   */
  showInfo(message, elementId = 'status') {
    if (!this.doc) return;
    const el = this.doc.getElementById(elementId);
    if (el) {
      el.style.display = 'block';
      el.className = 'info';
      el.textContent = message;
      el.innerText = message;
    }
  }

  /**
   * Displays a success notification.
   *
   * @param {string} message
   * @param {string} [elementId='status']
   */
  showSuccess(message, elementId = 'status') {
    if (!this.doc) return;
    const el = this.doc.getElementById(elementId);
    if (el) {
      el.style.display = 'block';
      el.className = 'success';
      el.textContent = message;
      el.innerText = message;
    }
  }

  /**
   * Registers global unhandled rejection and error boundary hooks on window.
   *
   * @param {Window} win
   */
  initGlobalErrorListeners(win = typeof window !== 'undefined' ? window : null) {
    if (!win) return;
    win.addEventListener('error', (event) => {
      this.showError(event.error || event.message, 'global');
    });

    win.addEventListener('unhandledrejection', (event) => {
      this.showError(event.reason || 'Unhandled Promise Rejection', 'global');
    });
  }
}
