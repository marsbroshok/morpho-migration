/**
 * @fileoverview Wallet connection and WalletConnect QR code modal component.
 */

/**
 * Component managing the WalletConnect connection modal dialog and pairing status.
 */
export class WalletModal {
  /**
   * @param {Document} doc - DOM document reference.
   */
  constructor(doc) {
    this.doc = doc;
  }

  /**
   * Displays the WalletConnect pairing modal.
   */
  showModal() {
    if (!this.doc) return;
    const modal = this.doc.getElementById('wcModal');
    if (modal) {
      modal.style.display = 'flex';
    }
  }

  /**
   * Hides the WalletConnect pairing modal.
   */
  hideModal() {
    if (!this.doc) return;
    const modal = this.doc.getElementById('wcModal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  /**
   * Binds close button on the modal.
   *
   * @param {string} [buttonId='closeWcModalBtn']
   */
  bindCloseButton(buttonId = 'closeWcModalBtn') {
    if (!this.doc) return;
    const btn = this.doc.getElementById(buttonId);
    if (btn) {
      btn.addEventListener('click', () => {
        this.hideModal();
      });
    }
  }

  /**
   * Updates pairing status message.
   *
   * @param {string} message
   * @param {string} [statusId='wcStatus']
   */
  updateStatus(message, statusId = 'wcStatus') {
    if (!this.doc) return;
    const statusEl = this.doc.getElementById(statusId);
    if (statusEl) {
      statusEl.textContent = message;
    }
  }
}
