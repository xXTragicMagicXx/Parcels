const toastEl = document.getElementById("toast")!;
let timer: number | undefined;

export function toast(msg: string, ms = 2800): void {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  clearTimeout(timer);
  timer = window.setTimeout(() => (toastEl.hidden = true), ms);
}

export const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode etc. */
    }
  },
};
