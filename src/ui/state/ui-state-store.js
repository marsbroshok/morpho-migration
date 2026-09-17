/**
 * @fileoverview Centralized reactive state store for the frontend application.
 */

/**
 * State store managing application variables without undeclared global state.
 */
export class UiStateStore {
  constructor(initialState = {}) {
    this.subscribers = new Set();
    this.state = {
      userAddress: null,
      activeTab: 'rollover',
      publicClient: null,
      walletClient: null,
      settings: {
        alchemyKey: '',
        rpcUrl: ''
      },
      rollover: {
        sourceMarketId: '',
        destMarketId: '',
        sourceMarketParams: null,
        destMarketParams: null,
        position: null,
        slippageBps: 50n,
        capBorrow: true,
        bundleResult: null
      },
      leverage: {
        marketId: '',
        marketParams: null,
        position: null,
        targetLeverage: 1.0,
        slippageBps: 50n,
        bundleResult: null
      },
      rawSimulation: {
        rawTxData: '',
        result: null
      },
      ...initialState
    };
  }

  /**
   * Returns a top-level state value.
   *
   * @param {string} key
   * @returns {any}
   */
  get(key) {
    return this.state[key];
  }

  /**
   * Sets a top-level state value and notifies subscribers.
   *
   * @param {string} key
   * @param {any} value
   */
  set(key, value) {
    this.state[key] = value;
    this.notify(key, value);
  }

  /**
   * Updates an object property partially and notifies subscribers.
   *
   * @param {string} key
   * @param {object} partial
   */
  update(key, partial) {
    if (typeof this.state[key] === 'object' && this.state[key] !== null) {
      this.state[key] = { ...this.state[key], ...partial };
    } else {
      this.state[key] = partial;
    }
    this.notify(key, this.state[key]);
  }

  /**
   * Subscribes a listener to state mutations.
   *
   * @param {function(string, any): void} listener
   * @returns {function(): void} Unsubscribe function
   */
  subscribe(listener) {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  }

  /**
   * Dispatches state updates to all active subscribers.
   *
   * @param {string} key
   * @param {any} value
   */
  notify(key, value) {
    for (const listener of this.subscribers) {
      try {
        listener(key, value);
      } catch (err) {
        console.error(`[UiStateStore] Subscriber notification error on key "${key}":`, err);
      }
    }
  }

  /**
   * Resets the store back to its baseline default configuration.
   */
  reset() {
    this.state = {
      userAddress: null,
      activeTab: 'rollover',
      publicClient: null,
      walletClient: null,
      settings: {
        alchemyKey: '',
        rpcUrl: ''
      },
      rollover: {
        sourceMarketId: '',
        destMarketId: '',
        sourceMarketParams: null,
        destMarketParams: null,
        position: null,
        slippageBps: 50n,
        capBorrow: true,
        bundleResult: null
      },
      leverage: {
        marketId: '',
        marketParams: null,
        position: null,
        targetLeverage: 1.0,
        slippageBps: 50n,
        bundleResult: null
      },
      rawSimulation: {
        rawTxData: '',
        result: null
      }
    };
    this.notify('__reset__', this.state);
  }
}
