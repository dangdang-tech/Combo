// vitest setup（每个测试文件前执行一次）。
//   1. @testing-library/jest-dom：toBeInTheDocument 等 DOM 匹配器。
//   2. afterEach 清理已挂载的 RTL 组件。
import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// 本环境（Node ≥22 实验性 webstorage 遮蔽 / jsdom 初始化差异）下 globalThis.localStorage
// 可能是个缺 clear() 等方法的残废对象，导致 useCollapse 等测试整批红。
// 检测到残废时换成完整的内存版 Storage，并同步替换全局 Storage 类，
// 保证 vi.spyOn(Storage.prototype, ...) 的降级测试仍然可用。
if (typeof (globalThis as { localStorage?: Storage }).localStorage?.clear !== 'function') {
  class MemoryStorage {
    private m = new Map<string, string>();
    getItem(key: string): string | null {
      return this.m.has(String(key)) ? this.m.get(String(key))! : null;
    }
    setItem(key: string, value: string): void {
      this.m.set(String(key), String(value));
    }
    removeItem(key: string): void {
      this.m.delete(String(key));
    }
    clear(): void {
      this.m.clear();
    }
    key(index: number): string | null {
      return [...this.m.keys()][index] ?? null;
    }
    get length(): number {
      return this.m.size;
    }
  }
  Object.defineProperty(globalThis, 'Storage', {
    value: MemoryStorage,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
});
