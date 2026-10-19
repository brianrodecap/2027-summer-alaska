// In-memory Web Storage stubs for tests, passed to code that takes a `storage`.
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(seed)) this.items.set(key, value);
  }

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  [name: string]: unknown;
}

// Storage the browser has blocked (private window, blocked site data): every call throws.
export class BlockedStorage extends MemoryStorage {
  override getItem(): never {
    throw new DOMException('blocked', 'SecurityError');
  }
  override setItem(): never {
    throw new DOMException('blocked', 'SecurityError');
  }
  override removeItem(): never {
    throw new DOMException('blocked', 'SecurityError');
  }
}

// Storage whose quota is full: reads work, writes throw.
export class FullStorage extends MemoryStorage {
  override setItem(): never {
    throw new DOMException('quota', 'QuotaExceededError');
  }
}
